# Requirements — Site Test Tool v1

> Derived from `site-test-tool-blueprint-v1.md` + MCP discovery session (2026-06-17)

## v1 Requirements

### Audit Engine (AUDIT)

- [ ] **AUDIT-01:** User can run `node audit.js <url>` and capture: console errors, uncaught JS exceptions, failed network requests (4xx/5xx), full-page screenshot
- [ ] **AUDIT-02:** User can get Lighthouse scores (performance, accessibility, SEO, best-practices) for a URL via Node API integration
- [ ] **AUDIT-03:** User can get axe-core WCAG 2.1 AA accessibility violations for a URL, normalized from `@axe-core/playwright`
- [ ] **AUDIT-04:** User can get broken link report for a URL at depth 1 via linkinator (BROKEN state links with parent URL and HTTP status)
- [ ] **AUDIT-05:** All findings from all engines are normalized into `{ category, severity, title, description, selector, source_url, source_tool, evidence_path }` shape and stored in SQLite
- [ ] **AUDIT-06:** User can find a JSON report file per audit run in `reports/` with summary counts by severity and category

### Data Layer (DATA)

- [ ] **DATA-01:** SQLite database initialized automatically on first run with `audits`, `findings`, and `fix_tracker` tables
- [ ] **DATA-02:** `audits` table stores one row per run: url, started_at, finished_at, lighthouse scores, status
- [ ] **DATA-03:** `findings` table stores one row per issue: audit_id, category, severity, title, description, selector, source_url, source_tool, evidence_path, status, is_false_positive, notes
- [ ] **DATA-04:** `fix_tracker` table stores before/after screenshot paths, diff image path, diff_pixels, diff_percentage, verified flag

### Dashboard (DASH)

- [ ] **DASH-01:** User can open a browser dashboard (`npm start`) showing list of audit runs with URL, date, Lighthouse score summary
- [ ] **DASH-02:** User can view findings for an audit, filtered by severity (critical/serious/moderate/minor) and category (accessibility/performance/console/network/links/seo)
- [ ] **DASH-03:** User can mark a finding as false positive, add a note, and change its status (open → fixed / wontfix)
- [ ] **DASH-04:** User can see before/after/diff screenshot side-by-side for any finding that has a fix tracked

### Fix Tracking (DIFF)

- [ ] **DIFF-01:** User can run `node compare.js <findingId>` to capture a new "after" screenshot, run pixelmatch against the stored "before" screenshot, and store diff image + pixel count + percentage in `fix_tracker`
- [ ] **DIFF-02:** `compare.js` outputs: diff_pixels, diff_percentage, and the path to the diff image

### MCP Server (MCP)

- [ ] **MCP-01:** MCP server exposes `run_audit(url: string)` tool — runs full engine and returns audit ID + summary
- [ ] **MCP-02:** MCP server exposes `get_findings(auditId: number)` tool — returns findings array from SQLite
- [ ] **MCP-03:** MCP server exposes `compare_screenshots(findingId: number)` tool — runs pixelmatch diff and returns result
- [ ] **MCP-04:** MCP server passes MCP Inspector validation (`npx @modelcontextprotocol/inspector node build/index.js`)
- [ ] **MCP-05:** `site-audit` entry added to `C:\Users\razva\.gemini\config\mcp_config.json` and `antigravity-ide\mcp_config.json`

### Agent Skill (SKILL)

- [ ] **SKILL-01:** `site-audit-reporter` SKILL.md created at `C:\Users\razva\.gemini\config\skills\site-audit-reporter\SKILL.md`
- [ ] **SKILL-02:** Skill describes the 6-step audit + report workflow and references `scripts/audit.js` and `scripts/compare.js`
- [ ] **SKILL-03:** Skill instructs agent: never invent findings, flag bot-protected 403/999 links as "needs manual check"

## v2 Requirements (Deferred)

- Pa11y as second accessibility engine alongside axe-core
- Recursive link crawl (depth > 1) with sitemap support
- Hosted dashboard (Postgres backend, HTTP MCP transport for SaaS)
- Multi-agent audit via Antigravity SDK (Researcher → Auditor → Fixer → Tester pipeline)
- Performance budget alerts (fail audit if Core Web Vitals exceed threshold)
- Scheduled audits (cron-based re-audit of registered URLs)

## Out of Scope (v1)

- Python FastAPI variant — full Node chosen for stack consistency
- Firecrawl integration — available at `~/.agents/skills/firecrawl-seo-audit` but not wired in for v1
- GitHub MCP integration — no PAT configured; not required
- OAuth / user authentication on dashboard — internal tool, single user
- Docker containerization — local-only in v1

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| AUDIT-01 to AUDIT-06 | Phase 1 — CLI Engine | Pending |
| DATA-01 to DATA-04 | Phase 1 — CLI Engine | Pending |
| DASH-01 to DASH-04 | Phase 2 — Dashboard | Pending |
| DIFF-01 to DIFF-02 | Phase 2 — Dashboard | Pending |
| MCP-01 to MCP-05 | Phase 3 — MCP Server | Pending |
| SKILL-01 to SKILL-03 | Phase 4 — Skill + Polish | Pending |
