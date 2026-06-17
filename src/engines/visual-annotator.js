import { chromium } from 'playwright';
import { initDb } from '../db.js';
import path from 'path';
import fs from 'fs';

const db = initDb();

export async function annotateFindings(auditId, url) {
  console.log(`- Running Visual Annotator for audit ${auditId}...`);
  
  // Get all findings that have a selector or a source_url
  const findings = db.prepare(`
    SELECT * FROM findings 
    WHERE audit_id = ? 
    AND (selector IS NOT NULL OR source_url IS NOT NULL)
  `).all(auditId);

  if (findings.length === 0) {
    console.log('  No annotatable findings found.');
    return;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (err) {
    console.log(`  Failed to load page for annotation: ${err.message}`);
    await browser.close();
    return;
  }

  const updateFinding = db.prepare(`
    UPDATE findings 
    SET evidence_path = ?, html_snippet = COALESCE(html_snippet, ?) 
    WHERE id = ?
  `);

  const screenshotDir = path.join(process.cwd(), 'reports', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  let annotatedCount = 0;

  for (const finding of findings) {
    try {
      let locator = null;

      // Try to find by selector
      if (finding.selector) {
        // Some axe selectors might be complex or invalid for Playwright (like html > body)
        try {
          const loc = page.locator(finding.selector).first();
          const count = await loc.count();
          if (count > 0) locator = loc;
        } catch (e) { /* ignore invalid selector */ }
      }

      // If no selector, try source_url (for missing images/videos/links)
      if (!locator && finding.source_url) {
        try {
          const srcLoc = page.locator(`[src="${finding.source_url}"]`).first();
          if (await srcLoc.count() > 0) locator = srcLoc;
          else {
            const hrefLoc = page.locator(`[href="${finding.source_url}"]`).first();
            if (await hrefLoc.count() > 0) locator = hrefLoc;
          }
        } catch (e) { /* ignore */ }
      }

      if (!locator) continue;

      // Ensure it's visible
      await locator.scrollIntoViewIfNeeded().catch(() => {});

      // Inject the highlight using page.evaluate
      const elementHtml = await locator.evaluate((el, id) => {
        el.style.outline = '4px solid red';
        el.style.outlineOffset = '4px';
        el.style.boxShadow = '0 0 0 4px rgba(255, 0, 0, 0.5)';
        
        const label = document.createElement('div');
        label.textContent = `Issue #${id}`;
        label.style.position = 'absolute';
        label.style.backgroundColor = 'red';
        label.style.color = 'white';
        label.style.padding = '2px 6px';
        label.style.fontSize = '12px';
        label.style.fontWeight = 'bold';
        label.style.zIndex = '999999';
        label.style.borderRadius = '4px';
        label.style.transform = 'translateY(-100%)';
        
        if (!['IMG', 'VIDEO', 'INPUT', 'BR', 'HR'].includes(el.tagName)) {
          el.style.position = el.style.position === 'static' ? 'relative' : el.style.position;
          el.appendChild(label);
        }

        return el.outerHTML;
      }, finding.id).catch(() => null);

      if (!elementHtml) continue;

      await page.waitForTimeout(100);

      const filename = `highlighted-${finding.id}-${Date.now()}.png`;
      const filepath = path.join(screenshotDir, filename);

      // Take viewport screenshot showing the red circle in context
      await page.screenshot({ path: filepath });

      // Clean up the highlight
      await locator.evaluate((el) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
        el.style.boxShadow = '';
        if (el.lastChild && el.lastChild.textContent && el.lastChild.textContent.includes('Issue #')) {
          el.removeChild(el.lastChild);
        }
      }).catch(() => {});

      // Update DB
      const relativePath = `reports/screenshots/${filename}`;
      updateFinding.run(relativePath, elementHtml, finding.id);
      
      // Categorize as visual-bug if it was a network error but is found in the DOM
      if (finding.category === 'network' && finding.source_url) {
        db.prepare(`UPDATE findings SET category = 'visual-bug' WHERE id = ?`).run(finding.id);
      }

      annotatedCount++;
    } catch (err) {
      console.log(`  Failed to annotate finding ${finding.id}: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`  v Annotated ${annotatedCount} findings with visual evidence.`);
}
