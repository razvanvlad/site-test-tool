import express from 'express';
import { initDb } from './src/db.js';

const app = express();
const port = process.env.PORT || 3000;

// Initialize database
const db = initDb();

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/reports/screenshots', express.static('reports/screenshots')); // Serve screenshots

// API Routes

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

// GET /api/findings/:auditId - Returns all findings for a specific audit ID
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
