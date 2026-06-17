# Roadmap — Site Test Tool v1

> 4 phases | 17 requirements mapped | All v1 requirements covered ✓
> Granularity: Coarse | Mode: YOLO | Parallelization: Yes

---

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | CLI Engine | 3/3 | Complete    | 2026-06-17 |
| 2 | Dashboard + Fix Tracker | 3/3 | Complete    | 2026-06-17 |
| 3 | MCP Server | 2/2 | Complete   | 2026-06-17 |
| 4 | Agent Skill + Polish | 2/2 | Complete   | 2026-06-17 |
| 5 | Project & Multi-Page Engine | 0/3 | Pending | TBD |

---

## Phase 1: CLI Engine

**Goal:** A working `node audit.js <url>` CLI that runs all 5 audit engines (Playwright capture, Lighthouse, axe-core, linkinator) and writes normalized findings to SQLite + a JSON report file.

**Requirements:**
- AUDIT-01: Console errors + JS exceptions + network failures + screenshot via Playwright
- AUDIT-02: Lighthouse scores (perf/a11y/SEO/best-practices) via Node API
- AUDIT-03: axe-core WCAG 2.1 AA violations via `@axe-core/playwright`
- AUDIT-04: Broken link scan at depth 1 via linkinator
- AUDIT-05: All findings normalized into unified shape → SQLite
- AUDIT-06: JSON report file per audit run in `reports/`
- DATA-01: SQLite auto-initialized on first run
- DATA-02: `audits` table schema
- DATA-03: `findings` table schema
- DATA-04: `fix_tracker` table schema (created now, used in Phase 2)

**Plans:**
3/3 plans complete
2. **Playwright capture engine** — `src/engines/playwright-capture.js` (console, network, screenshot)
3. **Lighthouse + axe runner** — `src/engines/lighthouse-runner.js` + `src/engines/axe-runner.js`
4. **Linkinator runner** — `src/engines/link-checker.js`
5. **Normalizer + CLI entry point** — `src/normalize.js` + `audit.js` CLI orchestrator + `reports/` output

**Success Criteria:**
1. `node audit.js https://example.com` completes without crashing
2. SQLite DB contains ≥1 row in `audits` and ≥5 rows in `findings` from at least 3 source tools
3. `reports/audit-<timestamp>.json` exists with findings grouped by severity
4. `reports/screenshots/` contains a full-page screenshot
5. Console output shows: total findings count, breakdown by category, benchmark pass/fail

**UAT:**
- Run against a real client URL (e.g., istyle.ro or klap.ro)
- Verify findings include at least: 1 console signal, 1 Lighthouse flag, 1 axe violation, 1 linkinator result
- Verify JSON report is readable and well-structured

---

## Phase 2: Dashboard + Fix Tracker

**Goal:** An Express web dashboard where you can triage findings from any audit run — filter by severity/category, mark false positives, add notes, and view before/after/diff screenshots for fixed issues.

**Requirements:**
- DASH-01: List audit runs with URL, date, Lighthouse summary
- DASH-02: View findings, filterable by severity and category
- DASH-03: Mark false positive, add note, change status (open/fixed/wontfix)
- DASH-04: Before/after/diff screenshot side-by-side view
- DIFF-01: `node compare.js <findingId>` captures "after" screenshot + runs pixelmatch
- DIFF-02: Outputs diff_pixels, diff_percentage, diff image path

**Plans:**
3/3 plans complete
2. **Dashboard HTML/CSS** — `public/index.html` with audit list and findings table with filters
3. **Finding detail + triage panel** — inline edit for status/notes/false-positive flag
4. **Before/after/diff UI** — side-by-side screenshot viewer using stored paths
5. **`compare.js` script** — pixelmatch runner, stores diff in `fix_tracker`, returns metrics

**Success Criteria:**
1. `npm start` opens dashboard at `localhost:3000`
2. Can see all audit runs with Lighthouse scores
3. Can filter findings by category and severity
4. Can mark a finding as fixed and add a note — change persists in SQLite
5. Can run `node compare.js <id>` and see diff image in dashboard

**UAT:**
- Triage a real client audit end-to-end: filter to critical, mark 2 as false positive, mark 1 as fixed after applying a CSS change, view the diff

---

## Phase 3: MCP Server

**Goal:** Wrap the audit engine as an MCP stdio server so Antigravity can call `run_audit()`, `get_findings()`, and `compare_screenshots()` as agent tools. Register in both MCP config files.

**Requirements:**
- MCP-01: `run_audit(url)` tool
- MCP-02: `get_findings(auditId)` tool
- MCP-03: `compare_screenshots(findingId)` tool
- MCP-04: MCP Inspector validation passes
- MCP-05: Entry added to `~/.gemini/config/mcp_config.json` and `antigravity-ide/mcp_config.json`

**Plans:**
2/2 plans complete
2. **Tool implementations** — wire `run_audit`, `get_findings`, `compare_screenshots` to existing engine/db code
3. **Build + Inspector validation** — `npm run build`, test with `npx @modelcontextprotocol/inspector`
4. **Registration** — add `site-audit` entry to both MCP config files, reload Antigravity, approve tool

**Critical Rules (from blueprint):**
- Write diagnostics to **stderr only** — stdout is JSON-RPC; any `console.log` corrupts protocol
- Return typed text strings, not nested objects — some clients truncate
- Test in MCP Inspector before registering in Antigravity

**Success Criteria:**
1. MCP Inspector shows `run_audit`, `get_findings`, `compare_screenshots` tools with correct schemas
2. Calling `run_audit("https://example.com")` via Inspector returns audit ID and summary
3. In Antigravity, saying "audit example.com and show me the critical findings" triggers the tool and returns stored findings without manual scripting

**UAT:**
- New Antigravity chat → "audit klap.ro" → agent calls `run_audit` → agent calls `get_findings` → agent presents findings in chat

---

## Phase 4: Agent Skill + Polish

**Goal:** Package the audit workflow as a SKILL.md so any agent session knows how to run audits, report findings, and verify fixes without being explicitly instructed. Final polish pass on CLI + dashboard.

**Requirements:**
- SKILL-01: SKILL.md at `~/.gemini/config/skills/site-audit-reporter/SKILL.md`
- SKILL-02: Skill references `scripts/audit.js` and `scripts/compare.js`
- SKILL-03: Skill guidelines: never invent findings, flag 403/999 as "needs manual check"

**Plans:**
2/2 plans complete
2. **Polish pass** — clean up CLI output, improve error messages, add `--help` flag
3. **Project README.md** — setup guide, dependency install, usage examples, MCP config snippet
4. **`.agents/skills/` copy** — add project-local skill copy at `<project>/.agents/skills/site-audit-reporter/`

**Success Criteria:**
1. A fresh Antigravity session with no explicit instructions, given "QA this site: klap.ro", runs the full audit via the skill, reports findings grouped by severity, and verifies a fix with before/after diff
2. README.md gives a new developer everything needed to set up in < 10 minutes
3. Skill appears in `~/.gemini/config/skills/` alongside other GSD skills

**UAT:**
- Start new Antigravity session → type "QA klap.ro" → agent self-selects skill → runs audit → reports clearly → verifies one fix

---

## Phase 5: Project & Multi-Page Engine

**Goal:** Transform the tool from a single-URL script to a project-based suite supporting recursive crawling, layout component detection, and granular per-page audit selections.

**Requirements:**
- V2-PROJ-01: Support creating "Projects" with a base URL
- V2-CRAWL-01: Site pages crawl via sitemap/Linkinator to discover all URLs
- V2-COMP-01: Single-page component crawl to output semantic layout areas
- V2-AUDIT-01: Selectable audit execution (Console/Network, Axe, Lighthouse) per-page
- V2-AUDIT-02: Site-wide broken links scan
- V2-DATA-01: Database migration for projects and project_pages

**Plans:**
0/3 plans complete

**Success Criteria:**
1. User can create a project via Dashboard.
2. User can trigger a crawl that populates the project with all discovered pages.
3. User can run accessibility/performance audits on a specific subset of those pages.
4. Minor Lighthouse issues (score > 0.70) are filtered out automatically.

**UAT:**
- Create project `softsite.ro`, crawl to find 5+ pages, run Axe on 2 of them, verify results are grouped correctly.

---

## Backlog (999.x)

- **999.1** — Pa11y second a11y engine (reconcile with axe findings)
- **999.2** — Recursive crawl / sitemap support (depth > 1)
- **999.3** — Antigravity SDK multi-agent pipeline (Researcher → Auditor → Fixer → Tester agents in Python)
- **999.4** — Postgres + Streamable HTTP MCP transport for hosted SaaS
- **999.5** — Performance budget alerts (Core Web Vitals thresholds)
- **999.6** — Scheduled audits / cron re-audit of registered URLs
- **999.7** — Firecrawl integration for advanced crawl + content extraction

---
*Generated: 2026-06-17 | Source: site-test-tool-blueprint-v1.md + MCP discovery session*
