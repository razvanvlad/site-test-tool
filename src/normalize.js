export function normalizeFindings(raw) {
  const { consoleErrors, failedRequests, axeViolations, lighthouseLhr, brokenLinks, mobileFindings } = raw;
  const normalized = [];

  // 1. Console Errors
  if (consoleErrors) {
    for (const err of consoleErrors) {
      normalized.push({
        category: 'console',
        severity: 'moderate',
        title: 'Console Error',
        description: err.text || err,
        selector: null,
        source_url: err.url || null,
        source_tool: 'playwright',
        html_snippet: err.text || err
      });
    }
  }

  // 2. Failed Requests (mapped to content if 404, network if other)
  if (failedRequests) {
    for (const req of failedRequests) {
      if (req.status === 404) {
        let title = '404 Not Found';
        if (req.url && req.url.match(/\.(jpeg|jpg|gif|png|webp|svg|ico)$/i)) {
          title = 'Wrong image url';
        } else {
          title = 'Missing resource';
        }
        
        normalized.push({
          category: 'content',
          severity: 'moderate',
          title: title,
          description: `Missing resource: ${req.url}`,
          selector: null,
          source_url: req.url,
          source_tool: 'playwright',
          html_snippet: req.url
        });
      } else {
        normalized.push({
          category: 'network',
          severity: req.status >= 500 ? 'serious' : 'moderate',
          title: `Failed Request: ${req.status || 'Error'}`,
          description: `Failed to load resource. Status: ${req.status || req.err}`,
          selector: null,
          source_url: req.url,
          source_tool: 'playwright',
          html_snippet: req.url
        });
      }
    }
  }

  // 3. Axe Violations
  if (axeViolations) {
    for (const v of axeViolations) {
      for (const node of v.nodes) {
        let impact = v.impact;
        if (v.id === 'image-alt' || v.id === 'color-contrast') {
          impact = 'moderate';
        }
        
        normalized.push({
          category: 'accessibility',
          severity: impact, // critical, serious, moderate, minor
          title: v.id,
          description: v.description,
          selector: node.target ? node.target[0] : null,
          source_url: null,
          source_tool: 'axe',
          html_snippet: node.html || null
        });
      }
    }
  }

  // 4. Lighthouse
  if (lighthouseLhr && lighthouseLhr.audits) {
    const audits = lighthouseLhr.audits;
    const categories = lighthouseLhr.categories;
    
    // Map audit IDs to categories based on lhr.categories
    const auditToCategory = {};
    for (const catId of Object.keys(categories)) {
      for (const ref of categories[catId].auditRefs) {
        auditToCategory[ref.id] = catId;
      }
    }

    for (const [id, audit] of Object.entries(audits)) {
      if (audit.score !== null && audit.score <= 0.70 && audit.scoreDisplayMode !== 'notApplicable' && audit.scoreDisplayMode !== 'informative') {
        let cat = auditToCategory[id] || 'performance';
        if (cat === 'best-practices') cat = 'best-practices'; // Keeping it literal for now if it doesn't fit standard categories

        let selector = null;
        let html_snippet = null;
        if (audit.details && audit.details.items && audit.details.items.length > 0) {
          const item = audit.details.items[0];
          if (item.node) {
            selector = item.node.selector || null;
            html_snippet = item.node.snippet || null;
          }
        }

        normalized.push({
          category: cat,
          severity: audit.score < 0.5 ? 'serious' : 'moderate',
          title: audit.title,
          description: audit.description,
          selector: selector,
          source_url: null,
          source_tool: 'lighthouse',
          html_snippet: html_snippet
        });
      }
    }
  }

  // 5. Linkinator
  if (brokenLinks) {
    for (const link of brokenLinks) {
      let severity = 'moderate';
      let is_false_positive = 0;
      let notes = null;

      if (link.status === 403 || link.status === 999) {
        is_false_positive = 1;
        notes = 'needs manual check';
      }

      let title = 'Broken link';
      if (link.url && link.url.match(/\.(jpeg|jpg|gif|png|webp|svg|ico)$/i)) {
        title = 'Wrong image url';
      }

      normalized.push({
        category: 'content',
        severity: severity,
        title: title,
        description: `Broken link to ${link.url} from ${link.parent || 'root'} (Status ${link.status})`,
        selector: null,
        source_url: link.url,
        source_tool: 'linkinator',
        html_snippet: link.url,
        is_false_positive,
        notes
      });
    }
  }

  // 6. Mobile AI Check
  if (mobileFindings && mobileFindings.length > 0) {
    for (const mf of mobileFindings) {
      normalized.push({
        category: 'design',
        severity: mf.severity || 'moderate',
        title: mf.title,
        description: mf.description,
        selector: mf.selector,
        source_url: null,
        source_tool: 'gemini-vision',
        evidence_path: mf.evidence_path || null,
        html_snippet: null,
        is_false_positive: 0,
        notes: null
      });
    }
  }

  return normalized;
}
