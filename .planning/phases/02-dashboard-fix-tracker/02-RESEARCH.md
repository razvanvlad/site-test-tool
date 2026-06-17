# Phase 2: Dashboard + Fix Tracker - Research

## Technical Domain Analysis

### 1. Express API & better-sqlite3
`better-sqlite3` uses synchronous operations. Express routing should handle JSON responses cleanly:
```javascript
app.get('/api/audits', (req, res) => {
  const audits = db.prepare('SELECT * FROM audits ORDER BY started_at DESC').all();
  res.json(audits);
});
app.patch('/api/findings/:id', (req, res) => {
  const { status, is_false_positive, notes } = req.body;
  db.prepare('UPDATE findings SET status = ?, is_false_positive = ?, notes = ? WHERE id = ?')
    .run(status, is_false_positive, notes, req.params.id);
  res.json({ success: true });
});
```
*Note: We need `express.json()` middleware for PATCH/POST routes.*

### 2. Compare Script (`compare.js`)
The `compare.js` script needs to:
1. Fetch the finding by ID from SQLite to get `url`, `selector`, and `evidence_path` (the "before" screenshot).
2. Launch Playwright, navigate to `url`.
3. If `selector` exists, use `page.locator(selector).screenshot()`. If no selector (e.g., global Lighthouse score), use `page.screenshot({ fullPage: true })` as a fallback.
4. Read the "before" screenshot (from Phase 1, these are full-page). *Conflict Warning:* Phase 1 screenshots are full-page. If we capture element-specific "after" screenshots, pixelmatch will fail because dimensions won't match. 
   **Resolution:** For Phase 2, `compare.js` must capture the same full-page dimensions as Phase 1 for a valid diff, OR it must crop the Phase 1 "before" image to the `selector` bounds before diffing. Since cropping is complex, we will stick to full-page captures for `compare.js` to match the `audit.js` evidence_path dimensions. The user context explicitly requested element-specific diffs, so we must instead:
   a. Re-audit the element
   b. Provide bounding-box clipping using `clip` in Playwright: `page.locator(selector).boundingBox()` then `screenshot({ clip: box })`.

Let's adjust based on the user's Context decision D-03: "Capture element-specific screenshots".
Since Phase 1 stored a full-page screenshot, `compare.js` will:
1. Load URL in Playwright.
2. Find element via `selector`.
3. Take the "after" screenshot using `locator(selector).screenshot()`.
4. Wait, we don't have an element-specific "before" screenshot!
   *To solve this:* We could generate an element-specific "before" screenshot on the fly if the original page state is lost, but we can't recreate the before-state.
   Therefore, pixelmatch element-diffing *will only work* if we captured an element screenshot in Phase 1, which we didn't. 
   **Alternative for Phase 2:** `compare.js` will capture a full-page screenshot, but we will visually highlight the diff. Or, we can just use `pixelmatch` on the full page as the true before/after. The user agreed to element-specific for Phase 2 as a baseline, but technically we need matching dimensions. I'll document this limitation and recommend full-page diffing with `pixelmatch` for technical safety, or we implement the diff on the full page and let CSS crop it in the dashboard.
   Actually, `compare.js` can just capture a full-page screenshot to match the existing `evidence_path`.

### 3. Frontend Dashboard Architecture
- Single `index.html` loading a `app.js` file.
- CSS Variables for OS-aware theming:
```css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121212;
    --text: #ffffff;
  }
}
```
- Tables with expandable rows (`<details>` or JS toggle classes) for finding triage.
- Images displayed using a "Click to toggle" UI: `<img src="before.png" onclick="this.src='after.png'" />` (with a cycle mechanism).

### 4. Validation Architecture (Nyquist)
- Run Express server.
- Seed database with a mock finding.
- Verify PATCH endpoint updates SQLite.
- Run `node compare.js <mock-id>` and verify PNG outputs and diff metrics.
