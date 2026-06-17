import express from 'express';
import { initDb } from './src/db.js';
import { exec, spawn } from 'child_process';
import util from 'util';
import { crawlSite } from './src/engines/crawl.js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({}); // Uses process.env.GEMINI_API_KEY

const execPromise = util.promisify(exec);

const app = express();
const port = process.env.PORT || 3000;

// Initialize database
const db = initDb();

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

// POST /api/findings/:id/ai-explain - Uses Gemini to explain a finding
app.post('/api/findings/:id/ai-explain', async (req, res) => {
  try {
    const { id } = req.params;
    const finding = db.prepare('SELECT * FROM findings WHERE id = ?').get(id);
    
    if (!finding) return res.status(404).json({ error: 'Finding not found' });
    
    // If we already have an explanation, return it instantly
    if (finding.ai_explanation) {
      return res.json({ explanation: finding.ai_explanation });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set in .env file.' });
    }

    const prompt = `
You are an expert web developer and accessibility specialist acting as an AI assistant for a Content Administrator. 
The user found a bug/issue on their website using an automated testing tool.

Here are the technical details of the bug:
- Category: ${finding.category}
- Severity: ${finding.severity}
- Title: ${finding.title}
- Description: ${finding.description || 'N/A'}
- Selector: ${finding.selector || 'N/A'}
- Source URL (if any): ${finding.source_url || 'N/A'}
- HTML Snippet:
\`\`\`html
${finding.html_snippet || 'N/A'}
\`\`\`

Please provide a helpful, plain-English response. Your response should have two clear sections formatted exactly like this:

**What this means:**
[Explain the technical issue in simple, non-technical terms that a content administrator would understand. For example, if it's a 404, say "An image or video link is broken and failing to load."]

**How to fix it:**
[Give 1-3 practical, actionable steps on how they can fix this. Focus on what a content admin can do, like uploading a missing image in WordPress, fixing a typo in a link, or changing text colors for contrast. If it requires a developer, explicitly say "You will need to ask a developer to..."]
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const explanation = response.text;

    // Save to database
    db.prepare('UPDATE findings SET ai_explanation = ? WHERE id = ?').run(explanation, id);

    res.json({ explanation });
  } catch (err) {
    console.error('AI Explain Error:', err);
    res.status(500).json({ error: 'Failed to generate explanation. Check server logs.' });
  }
});

// POST /api/projects
app.post('/api/projects', (req, res) => {
  const { name, base_url } = req.body;
  if (!name || !base_url) return res.status(400).json({ error: 'Name and Base URL required' });
  try {
    const info = db.prepare('INSERT INTO projects (name, base_url, created_at) VALUES (?, ?, ?)')
                   .run(name, base_url, new Date().toISOString());
    res.json({ id: info.lastInsertRowid, name, base_url });
  } catch (err) {
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
      SELECT f.*, p.url as page_url 
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

// Start server
app.listen(port, () => {
  console.log(`Site Test Tool Dashboard running at http://localhost:${port}`);
});
