import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { initDb } from './src/db.js';
import { captureSignals } from './src/engines/playwright-capture.js';
import { runAxe } from './src/engines/axe-runner.js';
import { runLighthouse } from './src/engines/lighthouse-runner.js';
import { checkLinks } from './src/engines/link-checker.js';
import { normalizeFindings } from './src/normalize.js';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node audit.js <url>');
    process.exit(1);
  }

  // Ensure directories exist
  const reportsDir = path.join(process.cwd(), 'reports');
  const screenshotsDir = path.join(reportsDir, 'screenshots');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const db = initDb();
  
  // Create audit entry
  const insertAudit = db.prepare('INSERT INTO audits (url, started_at, status) VALUES (?, ?, ?)');
  const auditInfo = insertAudit.run(url, new Date().toISOString(), 'running');
  const auditId = auditInfo.lastInsertRowid;

  console.log(`\n--- Starting Audit for ${url} ---`);
  
  // 1. Playwright & Axe
  console.log('[1/4] Running Playwright (Console/Network/Screenshot)...');
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const timestamp = Date.now();
  const screenshotPathRelative = `reports/screenshots/audit-${timestamp}-full.png`;
  const screenshotPathAbsolute = path.resolve(process.cwd(), screenshotPathRelative);

  const { consoleErrors, failedRequests } = await captureSignals(url, page, { screenshotPath: screenshotPathAbsolute });

  console.log('[2/4] Running axe-core for accessibility...');
  const axeViolations = await runAxe(page);
  
  await browser.close();

  // 2. Lighthouse
  console.log('[3/4] Running Lighthouse...');
  const { lhr: lighthouseLhr, error: lhError } = await runLighthouse(url);
  if (lhError) console.error('Lighthouse Error:', lhError);

  // 3. Linkinator
  console.log('[4/4] Running Linkinator...');
  const brokenLinks = await checkLinks(url);

  // Normalize
  console.log('\n--- Normalizing Findings ---');
  const normalized = normalizeFindings({
    consoleErrors,
    failedRequests,
    axeViolations,
    lighthouseLhr,
    brokenLinks
  });

  // Insert Findings
  const insertFinding = db.prepare(`
    INSERT INTO findings (
      audit_id, category, severity, title, description, selector, source_url, source_tool, evidence_path, is_false_positive, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const f of normalized) {
      insertFinding.run(
        auditId,
        f.category,
        f.severity,
        f.title,
        f.description,
        f.selector,
        f.source_url,
        f.source_tool,
        screenshotPathRelative, // Map everything in this audit to the single screenshot for now
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

  console.log('\n--- Audit Complete ---');
  console.log(`Report: ${reportPath}`);
  console.log(`Screenshot: ${screenshotPathRelative}`);
  console.log('\nSeverity Summary:');
  console.log(`Critical: ${severityCounts.critical} | Serious: ${severityCounts.serious} | Moderate: ${severityCounts.moderate} | Minor: ${severityCounts.minor}`);
  console.log('\nCategory Summary:');
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`- ${cat}: ${count}`);
  }
}

main().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
