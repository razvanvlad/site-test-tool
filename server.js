import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { initDb } from './src/db.js';
import { exec, spawn } from 'child_process';
import util from 'util';
import { crawlSite } from './src/engines/crawl.js';
import { GoogleGenAI } from '@google/genai';
import { proposeFix, findMatchingFile } from './src/utils/code-healer.js';
import { callAI, quotaState } from './src/utils/ai-router.js';
import { generatePdfReport, sendReportEmail, postLeadToPerfexCRM } from './src/utils/pdf-generator.js';

// Track daily PDF generation per IP for rate limiting
const pdfGenerationCounts = new Map();
import fs from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { runAxe } from './src/engines/axe-runner.js';
import { runLighthouse } from './src/engines/lighthouse-runner.js';
import { chromium, devices } from 'playwright';

const ai = new GoogleGenAI({}); // Used for non-routed direct calls (kept for compatibility)

const execPromise = util.promisify(exec);

const app = express();
const port = process.env.PORT || 3000;

// Initialize database
const db = initDb();

// Clean up any stale running audits from previous sessions on startup
try {
  db.prepare("UPDATE audits SET status = 'error', progress = 'Server restarted' WHERE status = 'running'").run();
} catch (err) {
  console.error('Failed to clean up stale audits:', err);
}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/reports/screenshots', express.static('reports/screenshots')); // Serve screenshots

// API Routes

// POST /api/run-audit - Runs an audit for a URL or Project Page
app.post('/api/run-audit', async (req, res) => {
  const { url, project_id, page_id, categories } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  try {
    let args = ['audit.js', url];
    if (project_id) args.push(`--project=${project_id}`);
    if (page_id) args.push(`--page=${page_id}`);
    if (categories && categories.length > 0) {
      args.push(`--categories=${categories.join(',')}`);
    }

    // Use spawn to avoid maxBuffer crash
    const child = spawn('node', args, { stdio: 'inherit' });
    
    child.on('error', (err) => {
      console.error('Failed to start child process:', err);
    });

    child.on('close', (code) => {
      console.log(`Audit child process exited with code ${code}`);
      if (code !== 0 && project_id) {
        try {
          db.prepare("UPDATE audits SET status = 'error', progress = ? WHERE project_id = ? AND status = 'running'").run(`Failed with exit code ${code}`, project_id);
        } catch (dbErr) {
          console.error('Failed to update audit error status in DB:', dbErr);
        }
      }
    });

    // Return immediately so the UI doesn't hang
    res.json({ success: true, message: 'Audit started in background' });
  } catch (error) {
    console.error('Error running audit:', error);
    res.status(500).json({ error: 'Failed to run audit', details: error.message });
  }
});

// GET /api/projects
app.get('/api/projects', (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai-status - Returns AI model availability and quota state
app.get('/api/ai-status', (req, res) => {
  res.json({
    gemini: {
      configured: !!process.env.GEMINI_API_KEY,
      exhausted: quotaState.gemini.exhausted,
      resetAt: quotaState.gemini.resetAt,
    },
    groq: {
      configured: !!process.env.GROQ_API_KEY,
      exhausted: quotaState.groq.exhausted,
      resetAt: quotaState.groq.resetAt,
    },
  });
});

// POST /api/findings/:id/ai-explain - Uses AI to explain a finding
app.post('/api/findings/:id/ai-explain', async (req, res) => {
  try {
    const { id } = req.params;
    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    
    // If we already have an explanation, return it instantly
    if (finding.ai_explanation) {
      return res.json({ explanation: finding.ai_explanation, modelUsed: 'cached' });
    }

    // Try to get explanation from matched pattern first (saving API costs)
    let pattern = null;
    if (finding.fix_pattern_key) {
      pattern = db.prepare('SELECT * FROM fix_patterns WHERE pattern_key = ?').get(finding.fix_pattern_key);
    }
    
    if (pattern) {
      const explanation = `**Ce înseamnă aceasta:**\n${pattern.description}\n\n**Impact Business:**\n${pattern.business_impact}\n\n**Cum se rezolvă:**\n${pattern.remediation}`;
      db.prepare('UPDATE findings SET ai_explanation = ? WHERE id = ?').run(explanation, id);
      return res.json({ explanation, modelUsed: 'curated_pattern' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'No AI API key configured. Set GEMINI_API_KEY in .env' });
    }

    const systemPrompt = 'You are an expert web developer and accessibility specialist acting as an AI assistant for a Content Administrator. Be extremely concise — maximum 3 sentences total.';

    const prompt = `The user found a bug/issue on their website:
- Category: ${finding.category}
- Severity: ${finding.severity}
- Title: ${finding.title}
- Description: ${finding.description || 'N/A'}
- Selector: ${finding.selector || 'N/A'}
- Source URL: ${finding.source_url || 'N/A'}
- HTML Snippet:
\`\`\`html
${finding.html_snippet || 'N/A'}
\`\`\`

Provide a helpful, plain-English response with exactly two sections:
**What this means:**
[1 sentence explaining the issue]

**How to fix it:**
[1-2 actionable steps]
`;

    // Fall back to Gemini 2.5 Flash if no pattern is available
    const { text: explanation, modelUsed } = await callAI({ prompt, systemPrompt, jsonMode: false, model: 'gemini-2.5-flash' });

    // Save to database
    db.prepare('UPDATE findings SET ai_explanation = ? WHERE id = ?').run(explanation, id);

    res.json({ explanation, modelUsed });
  } catch (err) {
    console.error('AI Explain Error:', err);
    res.status(500).json({ error: 'Failed to generate explanation. Check server logs.' });
  }
});

// POST /api/projects
app.post('/api/projects', (req, res) => {
  const { name, base_url, local_path } = req.body;
  if (!name || !base_url) return res.status(400).json({ error: 'Name and Base URL required' });
  try {
    const info = db.prepare('INSERT INTO projects (name, base_url, local_path, created_at) VALUES (?, ?, ?, ?)')
                   .run(name, base_url, local_path || null, new Date().toISOString());
    res.json({ id: info.lastInsertRowid, name, base_url, local_path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.transaction(() => {
      // Find all findings for this project's audits to delete fix_tracker entries
      const audits = db.prepare('SELECT id FROM audits WHERE project_id = ?').all(id);
      for (const audit of audits) {
        const findings = db.prepare('SELECT id FROM findings WHERE audit_id = ?').all(audit.id);
        for (const finding of findings) {
          db.prepare('DELETE FROM fix_tracker WHERE finding_id = ?').run(finding.id);
        }
        db.prepare('DELETE FROM findings WHERE audit_id = ?').run(audit.id);
      }
      
      db.prepare('DELETE FROM audits WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM project_pages WHERE project_id = ?').run(id);
      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      
      if (result.changes === 0) {
        throw new Error('Project not found');
      }
    })();
    res.json({ success: true, message: 'Project and all related data deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/pages
app.get('/api/projects/:id/pages', (req, res) => {
  try {
    const pages = db.prepare('SELECT * FROM project_pages WHERE project_id = ?').all(req.params.id);
    res.json(pages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/crawl
app.post('/api/projects/:id/crawl', async (req, res) => {
  const { id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({error: 'Project not found'});
  
  // Return immediately so UI doesn't hang on crawl
  res.json({ success: true, message: 'Crawl started in background' });
  
  try {
    console.log(`Starting crawl for project ${id} at ${project.base_url}`);
    const pages = await crawlSite(project.base_url);
    const insertPage = db.prepare('INSERT INTO project_pages (project_id, url, created_at) VALUES (?, ?, ?)');
    const checkExists = db.prepare('SELECT id FROM project_pages WHERE project_id = ? AND url = ?');
    
    db.transaction(() => {
      for (const p of pages) {
        const exists = checkExists.get(id, p);
        if (!exists) {
          insertPage.run(id, p, new Date().toISOString());
        }
      }
    })();
    console.log(`Crawl finished. Inserted ${pages.length} pages.`);
  } catch (err) {
    console.error('Crawl error:', err);
  }
});

// POST /api/projects/:id/pages (Manual URL addition)
app.post('/api/projects/:id/pages', (req, res) => {
  const { id } = req.params;
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const info = db.prepare('INSERT INTO project_pages (project_id, url, created_at) VALUES (?, ?, ?)')
                   .run(id, url, new Date().toISOString());
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/export (CSV Export)
app.get('/api/projects/:id/export', (req, res) => {
  const { id } = req.params;
  try {
    const findings = db.prepare(`
      SELECT f.*, COALESCE(p.url, a.url) as page_url 
      FROM findings f 
      LEFT JOIN project_pages p ON f.page_id = p.id
      JOIN audits a ON f.audit_id = a.id
      WHERE a.project_id = ?
      ORDER BY f.created_at DESC
    `).all(id);

    if (findings.length === 0) {
      return res.status(404).send('No findings found to export');
    }

    const headers = ['ID', 'Page URL', 'Tool', 'Category', 'Severity', 'Title', 'Status', 'False Positive'];
    const rows = findings.map(f => [
      f.id,
      f.page_url || '',
      f.source_tool || '',
      f.category || '',
      f.severity || '',
      `"${(f.title || '').replace(/"/g, '""')}"`, // escape quotes for CSV
      f.status || 'open',
      f.is_false_positive ? 'Yes' : 'No'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="project_${id}_findings.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// GET /api/audits - Returns all audits ordered by started_at DESC
app.get('/api/audits', (req, res) => {
  try {
    const audits = db.prepare('SELECT * FROM audits ORDER BY started_at DESC').all();
    res.json(audits);
  } catch (error) {
    console.error('Error fetching audits:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/audits
app.get('/api/projects/:id/audits', (req, res) => {
  try {
    const audits = db.prepare('SELECT * FROM audits WHERE project_id = ? ORDER BY started_at DESC').all(req.params.id);
    res.json(audits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/audits/:id
app.delete('/api/audits/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.transaction(() => {
      // Delete fix tracker entries related to these findings
      db.prepare('DELETE FROM fix_tracker WHERE finding_id IN (SELECT id FROM findings WHERE audit_id = ?)').run(id);
      // Delete findings
      db.prepare('DELETE FROM findings WHERE audit_id = ?').run(id);
      // Delete audit
      db.prepare('DELETE FROM audits WHERE id = ?').run(id);
    })();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/findings
app.get('/api/projects/:id/findings', (req, res) => {
  try {
    const findings = db.prepare(`
      SELECT f.*, p.url as page_url 
      FROM findings f 
      LEFT JOIN project_pages p ON f.page_id = p.id
      JOIN audits a ON f.audit_id = a.id
      WHERE a.project_id = ?
      ORDER BY f.created_at DESC
    `).all(req.params.id);
    
    // Attach diff info
    const findingsWithDiffs = findings.map(finding => {
      const fix = db.prepare('SELECT * FROM fix_tracker WHERE finding_id = ?').get(finding.id);
      if (fix) {
        finding.after_screenshot_path = fix.after_screenshot;
        finding.diff_image_path = fix.diff_image;
        finding.diff_percentage = fix.diff_percentage;
        finding.diff_pixels = fix.diff_pixels;
      }
      return finding;
    });
    
    res.json(findingsWithDiffs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id/active-audits
app.get('/api/projects/:id/active-audits', (req, res) => {
  try {
    const audits = db.prepare(`SELECT * FROM audits WHERE project_id = ? AND status = 'running'`).all(req.params.id);
    res.json(audits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/findings/:auditId', (req, res) => {
  try {
    const { auditId } = req.params;
    const findings = db.prepare('SELECT * FROM findings WHERE audit_id = ?').all(auditId);
    
    // Also attach diff info if available
    const findingsWithDiffs = findings.map(finding => {
      const fix = db.prepare('SELECT * FROM fix_tracker WHERE finding_id = ?').get(finding.id);
      if (fix) {
        finding.after_screenshot_path = fix.after_screenshot;
        finding.diff_image_path = fix.diff_image;
        finding.diff_percentage = fix.diff_percentage;
        finding.diff_pixels = fix.diff_pixels;
      }
      return finding;
    });
    
    res.json(findingsWithDiffs);
  } catch (error) {
    console.error('Error fetching findings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/findings/:id - Updates a finding's status, is_false_positive, and notes
app.patch('/api/findings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { status, is_false_positive, notes } = req.body;
    
    const result = db.prepare(
      'UPDATE findings SET status = ?, is_false_positive = ?, notes = ? WHERE id = ?'
    ).run(status, is_false_positive ? 1 : 0, notes, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Finding not found' });
    }
    
    res.json({ success: true, changes: result.changes });
  } catch (error) {
    console.error('Error updating finding:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id
app.put('/api/projects/:id', (req, res) => {
  try {
    const { local_path } = req.body;
    const stmt = db.prepare(`UPDATE projects SET local_path = ? WHERE id = ?`);
    stmt.run(local_path || null, req.params.id);
    res.json({ success: true, local_path });
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// POST /api/audits/:id/ai-summary - Generates summary and tasks via Gemini
app.post('/api/audits/:id/ai-summary', async (req, res) => {
  try {
    const { id } = req.params;
    const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    // If already generated, return cached version (unless force parameter is true)
    if (audit.ai_summary && audit.ai_tasks && req.query.force !== 'true') {
      return res.json({
        summary: audit.ai_summary,
        tasks: JSON.parse(audit.ai_tasks)
      });
    }

    if (!process.env.GEMINI_API_KEY && !process.env.XAI_API_KEY) {
      return res.status(500).json({ error: 'No AI API key configured. Set GEMINI_API_KEY or XAI_API_KEY in .env' });
    }

    const findings = db.prepare('SELECT * FROM findings WHERE audit_id = ?').all(id);
    if (findings.length === 0) {
      return res.json({
        summary: 'No findings recorded for this audit.',
        tasks: []
      });
    }

    const uniqueFindings = [];
    const seen = new Set();
    const severityStats = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    const categoryStats = {};

    for (const f of findings) {
      severityStats[f.severity] = (severityStats[f.severity] || 0) + 1;
      categoryStats[f.category] = (categoryStats[f.category] || 0) + 1;

      const key = `${f.category}:${f.severity}:${f.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFindings.push({
          category: f.category,
          severity: f.severity,
          title: f.title,
          description: f.description
        });
      }
    }

    let techStackTags = [];
    if (audit.project_id) {
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(audit.project_id);
      if (project && project.tech_stack) {
        try {
          techStackTags = JSON.parse(project.tech_stack);
        } catch (e) {}
      }
    }

    const summaryModel = 'gemini-2.5-pro';

    const systemPrompt = 'You are an expert web developer and accessibility specialist acting as an AI assistant for a developer/Content Administrator auditing their site. Always respond with valid JSON only — no markdown, no code fences.';

    const prompt = `Analyze the following test findings for a website audit:

Audit URL: ${audit.url}
Lighthouse Scores: Performance: ${audit.lighthouse_perf || 'N/A'}, Accessibility: ${audit.lighthouse_a11y || 'N/A'}, SEO: ${audit.lighthouse_seo || 'N/A'}
Detected Tech Stack: ${techStackTags.length > 0 ? techStackTags.join(', ') : 'None detected'}

Findings Summary Stats:
- Total Findings: ${findings.length}
- By Severity: Critical: ${severityStats.critical}, Serious: ${severityStats.serious}, Moderate: ${severityStats.moderate}, Minor: ${severityStats.minor}
- By Category: ${JSON.stringify(categoryStats)}

Detailed Findings (Aggregated):
${uniqueFindings.slice(0, 100).map((f, i) => `${i+1}. [${f.category.toUpperCase()} | ${f.severity.toUpperCase()}] ${f.title} - ${f.description || 'No description'}`).join('\n')}

Generate:
1. A concise, professional executive summary in markdown. The summary MUST consist of EXACTLY these two main headings and sections (do not include any other parent headings):
   - ## 🖥️ Desktop Analysis & Summary
     Summarize standard desktop-related findings (Performance, Accessibility, SEO, Console, Network, Links). State the general usability and speed of the desktop experience.
   - ## 📱 Mobile Responsiveness Analysis
     Summarize design-related mobile viewport findings (Design category, Gemini-Vision annotations). Highlight layout bugs, spacing issues, truncated text, and element collisions on mobile screens.
   Do not mention finding database IDs in the summary.
2. A prioritized action items list (check list).
   - Priority 1: Critical/Serious findings.
   - Priority 2: Moderate findings.
   - Priority 3: Minor findings.
   - Ensure each task has a clear title, a description (mentioning whether it is a Desktop fix or Mobile responsiveness fix), priority (1, 2, or 3), and category.
   - **Tech Stack Customization**: Since the site's detected tech stack is "${techStackTags.length > 0 ? techStackTags.join(', ') : 'None/Vanilla CSS'}", tailor the descriptions and titles of the tasks to give platform-specific advice.

You MUST respond with a JSON object of this structure:
{
  "summary": "markdown string of the summary",
  "tasks": [
    {
      "priority": 1,
      "title": "Task Title",
      "description": "How to resolve it...",
      "category": "accessibility"
    }
  ]
}
Return ONLY valid JSON.`;

    const { text: rawText, modelUsed } = await callAI({ prompt, systemPrompt, jsonMode: true, model: summaryModel });

    let resultJson;
    try {
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      resultJson = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse AI JSON output:', rawText);
      throw new Error('Invalid JSON format returned from AI.');
    }

    const summary = resultJson.summary || 'Summary generation failed.';
    const tasks = resultJson.tasks || [];
    tasks.forEach(t => {
      t.id = Math.random().toString(36).substr(2, 9);
      t.status = 'open';
      t.agentNotes = '';
    });
    const tasksStr = JSON.stringify(tasks);

    // Save to database
    db.prepare('UPDATE audits SET ai_summary = ?, ai_tasks = ? WHERE id = ?')
      .run(summary, tasksStr, id);

    res.json({ summary, tasks, modelUsed });
  } catch (err) {
    console.error('AI Summary Error:', err);
    res.status(500).json({ error: 'Failed to generate audit summary. Check server logs.' });
  }
});

// GET /api/audits/:id/summary - Retrieves cached summary and tasks
app.get('/api/audits/:id/summary', (req, res) => {
  try {
    const { id } = req.params;
    const audit = db.prepare('SELECT ai_summary, ai_tasks FROM audits WHERE id = ?').get(id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    res.json({
      summary: audit.ai_summary || null,
      tasks: audit.ai_tasks ? JSON.parse(audit.ai_tasks) : null
    });
  } catch (err) {
    console.error('Error fetching cached summary:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/audits/:id/pdf - Generates or downloads A4 PDF report
app.get('/api/audits/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    // Simple IP rate limit (max 3 PDFs per day)
    const ip = req.ip || 'local';
    const today = new Date().toISOString().split('T')[0];
    const rateKey = `${ip}:${today}`;
    const currentCount = pdfGenerationCounts.get(rateKey) || 0;
    
    // Allow bypassing rate limits for localhost / dev
    const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === 'local';
    if (currentCount >= 3 && !isLocal && req.query.bypass !== 'true') {
      return res.status(429).json({ error: 'Limita de descărcare a raportului PDF a fost atinsă (maxim 3 descărcări pe zi).' });
    }
    pdfGenerationCounts.set(rateKey, currentCount + 1);

    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const pdfFileName = `audit-${id}-${Date.now()}.pdf`;
    const pdfPath = path.join(reportsDir, pdfFileName);

    // Call PDF generator
    await generatePdfReport(id, db, pdfPath);

    // Send download
    res.download(pdfPath, `Raport-Audit-${audit.url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9.-]/g, '_')}.pdf`);
  } catch (err) {
    console.error('Error generating PDF report route:', err);
    res.status(500).json({ error: err.message || 'Failed to generate PDF.' });
  }
});

// POST /api/leads - Handles lead capture form submissions
app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, company, url } = req.body;
    if (!name || !email || !url) {
      return res.status(400).json({ error: 'Numele, emailul și URL-ul sunt obligatorii.' });
    }

    console.error(`[LEAD] New lead capture submission: Nume: ${name}, Email: ${email}, Companie: ${company || 'N/A'}, URL: ${url}`);
    
    // 1. Post to PerfexCRM (STUB)
    const crmResult = await postLeadToPerfexCRM({ name, email, company, url });
    
    // 2. Send email notification (STUB)
    await sendReportEmail(null, 'admin@softsite.ro');

    res.json({
      success: true,
      message: 'Cererea dvs. a fost înregistrată! Vă vom trimite raportul PDF pe email în cel mai scurt timp.',
      leadId: crmResult.leadId
    });
  } catch (err) {
    console.error('Lead capture error:', err);
    res.status(500).json({ error: 'A apărut o eroare la înregistrarea cererii.' });
  }
});

// PUT /api/audits/:id/tasks/:taskId - Updates a specific task's status and notes
app.put('/api/audits/:id/tasks/:taskId', (req, res) => {
  try {
    const { id, taskId } = req.params;
    const { status, agentNotes } = req.body;

    const audit = db.prepare('SELECT ai_tasks FROM audits WHERE id = ?').get(id);
    if (!audit || !audit.ai_tasks) {
      return res.status(404).json({ error: 'Audit or tasks not found' });
    }

    const tasks = JSON.parse(audit.ai_tasks);
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (status !== undefined) tasks[taskIndex].status = status;
    if (agentNotes !== undefined) tasks[taskIndex].agentNotes = agentNotes;

    const updatedTasksStr = JSON.stringify(tasks);
    db.prepare('UPDATE audits SET ai_tasks = ? WHERE id = ?').run(updatedTasksStr, id);

    res.json({ success: true, tasks });
  } catch (err) {
    console.error('Error updating task:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});
// POST /api/findings/:id/propose-fix - Proposes a code fix for a finding using Gemini
app.post('/api/findings/:id/propose-fix', async (req, res) => {
  try {
    const { id } = req.params;
    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });

    let pattern = null;
    if (finding.fix_pattern_key) {
      pattern = db.prepare('SELECT * FROM fix_patterns WHERE pattern_key = ?').get(finding.fix_pattern_key);
    }

    if (pattern) {
      const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(finding.audit_id);
      let localPath = null;
      if (audit && audit.project_id) {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(audit.project_id);
        if (project && project.local_path) {
          localPath = project.local_path;
        }
      }

      const fileContext = localPath ? findMatchingFile(localPath, finding) : null;
      if (fileContext && fileContext.filePath) {
        // Read file, send to Gemini with pattern guidelines
        const fixResult = await proposeFix(finding, fileContext, pattern, 'gemini-2.5-flash');
        return res.json(fixResult);
      } else {
        // Return pattern's generic fix (no AI call)
        return res.json({
          has_file_fix: false,
          file_path: null,
          original_code: finding.html_snippet || 'N/A',
          replacement_code: pattern.remediation,
          explanation: `**Efort estimat:** ${pattern.estimated_hours_low}-${pattern.estimated_hours_high} ore.\n\n**Ghid de remediere:**\n${pattern.remediation}`
        });
      }
    } else {
      // If no pattern matched
      return res.json({
        has_file_fix: false,
        file_path: null,
        original_code: finding.html_snippet || 'N/A',
        replacement_code: '',
        explanation: 'Nu există o remediere automată definită pentru această eroare. Vă rugăm să analizați manual codul sursă al paginii.'
      });
    }
  } catch (err) {
    console.error('Propose Fix Error:', err);
    res.status(500).json({ error: err.message || 'Failed to propose fix.' });
  }
});

// POST /api/findings/:id/apply-fix - Writes the proposed code fix directly to the source file
app.post('/api/findings/:id/apply-fix', async (req, res) => {
  try {
    const { id } = req.params;
    const { file_path, original_code, replacement_code } = req.body;
    if (!file_path || !original_code || !replacement_code) {
      return res.status(400).json({ error: 'Missing parameters in body' });
    }

    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });

    const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(finding.audit_id);
    if (!audit || !audit.project_id) return res.status(400).json({ error: 'Project not linked' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(audit.project_id);
    if (!project || !project.local_path) return res.status(400).json({ error: 'Local path not set' });

    // Security check: Ensure file_path resides within local_path
    const absoluteLocalPath = path.resolve(project.local_path);
    const absoluteFilePath = path.resolve(file_path);
    if (!absoluteFilePath.startsWith(absoluteLocalPath)) {
      return res.status(403).json({ error: 'Security violation: Target file path is outside the project directory.' });
    }

    if (!fs.existsSync(absoluteFilePath)) {
      return res.status(404).json({ error: 'Target source file does not exist.' });
    }

    const fileContent = fs.readFileSync(absoluteFilePath, 'utf8');
    if (!fileContent.includes(original_code)) {
      return res.status(400).json({ error: 'Source file has changed. Original code snippet not found.' });
    }

    const updatedContent = fileContent.replace(original_code, replacement_code);
    fs.writeFileSync(absoluteFilePath, updatedContent, 'utf8');

    // Update database finding status and log the action in notes
    const updateNotes = (finding.notes || '') + '\n[AI] Applied code fix automatically.';
    db.prepare("UPDATE findings SET status = 'fixed', notes = ? WHERE id = ?").run(updateNotes, id);

    res.json({ success: true, message: 'Fix applied successfully to local file.' });
  } catch (err) {
    console.error('Apply Fix Error:', err);
    res.status(500).json({ error: err.message || 'Failed to apply fix.' });
  }
});

// POST /api/findings/:id/verify-fix - targeted sandbox re-audit for a specific finding
app.post('/api/findings/:id/verify-fix', async (req, res) => {
  let browser;
  try {
    const { id } = req.params;
    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    if (!finding) return res.status(404).json({ error: 'Finding not found' });

    const audit = db.prepare('SELECT * FROM audits WHERE id = ?').get(finding.audit_id);
    if (!audit) return res.status(404).json({ error: 'Audit not found' });

    const url = audit.url;
    let isFixed = false;
    let details = 'Verification completed.';

    if (finding.source_tool === 'axe') {
      // Accessibility Targeted verification
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const violations = await runAxe(page);
      
      // Check if the specific accessibility violation selector is still violating
      const stillViolates = violations.some(v => v.id === finding.title && v.nodes.some(n => n.target && n.target[0] === finding.selector));
      isFixed = !stillViolates;
      details = isFixed ? 'Accessibility selector passed Axe check.' : 'Axe accessibility violation still present.';
      await browser.close();
      browser = null;
    } else if (finding.source_tool === 'lighthouse') {
      // Performance metric re-test
      const { lhr, error } = await runLighthouse(url);
      if (error) throw new Error(error);
      
      const newAudit = lhr.audits[finding.title];
      if (newAudit) {
        // If score is high (> 0.70) or status is passed, it is resolved
        isFixed = newAudit.score === null || newAudit.score > 0.70;
        details = `Lighthouse score for "${finding.title}" is ${newAudit.score || 'N/A'}`;
      } else {
        isFixed = true; // metric gone
        details = 'Audit metric not found in new Lighthouse report.';
      }
    } else if (finding.source_tool === 'playwright') {
      // Console/Network errors verification
      browser = await chromium.launch();
      const page = await browser.newPage();
      const consoleErrors = [];
      const failedRequests = [];
      
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', err => consoleErrors.push(err.message));
      page.on('requestfailed', req => failedRequests.push(req));

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      
      if (finding.category === 'console') {
        const stillFails = consoleErrors.some(err => err.includes(finding.description) || finding.description.includes(err));
        isFixed = !stillFails;
        details = isFixed ? 'Console error no longer detected.' : 'Console error still detected.';
      } else {
        // Network
        const stillFails = failedRequests.some(req => req.url() === finding.source_url);
        isFixed = !stillFails;
        details = isFixed ? 'Network request completed successfully.' : 'Network request still failing.';
      }
      await browser.close();
      browser = null;
    } else if (finding.source_tool === 'gemini-vision') {
      // Design / Mobile checks verification
      // 1. Take a screenshot of the component under Mobile Pixel 5 viewport emulation
      const pixel5 = devices['Pixel 5'];
      browser = await chromium.launch();
      const context = await browser.newContext({ ...pixel5 });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Scroll component into view
      if (finding.selector) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView();
        }, finding.selector);
        await page.waitForTimeout(500);
      }
      
      const newScreenshotName = `verify-highlight-${finding.id}-${Date.now()}.png`;
      const newScreenshotPath = path.resolve(process.cwd(), 'reports/screenshots', newScreenshotName);
      
      const elementHandle = finding.selector ? await page.$(finding.selector) : page;
      if (elementHandle) {
        await elementHandle.screenshot({ path: newScreenshotPath });
      } else {
        await page.screenshot({ path: newScreenshotPath });
      }
      await browser.close();
      browser = null;

      // 2. Perform visual diff comparison using pixelmatch
      const beforeImgPath = finding.evidence_path ? path.resolve(process.cwd(), finding.evidence_path) : null;
      if (beforeImgPath && fs.existsSync(beforeImgPath) && fs.existsSync(newScreenshotPath)) {
        try {
          const beforePng = PNG.sync.read(fs.readFileSync(beforeImgPath));
          const afterPng = PNG.sync.read(fs.readFileSync(newScreenshotPath));
          
          // Ensure dimensions match
          if (beforePng.width === afterPng.width && beforePng.height === afterPng.height) {
            const { width, height } = beforePng;
            const diffPng = new PNG({ width, height });
            
            const numDiffPixels = pixelmatch(
              beforePng.data,
              afterPng.data,
              diffPng.data,
              width,
              height,
              { threshold: 0.1 }
            );
            
            const diffPct = (numDiffPixels / (width * height)) * 100;
            const diffFilename = `diff-verify-${finding.id}-${Date.now()}.png`;
            const diffFilepath = path.resolve(process.cwd(), 'reports/screenshots', diffFilename);
            
            fs.writeFileSync(diffFilepath, PNG.sync.write(diffPng));
            
            // Save metrics to fix_tracker table
            db.prepare('DELETE FROM fix_tracker WHERE finding_id = ?').run(finding.id);
            db.prepare(`
              INSERT INTO fix_tracker (finding_id, before_screenshot, after_screenshot, diff_image, diff_pixels, diff_percentage, verified, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              finding.id,
              finding.evidence_path,
              `reports/screenshots/${newScreenshotName}`,
              `reports/screenshots/${diffFilename}`,
              numDiffPixels,
              diffPct,
              diffPct < 1.0 ? 1 : 0,
              new Date().toISOString()
            );
          }
        } catch (diffErr) {
          console.error('Pixelmatch error:', diffErr);
        }
      }

      // 3. Ask Gemini if the specific layout bug is resolved
      if (fs.existsSync(newScreenshotPath) && process.env.GEMINI_API_KEY) {
        const imageBase64 = fs.readFileSync(newScreenshotPath, 'base64');
        const visionPrompt = `
Analyze the mobile screenshot of this website component.
The previous audit flagged a mobile layout bug:
Issue Title: "${finding.title}"
Issue Description: "${finding.description}"

Check if this bug has been RESOLVED in the current screenshot.
Return ONLY a JSON object:
{
  "resolved": true,
  "explanation": "Why do you think it is resolved or still present?"
}
`;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            visionPrompt,
            { inlineData: { data: imageBase64, mimeType: 'image/png' } }
          ],
        });
        
        try {
          const cleanJson = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
          const result = JSON.parse(cleanJson);
          isFixed = result.resolved === true;
          details = `AI Vision: ${result.explanation}`;
        } catch (err) {
          console.error('Failed to parse Gemini verification output:', response.text);
        }
      }
    }

    if (isFixed) {
      db.prepare("UPDATE findings SET status = 'fixed' WHERE id = ?").run(id);
    }

    res.json({ success: true, isFixed, details });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('Verify Fix Error:', err);
    res.status(500).json({ error: err.message || 'Failed to verify fix.' });
  }
});

// GET /api/projects/:id/history - Returns Lighthouse score history for plotting charts
app.get('/api/projects/:id/history', (req, res) => {
  try {
    const { id } = req.params;
    const history = db.prepare(`
      SELECT started_at, lighthouse_perf, lighthouse_a11y, lighthouse_seo 
      FROM audits 
      WHERE project_id = ? AND status = 'done'
      ORDER BY started_at ASC
    `).all(id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Site Test Tool Dashboard running at http://localhost:${port}`);
});
