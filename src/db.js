import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { matchFindingToPatternDeterministic } from './utils/pattern-matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const seedPatterns = [
  {
    pattern_key: 'broken-link',
    category: 'links',
    issue_type: 'broken-link',
    severity: 'moderate',
    title_template: 'Fix Broken Link: {url}',
    description: 'The link to "{url}" returns a 404 error or fails to resolve. This creates a dead end for users and signals poor site maintenance to search engines.',
    remediation: '1. Verify the target URL is correct.\n2. If the page moved, update the href to the new location.\n3. If the page no longer exists, remove the link or replace it with a relevant alternative.\n4. For CMS sites, check that the slug has not changed.',
    business_impact: 'Broken links reduce crawl budget and user trust. Each dead link is a potential lost conversion.',
    estimated_hours_low: 0.25,
    estimated_hours_high: 1.0,
    framework_notes: 'WordPress: Check Permalink Settings or use a redirect plugin. Next.js: Verify getStaticPaths / link routing.'
  },
  {
    pattern_key: 'missing-alt',
    category: 'accessibility',
    issue_type: 'missing-alt',
    severity: 'moderate',
    title_template: 'Add Alt Text to Image: {selector}',
    description: 'An image element is missing an alt attribute. Screen readers cannot describe this image, and search engines cannot index its visual context.',
    remediation: '1. Locate the image at selector {selector}.\n2. Add a descriptive alt attribute, e.g., alt="Company Logo" or alt="Product image".\n3. If the image is purely decorative, add alt="" so screen readers ignore it.',
    business_impact: 'Improves image search rankings on Google and ensures compliance with WCAG accessibility laws, protecting against legal liability.',
    estimated_hours_low: 0.1,
    estimated_hours_high: 0.25,
    framework_notes: 'React/Next.js: Always use next/image component which enforces alt tags.'
  },
  {
    pattern_key: 'low-contrast',
    category: 'accessibility',
    issue_type: 'low-contrast',
    severity: 'serious',
    title_template: 'Increase Text Contrast: {selector}',
    description: 'The text contrast ratio is below the WCAG 2.1 AA requirement of 4.5:1. This makes it difficult or impossible for visually impaired individuals to read.',
    remediation: '1. Find the element at {selector}.\n2. Adjust the CSS color or background-color to increase contrast.\n3. Verify the new contrast ratio using an online contrast checker (aim for >= 4.5:1).',
    business_impact: 'Low contrast hurts readability for all users, especially on mobile devices outdoors. Better contrast increases session duration.',
    estimated_hours_low: 0.25,
    estimated_hours_high: 0.5,
    framework_notes: 'Tailwind: Update color classes from e.g., text-gray-400 to text-gray-700.'
  },
  {
    pattern_key: 'missing-labels',
    category: 'accessibility',
    issue_type: 'missing-labels',
    severity: 'serious',
    title_template: 'Add Associated Label to Form Control: {selector}',
    description: 'A form input, checkbox, or select control lacks an associated label or descriptive ARIA attribute. Screen readers cannot tell users what to type.',
    remediation: '1. Add a <label for="input_id"> tag that matches the input id.\n2. Or wrap the input within a <label> element.\n3. Alternatively, add an aria-label="Description" attribute directly to the element.',
    business_impact: 'Unlabeled forms lead to direct conversion drop-offs. If users do not understand form inputs, they abandon sign-ups/checkouts.',
    estimated_hours_low: 0.25,
    estimated_hours_high: 0.75,
    framework_notes: 'React: Use htmlFor instead of for.'
  },
  {
    pattern_key: 'console-error',
    category: 'console',
    issue_type: 'console-error',
    severity: 'serious',
    title_template: 'Fix Console Script Error: {description}',
    description: 'An uncaught JavaScript runtime error occurred in the browser console. This indicates client-side code execution is broken.',
    remediation: '1. Check the console error logs and trace the stack to identify the source file.\n2. Add try-catch blocks to handle runtime edge cases.\n3. Ensure variables are checked for null or undefined before invoking methods or reading attributes.',
    business_impact: 'JavaScript crashes break essential interactive elements (e.g. Add to Cart, mobile menus, submit buttons), directly halting revenue.',
    estimated_hours_low: 0.5,
    estimated_hours_high: 2.0,
    framework_notes: 'React: Implement Error Boundaries to isolate crashes and prevent entire page breakages.'
  },
  {
    pattern_key: 'network-failure',
    category: 'network',
    issue_type: 'network-failure',
    severity: 'serious',
    title_template: 'Resolve Failed Network Request: {url}',
    description: 'A network request to "{url}" failed with a 4xx/5xx HTTP status or network timeout. Essential assets or API endpoints are failing.',
    remediation: '1. Check if the asset at the path exists on the server.\n2. For API failures, check server logs for errors (500s) or CORS configuration issues.\n3. Verify network endpoints and resolve incorrect relative paths.',
    business_impact: 'Failed asset requests cause layout breaks and missing images, while broken APIs completely disable website functions.',
    estimated_hours_low: 0.5,
    estimated_hours_high: 3.0,
    framework_notes: 'WordPress: Fix permalinks or verify asset uploads directory path. Next.js: Check api/ route handlers.'
  },
  {
    pattern_key: 'unoptimized-images',
    category: 'performance',
    issue_type: 'unoptimized-images',
    severity: 'moderate',
    title_template: 'Optimize Image Sizes: {selector}',
    description: 'Images are served with file sizes or dimensions that are far larger than necessary, causing slow page loads.',
    remediation: '1. Compress images using WebP/AVIF formats.\n2. Scale image source dimensions to match their actual layout width/height.\n3. Use responsive images with srcset or load lazily with loading="lazy".',
    business_impact: 'Slow mobile page load times increase bounce rates drastically. Image optimization is the fastest way to increase page speed and mobile UX.',
    estimated_hours_low: 0.5,
    estimated_hours_high: 1.5,
    framework_notes: 'Next.js: Use next/image which automates optimization, WebP compression, and responsive widths.'
  },
  {
    pattern_key: 'render-blocking',
    category: 'performance',
    issue_type: 'render-blocking',
    severity: 'moderate',
    title_template: 'Defer Render-Blocking Resource: {url}',
    description: 'A stylesheet or JavaScript script loaded in the <head> is blocking the browser from displaying page content quickly.',
    remediation: '1. Add defer or async attributes to non-critical script tags.\n2. Move script tags to the bottom of the body.\n3. Inline critical path CSS and defer loading of large stylesheets using media attributes.',
    business_impact: 'Minimizes the "blank white screen" delay. Faster first paints keep users engaged and improve Google Core Web Vitals rankings.',
    estimated_hours_low: 0.5,
    estimated_hours_high: 2.0,
    framework_notes: 'WordPress: Use optimization plugins (e.g. WP Rocket, Autoptimize). Next.js: Use next/script with correct loading strategies.'
  },
  {
    pattern_key: 'missing-seo-meta',
    category: 'seo',
    issue_type: 'missing-seo-meta',
    severity: 'moderate',
    title_template: 'Add Missing Title or Meta Description',
    description: 'The page is missing a document title or a meta description tag, limiting the search engine listing format.',
    remediation: '1. Check the <head> element of the page.\n2. Add a descriptive <title> tag (50-60 chars).\n3. Add a <meta name="description" content="..."> tag (150-160 chars) summarizing page content.',
    business_impact: 'Search engine listings will look broken or generic, severely reducing organic click-through rates from search results.',
    estimated_hours_low: 0.25,
    estimated_hours_high: 0.5,
    framework_notes: 'Next.js: Use Metadata API export in page or layout components.'
  },
  {
    pattern_key: 'tiny-touch-targets',
    category: 'accessibility',
    issue_type: 'tiny-touch-targets',
    severity: 'moderate',
    title_template: 'Enlarge Tiny Touch Target: {selector}',
    description: 'An interactive element (button, link, or input) is too small or too close to adjacent elements, making it difficult for mobile tap accuracy.',
    remediation: '1. Increase target size using CSS padding (aim for at least 48x48px interactive size).\n2. Add margin/gap spacing between adjacent buttons or links.\n3. Verify element sizing on mobile viewports.',
    business_impact: 'Misclicks on mobile frustrates users, leading directly to higher abandonment on checkout/form pages.',
    estimated_hours_low: 0.25,
    estimated_hours_high: 0.75,
    framework_notes: 'Tailwind: Use padding classes (p-3, p-4) or min-w-[48px] min-h-[48px] to enforce minimum sizes.'
  }
];

export function initDb(dbPath = 'data/audit.db') {
  const projectRoot = path.resolve(__dirname, '..');
  const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(projectRoot, dbPath);
  const dbDir = path.dirname(absoluteDbPath);
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(absoluteDbPath);
  
  const schemaPath = path.join(projectRoot, 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  db.exec(schema);

  // Dynamic migrations for existing databases
  try {
    db.exec('ALTER TABLE audits ADD COLUMN ai_summary TEXT');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE audits ADD COLUMN ai_tasks TEXT');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE projects ADD COLUMN local_path TEXT');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE projects ADD COLUMN tech_stack TEXT');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE audits ADD COLUMN pdf_path TEXT');
  } catch (e) {}
  try {
    db.exec('ALTER TABLE findings ADD COLUMN fix_pattern_key TEXT REFERENCES fix_patterns(pattern_key)');
  } catch (e) {}

  // Seed fix patterns
  try {
    const countPatterns = db.prepare('SELECT COUNT(*) as count FROM fix_patterns').get().count;
    if (countPatterns === 0) {
      const insertPattern = db.prepare(`
        INSERT INTO fix_patterns (
          pattern_key, category, issue_type, severity, title_template,
          description, remediation, business_impact, estimated_hours_low,
          estimated_hours_high, framework_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      db.transaction(() => {
        for (const p of seedPatterns) {
          insertPattern.run(
            p.pattern_key,
            p.category,
            p.issue_type,
            p.severity,
            p.title_template,
            p.description,
            p.remediation,
            p.business_impact,
            p.estimated_hours_low,
            p.estimated_hours_high,
            p.framework_notes
          );
        }
      })();
      console.log('Seeded 10 fix patterns into database.');
    }
  } catch (err) {
    console.error('Failed to seed fix patterns:', err);
  }

  // Backfill existing findings with deterministic matching
  try {
    const existingFindings = db.prepare('SELECT id, category, title, source_tool FROM findings WHERE fix_pattern_key IS NULL').all();
    if (existingFindings.length > 0) {
      console.log(`Found ${existingFindings.length} findings to backfill with fix patterns...`);
      const updateFinding = db.prepare('UPDATE findings SET fix_pattern_key = ? WHERE id = ?');
      db.transaction(() => {
        for (const f of existingFindings) {
          const patternKey = matchFindingToPatternDeterministic(f);
          if (patternKey) {
            updateFinding.run(patternKey, f.id);
          }
        }
      })();
      console.log('Backfill of fix patterns completed.');
    }
  } catch (err) {
    console.error('Failed to backfill existing findings:', err);
  }
  
  return db;
}
