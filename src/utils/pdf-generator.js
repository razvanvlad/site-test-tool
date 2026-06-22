import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

/**
 * Encodes a local image file to a base64 Data URL.
 * @param {string} filePath - Path to the image file.
 * @returns {string|null} Base64 data URL or null if file not found.
 */
function getBase64Image(filePath) {
  if (!filePath) return null;
  const projectRoot = process.cwd();
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  
  if (fs.existsSync(absolutePath)) {
    try {
      const data = fs.readFileSync(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase().replace('.', '');
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    } catch (err) {
      console.error(`Error encoding image to base64: ${absolutePath}`, err);
    }
  }
  return null;
}

/**
 * Resolves a color code and text for a given Lighthouse score.
 * @param {number|null} score - Lighthouse score (0 to 1).
 * @returns {object} { color, label }
 */
function getScoreMetadata(score) {
  if (score === null || score === undefined) {
    return { color: '#64748b', bg: '#f1f5f9', label: 'N/A' };
  }
  const pct = Math.round(score * 100);
  if (score >= 0.9) return { color: '#10b981', bg: '#ecfdf5', label: `${pct}` }; // Green
  if (score >= 0.5) return { color: '#f59e0b', bg: '#fffbeb', label: `${pct}` }; // Orange
  return { color: '#ef4444', bg: '#fef2f2', label: `${pct}` }; // Red
}

/**
 * Returns a severity badge color configuration.
 * @param {string} severity
 * @returns {object} { color, bg }
 */
function getSeverityStyle(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return { color: '#ef4444', bg: '#fef2f2' };
    case 'serious':
      return { color: '#f59e0b', bg: '#fffbeb' };
    case 'moderate':
      return { color: '#3b82f6', bg: '#eff6ff' };
    default:
      return { color: '#10b981', bg: '#ecfdf5' };
  }
}

/**
 * Generates the HTML string for the PDF report.
 */
export function generateReportHtml(auditId, db) {
  const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(auditId);
  if (!audit) throw new Error(`Audit not found: ${auditId}`);

  // Fetch findings
  const findings = db.prepare('SELECT * FROM findings WHERE audit_id = ?').all(auditId);

  // Load associated patterns and attach them to findings
  const findingsWithPatterns = findings.map(f => {
    let pattern = null;
    if (f.fix_pattern_key) {
      pattern = db.prepare('SELECT * FROM fix_patterns WHERE pattern_key = ?').get(f.fix_pattern_key);
    }
    return {
      ...f,
      pattern
    };
  });

  // Deterministic ranking for Top 5: Critical (4), Serious (3), Moderate (2), Minor (1) desc,
  // then estimated_hours_high desc, then ID asc
  const severityWeights = { critical: 4, serious: 3, moderate: 2, minor: 1 };
  const sortedFindings = [...findingsWithPatterns].sort((a, b) => {
    const wA = severityWeights[a.severity] || 0;
    const wB = severityWeights[b.severity] || 0;
    if (wB !== wA) return wB - wA;

    const hoursA = a.pattern ? (a.pattern.estimated_hours_high || 0) : 0;
    const hoursB = b.pattern ? (b.pattern.estimated_hours_high || 0) : 0;
    if (hoursB !== hoursA) return hoursB - hoursA;

    return a.id - b.id;
  });

  const topFindings = sortedFindings.slice(0, 5);

  // Load pricing env parameters
  const quickWinsPrice = process.env.PACKAGE_QUICK_WINS_PRICE || '450';
  const performancePrice = process.env.PACKAGE_PERFORMANCE_PRICE || '1800';
  const fullPrice = process.env.PACKAGE_FULL_PRICE || '4500';
  const currency = process.env.PACKAGE_CURRENCY || 'RON';

  // Get score metadata
  const perfMeta = getScoreMetadata(audit.lighthouse_perf);
  const a11yMeta = getScoreMetadata(audit.lighthouse_a11y);
  const seoMeta = getScoreMetadata(audit.lighthouse_seo);

  // Format date
  const auditDate = audit.started_at ? new Date(audit.started_at).toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '—';

  // Prepare findings HTML list for Page 2
  let topFindingsHtml = '';
  if (topFindings.length === 0) {
    topFindingsHtml = '<p style="color: #64748b; font-style: italic; text-align: center; margin-top: 40px;">Nu s-au detectat erori critice pe această pagină. Excelent!</p>';
  } else {
    topFindings.forEach((f, idx) => {
      const sevStyle = getSeverityStyle(f.severity);
      const imgBase64 = getBase64Image(f.evidence_path);
      const remediation = f.pattern ? f.pattern.remediation : 'Review element code structure manually.';
      const businessImpact = f.pattern ? f.pattern.business_impact : 'Resolves structural validation errors, improving general SEO crawl and UX stability.';
      const hoursStr = f.pattern ? `${f.pattern.estimated_hours_low}-${f.pattern.estimated_hours_high} ore` : 'Manual review';

      topFindingsHtml += `
        <div class="finding-card">
          <div class="finding-header">
            <span class="finding-number">#${idx + 1}</span>
            <span class="finding-title">${f.title}</span>
            <span class="badge" style="color: ${sevStyle.color}; background-color: ${sevStyle.bg};">${(f.severity || 'moderate').toUpperCase()}</span>
          </div>
          
          <div class="finding-grid">
            <div class="finding-details">
              <p><strong>Descriere:</strong> ${f.description || 'Nespecificată.'}</p>
              <p><strong>Selector:</strong> <code class="code-selector">${f.selector || 'N/A'}</code></p>
              <p><strong>Impact Business:</strong> ${businessImpact}</p>
              <p><strong>Remediere Recomandată:</strong><br><span style="white-space: pre-line;">${remediation}</span></p>
              <p class="estimated-time"><strong>Efort estimat de remediere:</strong> ${hoursStr}</p>
              ${f.pattern && f.pattern.framework_notes ? `<p style="font-size: 0.85em; color: #64748b; margin-top: 5px;"><em>* ${f.pattern.framework_notes}</em></p>` : ''}
            </div>
            <div class="finding-visual">
              ${imgBase64 ? `
                <div class="screenshot-container">
                  <img src="${imgBase64}" alt="Dovada Vizuala" class="proof-image">
                  <div class="screenshot-label">Screenshot Dovadă</div>
                </div>
              ` : `
                <div class="screenshot-placeholder">
                  Fără screenshot dovadă
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    });
  }

  // HTML Report Template
  return `
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <title>Raport Audit Website</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
    
    @page {
      size: A4;
      margin: 0;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      color: #0f172a;
      background-color: #ffffff;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
    }
    
    .page {
      width: 210mm;
      height: 297mm;
      padding: 20mm;
      position: relative;
      page-break-after: always;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .page:last-child {
      page-break-after: avoid;
    }
    
    /* Header & Footer */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 5mm;
      margin-bottom: 10mm;
    }
    
    .logo {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      font-weight: 700;
      color: #6366f1;
      letter-spacing: -0.5px;
    }
    
    .logo span {
      color: #0f172a;
    }
    
    .document-tag {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      font-weight: 600;
      background: #f1f5f9;
      padding: 4px 10px;
      border-radius: 4px;
    }
    
    .footer {
      position: absolute;
      bottom: 20mm;
      left: 20mm;
      right: 20mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #f1f5f9;
      padding-top: 4mm;
      font-size: 11px;
      color: #64748b;
    }
    
    .footer-left {
      font-weight: 500;
    }
    
    .footer-right {
      font-weight: 400;
    }
    
    /* Page 1 Details */
    .title-container {
      margin-top: 15mm;
      margin-bottom: 12mm;
      text-align: center;
    }
    
    .title-container h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 38px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.15;
      margin-bottom: 4px;
    }
    
    .title-container p {
      font-size: 16px;
      color: #6366f1;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    
    .metadata-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 6mm;
      margin-bottom: 15mm;
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
    }
    
    .metadata-info p {
      font-size: 14px;
      margin-bottom: 6px;
      color: #475569;
    }
    
    .metadata-info p strong {
      color: #0f172a;
    }
    
    .metadata-info .url-text {
      font-family: monospace;
      color: #6366f1;
      font-size: 15px;
      word-break: break-all;
      font-weight: 600;
    }
    
    .score-circle-container {
      display: flex;
      justify-content: space-around;
      align-items: center;
      gap: 15px;
      margin-bottom: 15mm;
    }
    
    .score-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      flex: 1;
    }
    
    .score-circle {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 8px;
      font-family: 'Outfit', sans-serif;
      border: 4px solid currentColor;
    }
    
    .score-label {
      font-size: 13px;
      font-weight: 600;
      color: #334155;
    }
    
    .summary-section {
      flex-grow: 1;
    }
    
    .summary-section h2 {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .summary-box {
      background: #ffffff;
      border-left: 4px solid #6366f1;
      padding: 10px 15px;
      font-size: 14px;
      color: #334155;
      margin-bottom: 10mm;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      border-top: 1px solid #f1f5f9;
      border-right: 1px solid #f1f5f9;
      border-bottom: 1px solid #f1f5f9;
      border-radius: 0 8px 8px 0;
    }
    
    .impact-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 15px;
      font-size: 13.5px;
      color: #1e3a8a;
    }
    
    .impact-box h3 {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 4px;
    }
    
    /* Page 2 Details */
    .page-title {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .page-title-badge {
      font-size: 12px;
      background: #eff6ff;
      color: #2563eb;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 600;
    }
    
    .findings-container {
      display: flex;
      flex-direction: column;
      gap: 8mm;
      flex-grow: 1;
      overflow: hidden;
    }
    
    .finding-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    
    .finding-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 6px;
    }
    
    .finding-number {
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      font-weight: 700;
      color: white;
      background: #6366f1;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .finding-title {
      font-weight: 600;
      font-size: 14.5px;
      color: #0f172a;
      flex-grow: 1;
    }
    
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    
    .finding-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 15px;
      align-items: start;
    }
    
    .finding-details {
      font-size: 12px;
      color: #334155;
    }
    
    .finding-details p {
      margin-bottom: 6px;
    }
    
    .finding-details p strong {
      color: #0f172a;
    }
    
    .code-selector {
      font-family: monospace;
      background: #f1f5f9;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 11px;
      color: #0f172a;
      word-break: break-all;
    }
    
    .estimated-time {
      color: #0d9488 !important;
      font-weight: 600;
    }
    
    .finding-visual {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .screenshot-container {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      background: #f8fafc;
      width: 100%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
    }
    
    .proof-image {
      width: 100%;
      max-height: 120px;
      object-fit: contain;
      display: block;
    }
    
    .screenshot-label {
      background: #f1f5f9;
      padding: 4px;
      text-align: center;
      font-size: 10px;
      color: #64748b;
      font-weight: 500;
      border-top: 1px solid #cbd5e1;
    }
    
    .screenshot-placeholder {
      width: 100%;
      height: 90px;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      background: #f8fafc;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 11px;
      color: #94a3b8;
    }
    
    /* Page 3 Details */
    .packages-intro {
      text-align: center;
      margin-bottom: 8mm;
      max-width: 550px;
      margin-left: auto;
      margin-right: auto;
    }
    
    .packages-intro h2 {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      color: #0f172a;
      margin-bottom: 8px;
    }
    
    .packages-intro p {
      font-size: 13.5px;
      color: #64748b;
    }
    
    .packages-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12mm;
    }
    
    .package-card {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 15px 20px;
      display: grid;
      grid-template-columns: 1fr 2fr 1fr;
      align-items: center;
      gap: 20px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    
    .package-card.highlight {
      border-color: #6366f1;
      background: #fcfcff;
      position: relative;
    }
    
    .package-badge {
      position: absolute;
      top: -10px;
      right: 20px;
      background: #6366f1;
      color: white;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      text-transform: uppercase;
    }
    
    .package-title h3 {
      font-family: 'Outfit', sans-serif;
      font-size: 18px;
      color: #0f172a;
      margin-bottom: 2px;
    }
    
    .package-title p {
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .package-details {
      font-size: 12.5px;
      color: #334155;
    }
    
    .package-details ul {
      list-style: none;
    }
    
    .package-details li {
      margin-bottom: 4px;
      padding-left: 15px;
      position: relative;
    }
    
    .package-details li::before {
      content: "✓";
      color: #10b981;
      position: absolute;
      left: 0;
      font-weight: bold;
    }
    
    .package-price {
      text-align: right;
    }
    
    .package-price .price-value {
      font-family: 'Outfit', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1;
    }
    
    .package-price .price-period {
      font-size: 11px;
      color: #64748b;
      display: block;
      margin-top: 2px;
    }
    
    .cta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      margin-top: auto;
      margin-bottom: 10mm;
    }
    
    .cta-box h3 {
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    
    .cta-box p {
      font-size: 13px;
      color: #475569;
    }
    
    .cta-box a {
      color: #6366f1;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>

  <!-- PAGE 1: Overview & Summary -->
  <div class="page">
    <div class="header">
      <div class="logo">Soft<span>Site</span></div>
      <div class="document-tag">Audit de Performanță Web</div>
    </div>
    
    <div class="title-container">
      <p>Raport de Optimizare</p>
      <h1>Analiză Tehnică Detaliată</h1>
    </div>
    
    <div class="metadata-card">
      <div class="metadata-info">
        <p><strong>Website Auditat:</strong></p>
        <p class="url-text">${audit.url}</p>
        <p style="margin-top: 15px;"><strong>Data Auditului:</strong> ${auditDate}</p>
        <p><strong>ID Audit:</strong> #${audit.id}</p>
      </div>
      <div style="border-left: 1px solid #cbd5e1; padding-left: 20px; display: flex; flex-direction: column; justify-content: center;">
        <p><strong>Erori Totale:</strong> ${findings.length}</p>
        <p><strong>Probleme Top 5:</strong> ${Math.min(5, topFindings.length)}</p>
      </div>
    </div>
    
    <div class="score-circle-container">
      <div class="score-box">
        <div class="score-circle" style="color: ${perfMeta.color}; background-color: ${perfMeta.bg};">${perfMeta.label}</div>
        <div class="score-label">Performanță</div>
      </div>
      <div class="score-box">
        <div class="score-circle" style="color: ${a11yMeta.color}; background-color: ${a11yMeta.bg};">${a11yMeta.label}</div>
        <div class="score-label">Accesibilitate</div>
      </div>
      <div class="score-box">
        <div class="score-circle" style="color: ${seoMeta.color}; background-color: ${seoMeta.bg};">${seoMeta.label}</div>
        <div class="score-label">Google SEO</div>
      </div>
    </div>
    
    <div class="summary-section">
      <h2>REZUMAT EXECUTIV</h2>
      <div class="summary-box">
        ${audit.ai_summary ? audit.ai_summary.replace(/## 🖥️ Desktop Analysis & Summary/g, '<strong>Desktop Analysis:</strong>').replace(/## 📱 Mobile Responsiveness Analysis/g, '<br><strong>Mobile Analysis:</strong>').replace(/\n/g, '<br>') : 'Performanța site-ului necesită optimizări pentru Core Web Vitals și remedierea erorilor semnalate de auditor.'}
      </div>
    </div>
    
    <div class="impact-box">
      <h3>De ce contează aceste scoruri?</h3>
      Fiecare secundă de întârziere la încărcarea paginii scade rata de conversie cu 7%. De asemenea, motoarele de căutare penalizează site-urile cu deficiențe de accesibilitate și viteză scăzută de încărcare pe mobile, ducând la pierderea de clienți organici.
    </div>
    
    <div class="footer">
      <div class="footer-left">SoftSite • contact@softsite.ro</div>
      <div class="footer-right">Pagina 1 din 3</div>
    </div>
  </div>

  <!-- PAGE 2: Top 5 Issues -->
  <div class="page">
    <div class="header">
      <div class="logo">Soft<span>Site</span></div>
      <div class="document-tag">Erori Principale & Remedieri</div>
    </div>
    
    <div class="page-title">
      Cele mai critice 5 probleme de rezolvat
      <span class="page-title-badge">Selecție Deterministică Prioritară</span>
    </div>
    
    <div class="findings-container">
      ${topFindingsHtml}
    </div>
    
    <div class="footer">
      <div class="footer-left">SoftSite • contact@softsite.ro</div>
      <div class="footer-right">Pagina 2 din 3</div>
    </div>
  </div>

  <!-- PAGE 3: Service Packages -->
  <div class="page">
    <div class="header">
      <div class="logo">Soft<span>Site</span></div>
      <div class="document-tag">Pachete Servicii & Contact</div>
    </div>
    
    <div class="packages-intro">
      <h2>Cum te putem ajuta?</h2>
      <p>Remedierea acestor probleme necesită cunoștințe tehnice avansate de programare. Echipa noastră vă stă la dispoziție pentru optimizarea completă a website-ului.</p>
    </div>
    
    <div class="packages-grid">
      <div class="package-card">
        <div class="package-title">
          <h3>Quick Wins</h3>
          <p>Optimizare de Bază</p>
        </div>
        <div class="package-details">
          <ul>
            <li>Rezolvarea celor mai grave 5 erori identificate în raport</li>
            <li>Curățarea erorilor de JavaScript din consolă</li>
            <li>Corectarea linkurilor interne nefuncționale (broken links)</li>
          </ul>
        </div>
        <div class="package-price">
          <div class="price-value">${quickWinsPrice} ${currency}</div>
          <div class="price-period">plată unică</div>
        </div>
      </div>
      
      <div class="package-card highlight">
        <div class="package-badge">Cel mai popular</div>
        <div class="package-title">
          <h3>Performance</h3>
          <p>Optimizare Viteza & SEO</p>
        </div>
        <div class="package-details">
          <ul>
            <li>Optimizarea completă a imaginilor (WebP/AVIF, responsive resizing)</li>
            <li>Eliminarea resurselor render-blocking din Head</li>
            <li>Îmbunătățirea timpilor de încărcare Core Web Vitals</li>
            <li>Scor garantat de minim 90 în Lighthouse</li>
          </ul>
        </div>
        <div class="package-price">
          <div class="price-value">${performancePrice} ${currency}</div>
          <div class="price-period">plată unică</div>
        </div>
      </div>
      
      <div class="package-card">
        <div class="package-title">
          <h3>Full Care</h3>
          <p>Pachet Complet De Optimizare</p>
        </div>
        <div class="package-details">
          <ul>
            <li>Rezolvarea tuturor problemelor de Accesibilitate & SEO</li>
            <li>Ajustări responsive pentru layout-ul pe dispozitive mobile</li>
            <li>Monitorizare proactivă a performanței timp de 30 de zile</li>
            <li>Suport dedicat post-optimizare și raport final</li>
          </ul>
        </div>
        <div class="package-price">
          <div class="price-value">${fullPrice} ${currency}</div>
          <div class="price-period">plată unică</div>
        </div>
      </div>
    </div>
    
    <div class="cta-box">
      <h3>Vrei un website mai rapid și mai bine poziționat pe Google?</h3>
      <p>Contactează-ne astăzi la <a href="mailto:contact@softsite.ro">contact@softsite.ro</a> pentru o consultanță gratuită și începerea remedierii!</p>
    </div>
    
    <div class="footer">
      <div class="footer-left">SoftSite • contact@softsite.ro</div>
      <div class="footer-right">Pagina 3 din 3</div>
    </div>
  </div>

</body>
</html>
  `;
}

/**
 * Generates an A4 PDF Report from an audit ID and writes it to outputPath.
 */
export async function generatePdfReport(auditId, db, outputPath) {
  const htmlContent = generateReportHtml(auditId, db);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Load content directly
    await page.setContent(htmlContent);
    // Print to A4 PDF
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        bottom: '0mm',
        left: '0mm',
        right: '0mm'
      }
    });
    
    // Save generated path in db
    db.prepare('UPDATE audits SET pdf_path = ? WHERE id = ?').run(outputPath, auditId);
    console.error(`PDF report generated successfully at: ${outputPath}`); // write diagnostics to stderr
  } finally {
    await browser.close();
  }
}

// ── CRM and Email Stubs ────────────────────────────────────────────────────────

/**
 * Stub to send report to lead email
 */
export async function sendReportEmail(auditId, recipientEmail) {
  console.error(`[STUB] sendReportEmail called for audit ID ${auditId} to recipient: ${recipientEmail}`);
  return { success: true, message: 'Email sent successfully (stub)' };
}

/**
 * Stub to post Captured Lead details to PerfexCRM
 */
export async function postLeadToPerfexCRM(leadData) {
  console.error(`[STUB] postLeadToPerfexCRM called with data:`, JSON.stringify(leadData));
  return { success: true, leadId: Math.floor(Math.random() * 1000) };
}
