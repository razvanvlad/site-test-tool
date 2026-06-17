# Phase 1: CLI Engine - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning
**Source:** Blueprint v2 + MCP Discovery Session

<domain>
## Phase Boundary

Phase 1 delivers a standalone Node.js CLI tool: `node audit.js <url>` that:
- Launches Chromium via Playwright
- Captures 5 signal types: console errors, JS exceptions, failed network requests, Lighthouse scores, axe-core a11y violations, broken links
- Takes a full-page screenshot
- Normalizes all engine output into a unified finding shape
- Stores everything in SQLite (audits + findings + fix_tracker tables)
- Writes a JSON report file to `reports/`

This phase does NOT include the dashboard, MCP server, or skill — only the CLI engine and data layer.

</domain>

<decisions>
## Implementation Decisions

### Browser Engine
- Playwright with Chromium — confirmed choice
- Use `chromium.launch()` not `chromium.connect()` — standalone browser, not Antigravity's
- `waitUntil: 'networkidle'` for page load (catches late-loading scripts)
- Full-page screenshots via `page.screenshot({ fullPage: true })`

### Console/Network Capture
- `page.on('console', ...)` for console errors (filter `msg.type() === 'error'`)
- `page.on('pageerror', ...)` for uncaught JS exceptions
- `page.on('requestfailed', ...)` for failed requests
- `page.on('response', ...)` for 4xx/5xx HTTP responses
- Store: message text, URL, error text / HTTP status

### Lighthouse
- Use Lighthouse Node API (`import lighthouse from 'lighthouse'`) with `chrome-launcher`
- NOT `playwright-lighthouse` — use separate Chrome instance to avoid port conflicts
- Extract: performance, accessibility, SEO, best-practices scores
- Extract individual audit failures as findings
- Lighthouse runs one audit per process — sequential, no concurrency

### axe-core
- `@axe-core/playwright` — inject into Playwright page after load
- `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()`
- Map violations to findings: severity from axe impact (critical/serious/moderate/minor)
- Include: violation ID, description, affected nodes (selectors), help URL

### Link Checking
- `linkinator` at depth 1 (no recursive crawl)
- Filter for `state: 'BROKEN'` links
- Flag 403/999 responses as "needs manual check" (bot protection), not "broken"
- Store: source URL, target URL, HTTP status, parent page

### Data Layer
- `better-sqlite3` for synchronous SQLite access
- DB path: `data/audit.db` (auto-created on first run)
- Schema: 3 tables (audits, findings, fix_tracker)
- fix_tracker created now but populated in Phase 2

### Normalization
- Every engine adapter returns: `{ category, severity, title, description, selector, source_url, source_tool, evidence_path }`
- Categories: accessibility, performance, console, network, links, seo
- Severities: critical, serious, moderate, minor
- `source_tool`: playwright, lighthouse, axe, linkinator

### CLI Output
- `audit.js` is the entry point — `node audit.js <url>`
- Creates `reports/audit-<timestamp>.json` with full findings
- Creates `reports/screenshots/<timestamp>-full.png`
- Console output: summary table with counts by category and severity
- Exit code 0 on success (regardless of findings count)

### Agent's Discretion
- Directory structure within `src/` — agent chooses file layout
- Error handling strategy — agent decides graceful vs. fail-fast per engine
- Timeout values for page load and individual engines
- Whether to run engines sequentially or partially in parallel

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — full technology stack, requirements, decisions
- `.planning/REQUIREMENTS.md` — REQ-IDs AUDIT-01 through AUDIT-06, DATA-01 through DATA-04
- `GEMINI.md` — project guide with critical technical notes

### Technical Reference
- `site-test-tool-blueprint-v2.md` — full code examples for Playwright capture, Lighthouse API, axe-core, linkinator, schema SQL, normalization pattern

</canonical_refs>

<specifics>
## Specific Ideas

- Playwright capture code is in blueprint v2 §3 — verbatim usable
- Lighthouse Node API pattern is in blueprint v2 §4 — requires `chrome-launcher` as separate dependency
- Schema SQL is in blueprint v2 §5 — 3 tables, verbatim usable
- The `evidence_path` field in findings should be relative to project root, not absolute

</specifics>

<deferred>
## Deferred Ideas

- Pa11y as second a11y engine — v2 (backlog 999.1)
- Recursive link crawl depth > 1 — v2 (backlog 999.2)
- Before/after screenshot comparison (pixelmatch) — Phase 2 (DIFF-01, DIFF-02)
- Dashboard — Phase 2
- MCP server — Phase 3
- SKILL.md — Phase 4

</deferred>

---

*Phase: 01-cli-engine*
*Context gathered: 2026-06-17 via blueprint + discovery session*
