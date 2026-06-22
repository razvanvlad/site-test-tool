import { callAI } from './ai-router.js';

/**
 * Deterministically match a finding to one of the 10 seeded patterns.
 * @param {object} finding - The finding containing category, title, and source_tool.
 * @returns {string|null} The pattern key, or null if no rule matches.
 */
export function matchFindingToPatternDeterministic(finding) {
  const category = (finding.category || '').toLowerCase();
  const title = (finding.title || '').toLowerCase();
  const tool = (finding.source_tool || '').toLowerCase();

  // 1. Broken Links
  if (tool === 'linkinator' || title.includes('broken link') || title.includes('404')) {
    return 'broken-link';
  }
  // 2. Alt Text
  if (category === 'accessibility' && (title.includes('alt') || title.includes('alternative text') || title.includes('image-alt'))) {
    return 'missing-alt';
  }
  // 3. Contrast
  if (category === 'accessibility' && (title.includes('contrast') || title.includes('color'))) {
    return 'low-contrast';
  }
  // 4. Form Labels
  if (category === 'accessibility' && (title.includes('label') || title.includes('select-name') || title.includes('form control') || title.includes('input'))) {
    return 'missing-labels';
  }
  // 5. Console JS Errors
  if (tool === 'playwright' && (title.includes('console') || title.includes('uncaught') || title.includes('exception') || title.includes('javascript error'))) {
    return 'console-error';
  }
  // 6. Network Failures
  if (tool === 'playwright' && (title.includes('network') || title.includes('failed to load') || title.includes('http error') || title.includes('status of 4') || title.includes('status of 5'))) {
    return 'network-failure';
  }
  // 7. Unoptimized Images
  if (tool === 'lighthouse' && (title.includes('image') || title.includes('modern format') || title.includes('resize') || title.includes('optimize') || title.includes('preload-lcp-image'))) {
    return 'unoptimized-images';
  }
  // 8. Render Blocking
  if (tool === 'lighthouse' && (title.includes('render-blocking') || title.includes('render blocking') || title.includes('defer'))) {
    return 'render-blocking';
  }
  // 9. SEO / Meta
  if (category === 'seo' && (title.includes('title') || title.includes('meta') || title.includes('description') || title.includes('robots') || title.includes('crawlable'))) {
    return 'missing-seo-meta';
  }
  // 10. Touch Targets
  if (category === 'design' || title.includes('touch target') || title.includes('tap target') || title.includes('target size') || title.includes('button size')) {
    return 'tiny-touch-targets';
  }

  return null;
}

/**
 * Matches a finding to a pattern, using deterministic matching first and falling back to Gemini Flash.
 * @param {object} finding - The finding.
 * @param {object} db - SQLite database instance.
 * @returns {Promise<string|null>} The pattern key.
 */
export async function matchFindingToPattern(finding, db) {
  // Try deterministic match first
  const deterministicKey = matchFindingToPatternDeterministic(finding);
  if (deterministicKey) {
    return deterministicKey;
  }

  // Fallback to Gemini 2.5 Flash
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  try {
    const patterns = db.prepare('SELECT pattern_key, category, title_template, description FROM fix_patterns').all();
    if (patterns.length === 0) return null;

    const patternListStr = patterns.map(p => `- Key: ${p.pattern_key} | Category: ${p.category} | Template: ${p.title_template} | Description: ${p.description}`).join('\n');

    const systemPrompt = 'You are a QA specialist assistant. Your job is to classify web audit findings into one of our predefined fix pattern categories. Always respond with only the raw pattern key or "null".';

    const prompt = `Select the best matching fix pattern key from the list below for this audit finding.

Predefined Fix Patterns:
${patternListStr}

Audit Finding:
- Tool: ${finding.source_tool || 'unknown'}
- Category: ${finding.category || 'unknown'}
- Title: ${finding.title || 'unknown'}
- Description: ${finding.description || 'N/A'}
- Selector: ${finding.selector || 'N/A'}
- HTML Snippet: ${finding.html_snippet || 'N/A'}

If none of the patterns fit, return "null".
Return ONLY the matching pattern_key (e.g. "broken-link") and nothing else.`;

    const { text } = await callAI({
      prompt,
      systemPrompt,
      preferredModel: 'gemini-2.5-flash',
      jsonMode: false
    });

    const cleanKey = text.trim().replace(/['"`]/g, '');
    const validKeys = patterns.map(p => p.pattern_key);
    
    if (validKeys.includes(cleanKey)) {
      return cleanKey;
    }
  } catch (err) {
    console.error('Error during AI pattern matching fallback:', err);
  }

  return null;
}
