import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { initDb } from './src/db.js';
import { captureSignals } from './src/engines/playwright-capture.js';
import { runAxe } from './src/engines/axe-runner.js';
import { runLighthouse } from './src/engines/lighthouse-runner.js';
import { checkLinks } from './src/engines/link-checker.js';
import { normalizeFindings } from './src/normalize.js';
import { annotateFindings } from './src/engines/visual-annotator.js';
import chalk from 'chalk';
import ora from 'ora';

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(a => !a.startsWith('--'));
  const projectArg = args.find(a => a.startsWith('--project='));
  const pageArg = args.find(a => a.startsWith('--page='));
  const categoriesArg = args.find(a => a.startsWith('--categories='));

  if (!url) {
    console.error('Usage: node audit.js <url> [--project=id] [--page=id] [--categories=console,axe,lighthouse,links]');
    process.exit(1);
  }

  const projectId = projectArg ? parseInt(projectArg.split('=')[1], 10) : null;
  const pageId = pageArg ? parseInt(pageArg.split('=')[1], 10) : null;
  const categories = categoriesArg ? categoriesArg.split('=')[1].split(',') : ['console', 'axe', 'lighthouse', 'links', 'visual'];


  // Ensure directories exist
  const reportsDir = path.join(process.cwd(), 'reports');
  const screenshotsDir = path.join(reportsDir, 'screenshots');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const db = initDb();
  
  // Create audit entry
  const insertAudit = db.prepare('INSERT INTO audits (project_id, url, started_at, status) VALUES (?, ?, ?, ?)');
  const auditInfo = insertAudit.run(projectId, url, new Date().toISOString(), 'running');
  const auditId = auditInfo.lastInsertRowid;

  console.log(chalk.bold.blue(`\n--- Starting Audit for ${url} ---`));
  
  // 1. Playwright & Axe
  let consoleErrors = [], failedRequests = [], axeViolations = [];
  let screenshotPathRelative = null;
  let screenshotPathAbsolute = null;
  const timestamp = Date.now();

  if (categories.includes('console') || categories.includes('axe')) {
    let spinner = ora('Running Playwright...').start();
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    screenshotPathRelative = `reports/screenshots/audit-${timestamp}-full.png`;
    screenshotPathAbsolute = path.resolve(process.cwd(), screenshotPathRelative);

    if (categories.includes('console')) {
      const res = await captureSignals(url, page, { screenshotPath: screenshotPathAbsolute });
      consoleErrors = res.consoleErrors;
      failedRequests = res.failedRequests;
      spinner.succeed('Playwright Console/Network completed');
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.screenshot({ path: screenshotPathAbsolute, fullPage: true });
    }

    if (categories.includes('axe')) {
      spinner = ora('Running axe-core for accessibility...').start();
      axeViolations = await runAxe(page);
      spinner.succeed('axe-core completed');
    }
    
    await browser.close();
  }

  // 2. Lighthouse
  let lighthouseLhr = null;
  if (categories.includes('lighthouse')) {
    let spinner = ora('Running Lighthouse...').start();
    const { lhr, error: lhError } = await runLighthouse(url);
    lighthouseLhr = lhr;
    if (lhError) console.error(chalk.red('Lighthouse Error:'), lhError);
    spinner.succeed('Lighthouse completed');
  }

  // 3. Linkinator
  let brokenLinks = [];
  if (categories.includes('links')) {
    let spinner = ora('Running Linkinator...').start();
    brokenLinks = await checkLinks(url);
    spinner.succeed('Linkinator completed');
  }

  // Normalize
  const normSpinner = ora('Normalizing Findings...').start();
  const normalized = normalizeFindings({
    consoleErrors,
    failedRequests,
    axeViolations,
    lighthouseLhr,
    brokenLinks
  });
  normSpinner.succeed('Findings normalized and saved');

  // Insert Findings
  const insertFinding = db.prepare(`
    INSERT INTO findings (
      audit_id, page_id, category, severity, title, description, selector, source_url, source_tool, evidence_path, html_snippet, is_false_positive, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const f of normalized) {
      insertFinding.run(
        auditId,
        pageId, // Map to project page if provided
        f.category,
        f.severity,
        f.title,
        f.description,
        f.selector,
        f.source_url,
        f.source_tool,
        screenshotPathRelative, // Map everything in this audit to the single screenshot for now
        f.html_snippet || null,
        f.is_false_positive || 0,
        f.notes || null,
        new Date().toISOString()
      );
    }
  })();

  // Update audit entry
  let lhPerf = null, lhA11y = null, lhSeo = null;
  if (lighthouseLhr && lighthouseLhr.categories) {
    lhPerf = lighthouseLhr.categories.performance?.score || null;
    lhA11y = lighthouseLhr.categories.accessibility?.score || null;
    lhSeo = lighthouseLhr.categories.seo?.score || null;
  }

  const updateAudit = db.prepare(`
    UPDATE audits SET finished_at = ?, status = ?, lighthouse_perf = ?, lighthouse_a11y = ?, lighthouse_seo = ?
    WHERE id = ?
  `);
  updateAudit.run(new Date().toISOString(), 'done', lhPerf, lhA11y, lhSeo, auditId);

  // Run Visual Annotator
  if (categories.includes('visual')) {
    await annotateFindings(auditId, url);
  }

  // Write JSON report
  const auditReport = db.prepare('SELECT * FROM audits WHERE id = ?').get(auditId);
  const findingsReport = db.prepare('SELECT * FROM findings WHERE audit_id = ?').all(auditId);
  
  const reportPath = path.join(reportsDir, `audit-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ audit: auditReport, findings: findingsReport }, null, 2));

  // Console Summary
  const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const categoryCounts = {};

  for (const f of findingsReport) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  }

  console.log(chalk.bold.green('\n--- Audit Complete ---'));
  console.log(`Report: ${chalk.cyan(reportPath)}`);
  console.log(`Screenshot: ${chalk.cyan(screenshotPathRelative)}`);
  
  console.log(chalk.bold('\nSeverity Summary:'));
  console.log(`${chalk.red.bold('Critical:')} ${severityCounts.critical} | ${chalk.red('Serious:')} ${severityCounts.serious} | ${chalk.yellow('Moderate:')} ${severityCounts.moderate} | ${chalk.blue('Minor:')} ${severityCounts.minor}`);
  
  console.log(chalk.bold('\nCategory Summary:'));
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`- ${cat}: ${chalk.yellow(count)}`);
  }
}

main().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
