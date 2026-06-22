# Phase 6: AI Audit Summary and Task Recommendations Tabs — Research

## 1. Existing Gemini API Integration

### Server-side pattern (`server.js` L72–131)
- **SDK:** `@google/genai` (v2.8.0) — already installed, initialized at L6/L11:
  ```js
  import { GoogleGenAI } from '@google/genai';
  const ai = new GoogleGenAI({}); // Uses process.env.GEMINI_API_KEY
  ```
- **Call pattern:** `ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt })` → `response.text`
- **Existing endpoint:** `POST /api/findings/:id/ai-explain` (L72–131)
  - Fetches single finding from DB, builds a prompt, calls Gemini 2.5 Flash
  - Caches result in `findings.ai_explanation` column — returns cached on subsequent calls
  - Error handling: checks for missing GEMINI_API_KEY, wraps in try/catch
- **Second usage in `src/engines/mobile-ai-check.js`** (L104–110): same SDK, same model, uses `contents` array format for multi-modal (text + image).

### Key takeaway for Phase 6
Reuse the exact same SDK initialization and call pattern. Two new endpoints needed:
- `POST /api/audits/:id/ai-summary` — generate summary for all findings of an audit
- `POST /api/audits/:id/ai-tasks` — generate task recommendations from all findings

Both should cache results in new `audits` table columns (same pattern as `ai_explanation` on findings).

---

## 2. Database Schema — Current State

### `audits` table (`db/schema.sql` L17–25)
```sql
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  url TEXT NOT NULL,
  started_at TEXT, finished_at TEXT,
  lighthouse_perf REAL, lighthouse_a11y REAL, lighthouse_seo REAL,
  status TEXT,  -- running | done | error
  progress TEXT
);
```

### `findings` table (`db/schema.sql` L27–45)
```sql
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  page_id INTEGER REFERENCES project_pages(id),
  category TEXT,
  severity TEXT,
  title TEXT,
  description TEXT,
  selector TEXT,
  source_url TEXT,
  source_tool TEXT,
  evidence_path TEXT,
  html_snippet TEXT,
  ai_explanation TEXT,
  status TEXT DEFAULT 'open',
  is_false_positive INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT
);
```

### Schema migration needed
Add two TEXT columns to `audits`:
```sql
ALTER TABLE audits ADD COLUMN ai_summary TEXT;
ALTER TABLE audits ADD COLUMN ai_tasks TEXT;
```

**Recommendation:** Add try/catch ALTER TABLE in `db.js` after `db.exec(schema)`:
```js
try { db.exec('ALTER TABLE audits ADD COLUMN ai_summary TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE audits ADD COLUMN ai_tasks TEXT'); } catch(e) {}
```

---

## 3. Frontend Architecture — Current View Switching

### HTML structure (`public/index.html`)
The `#content` div (L84–131) contains:
1. `#findings-header-filters` — severity/category/status/page filter dropdowns
2. `#lighthouse-dials` — Lighthouse score circles (populated by JS)
3. `#findings-table` — the main findings table with `#findings-body` tbody
4. `#empty-state` — "Select a project" message

**There is NO existing tab system.** The tab bar should go between `#lighthouse-dials` and `#findings-table`.

### JavaScript view switching (`public/app.js`)
- `renderFindings()` (L362–571) is the main render function
- `currentAudits` array stores all audits for the selected project
- Audit dropdown drives which audit is displayed

### Tab switching implementation approach
1. Add a `currentTab` state variable (default: `'findings'`)
2. Tab clicks set `currentTab` and show/hide the corresponding panels
3. Summary and Tasks panels are rendered lazily — only call the API when the tab is first clicked

---

## 4. CSS Patterns

### Existing design language (`public/styles.css`)
- Dark theme via CSS variables + `prefers-color-scheme` media query
- Card pattern: `--bg-card` (#1f2937 dark), `border-radius: 8px`
- Badge pattern: `.badge` with severity/status color variants
- **No existing tab CSS** — must be created fresh

---

## 5. Prompt Templates (Draft)

### Summary Prompt
Should produce markdown with: Overview, Severity Breakdown, Key Issues by Category, Highlights.

### Tasks Prompt
Should produce markdown with: Priority 1 (Critical/Serious), Priority 2 (Moderate), Priority 3 (Minor).

### Token optimization
Compress findings into `{category, severity, title, count}` aggregated format before sending to handle audits with 100+ findings.

---

## 6. Rendering Markdown in the Frontend

### Existing `parseMarkdown()` function (`app.js` L696–706)
Handles bold, italic, paragraphs, bullet lists. Does NOT handle headers, tables, numbered lists. Must enhance for `##` headers and numbered lists at minimum.

---

## 7. File Change Summary

| File | Change Type | Description |
|------|------------|-------------|
| `db/schema.sql` | MODIFY | Add `ai_summary TEXT` and `ai_tasks TEXT` columns |
| `src/db.js` | MODIFY | Add ALTER TABLE migration for existing databases |
| `server.js` | MODIFY | Add 2 new endpoints |
| `public/index.html` | MODIFY | Add tab bar HTML, add summary/tasks panels |
| `public/styles.css` | MODIFY | Add tab CSS |
| `public/app.js` | MODIFY | Add tab switching, API calls, enhance parseMarkdown |
