import { chromium } from 'playwright';
import { initDb } from './src/db.js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

async function main() {
  const findingId = process.argv[2];

  if (!findingId) {
    console.error('Usage: node compare.js <findingId>');
    process.exit(1);
  }

  const db = initDb();

  // Fetch finding
  const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(findingId);
  if (!finding) {
    console.error(`Finding with ID ${findingId} not found.`);
    process.exit(1);
  }

  // Fetch audit
  const audit = db.prepare('SELECT url FROM audits WHERE id = ?').get(finding.audit_id);
  if (!audit) {
    console.error(`Audit with ID ${finding.audit_id} not found.`);
    process.exit(1);
  }

  if (!finding.evidence_path || !fs.existsSync(finding.evidence_path)) {
    console.error(`Evidence "before" screenshot not found at ${finding.evidence_path}`);
    process.exit(1);
  }

  console.log(`Starting capture for finding ${findingId} on URL ${audit.url}...`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(audit.url, { waitUntil: 'networkidle' });

  // Paths
  const afterPath = `reports/screenshots/finding-${findingId}-after.png`;
  const diffPath = `reports/screenshots/finding-${findingId}-diff.png`;

  // We capture full page to match the Phase 1 dimension.
  console.log(`Capturing after screenshot...`);
  await page.screenshot({ path: afterPath, fullPage: true });

  await browser.close();

  // Diffing
  console.log(`Comparing images...`);
  const img1 = PNG.sync.read(fs.readFileSync(finding.evidence_path));
  const img2 = PNG.sync.read(fs.readFileSync(afterPath));

  if (img1.width !== img2.width || img1.height !== img2.height) {
    console.warn(`Dimensions mismatch. Before: ${img1.width}x${img1.height}, After: ${img2.width}x${img2.height}. Resizing might be needed for perfect diff, but pixelmatch requires exact dimensions.`);
  }

  // We must ensure the diff image has the same dimensions as img1
  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const diff = new PNG({ width, height });

  let diffPixels = 0;
  try {
    diffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
  } catch (e) {
     console.error("Pixelmatch failed (likely dimension mismatch).");
     console.error(e.message);
     process.exit(1);
  }

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const diffPercentage = ((diffPixels / (width * height)) * 100).toFixed(2);
  console.log(`Diff generated. ${diffPixels} pixels differ (${diffPercentage}%).`);

  // Upsert
  const query = `
    INSERT INTO fix_tracker (finding_id, before_screenshot, after_screenshot, diff_image, diff_pixels, diff_percentage, verified, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(finding_id) DO UPDATE SET
      after_screenshot = excluded.after_screenshot,
      diff_image = excluded.diff_image,
      diff_pixels = excluded.diff_pixels,
      diff_percentage = excluded.diff_percentage,
      updated_at = datetime('now')
  `;

  // Better-sqlite3 needs ON CONFLICT to work on UNIQUE constraints. finding_id isn't UNIQUE in schema.sql.
  // Wait, let's check schema.sql: finding_id INTEGER REFERENCES findings(id)
  // There is NO UNIQUE constraint on finding_id in fix_tracker in schema.sql!
  // We should enforce this uniqueness or use SELECT to update.
  
  const existing = db.prepare('SELECT id FROM fix_tracker WHERE finding_id = ?').get(findingId);
  if (existing) {
    db.prepare(`
      UPDATE fix_tracker SET 
        after_screenshot = ?, diff_image = ?, diff_pixels = ?, diff_percentage = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(afterPath, diffPath, diffPixels, diffPercentage, existing.id);
  } else {
    db.prepare(`
      INSERT INTO fix_tracker (finding_id, before_screenshot, after_screenshot, diff_image, diff_pixels, diff_percentage, verified, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(findingId, finding.evidence_path, afterPath, diffPath, diffPixels, diffPercentage);
  }

  console.log(`Done. Saved to fix_tracker.`);
}

main().catch(err => {
  console.error("Failed:", err);
  process.exit(1);
});
