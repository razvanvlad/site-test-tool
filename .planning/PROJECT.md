# Site Test Tool — Project Context

## What This Is

A **local-first website audit engine** that captures real-browser signals — screenshots, console errors, JS exceptions, network failures, accessibility violations, broken links, and performance metrics — and stores them in SQLite for triage via a dashboard. Exposed to Antigravity as a custom MCP server so any agent can call `run_audit(url)` and retrieve findings programmatically. Also packaged as an Agent Skill (`SKILL.md`) so agents know the audit workflow without being explicitly instructed.

**Core Value:** A single `node audit.js <url>` command produces a structured findings report (SQLite + JSON) covering at least 5 signal types, suitable for presenting to clients as a first-pass QA deliverable.

## Context

- **Owner:** ABC Internal Projects — SoftSite / OnlineGSM
- **Location:** `G:\PROJECTS - WORK - CLIENTS -NEW PC\ABC INTERNAL PROJECTS - SOFTSITE - ONLINEGSM\Site-test-tool`
- **Purpose:** Internal tool for auditing client websites before/after fixes, tracking issues, and verifying fixes with before/after screenshot diffs
- **Runtime:** Node.js v24.13.1 (confirmed on machine)
- **Platform:** Windows 11, PowerShell
- **Antigravity integration:** MCP server registered in `C:\Users\razva\.gemini\config\mcp_config.json`

## Technology Stack (Confirmed)

| Layer | Choice | Rationale |
|---|---|---|
| Browser engine | Playwright (Chromium) | Cross-browser, auto-waiting, axe-core integration, best agentic ecosystem |
| Performance/SEO/a11y | Lighthouse (Node API) | LHR JSON output, programmatic, Node 22+ ✅ |
| Accessibility detail | @axe-core/playwright | WCAG 2.1 AA, low false-positive, integrates with Playwright page |
| Link checking | linkinator | BROKEN link events, handles 403/999 gracefully |
| Screenshot diff | pixelmatch + pngjs | Pixel-level diff with visual diff PNG output |
| Persistence | better-sqlite3 | Single-file DB, no server, fast inserts |
| Dashboard backend | Express | Lightweight, same language as audit engines |
| Dashboard frontend | Vanilla HTML/CSS/JS | No framework overhead, fast to ship |
| MCP server | @modelcontextprotocol/sdk | Official Node SDK for stdio transport |

## Pre-Existing Capabilities (Antigravity built-ins — do NOT re-implement)

- `chrome_devtools` MCP — **31 tools auto-bundled**: `lighthouse_audit`, `take_screenshot`, `take_snapshot`, `list_console_messages`, `list_network_requests`, `performance_start_trace/stop/analyze`, `screencast_start/stop`, `evaluate_script`, `take_memory_snapshot`
- `playwright` MCP — already registered and working
- Stitch MCP — design projects (Teluxo.ro, etc.)

## Requirements

### Validated
- ✓ Node.js v24.13.1 — installed
- ✓ Chrome — `C:\Program Files\Google\Chrome\Application\chrome.exe`
- ✓ MCP config at `C:\Users\razva\.gemini\config\mcp_config.json` — confirmed active
- ✓ Skills directory at `C:\Users\razva\.gemini\config\skills\` — 51 skills present

### Active

- [ ] **AUDIT-01:** `node audit.js <url>` captures console errors, JS exceptions, network failures (4xx/5xx), screenshots
- [ ] **AUDIT-02:** Lighthouse scores (perf, a11y, SEO, best-practices) per URL
- [ ] **AUDIT-03:** axe-core WCAG 2.1 AA violations per URL
- [ ] **AUDIT-04:** Linkinator broken-link scan (shallow, depth 1)
- [ ] **AUDIT-05:** All findings normalized and stored in SQLite (audits + findings tables)
- [ ] **AUDIT-06:** JSON report file output per audit run
- [ ] **DASH-01:** Express dashboard — list audits, list findings (filterable by severity/category)
- [ ] **DASH-02:** Mark finding as false positive, add notes, change status (open/fixed/wontfix)
- [ ] **DIFF-01:** Before/after screenshot capture + pixelmatch diff with pixel count + percentage
- [ ] **DIFF-02:** Side-by-side before/after/diff view in dashboard
- [ ] **MCP-01:** MCP server exposing `run_audit(url)`, `get_findings(auditId)`, `compare_screenshots(findingId)`
- [ ] **MCP-02:** Registered in `~/.gemini/config/mcp_config.json` and testable via MCP Inspector
- [ ] **SKILL-01:** `site-audit-reporter` SKILL.md at `~/.gemini/config/skills/site-audit-reporter/`
- [ ] **SKILL-02:** Skill references `scripts/audit.js` and `scripts/compare.js`

### Out of Scope (v1)

- Pa11y as second a11y engine — deferred to v2 (axe-core covers primary need)
- Multi-page crawl (depth > 1) — deferred; linkinator at depth 1 is sufficient for v1
- Hosted SaaS / Postgres — SQLite is the target; swap is documented but not built
- Python FastAPI variant — full Node stack chosen for consistency
- Firecrawl integration — already available at `~/.agents/skills/firecrawl-seo-audit` but not wired in
- GitHub MCP — removed (no PAT); not required for this project

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Node.js over Python | Single language across audit engines and MCP server | — Confirmed |
| Playwright over Puppeteer | Cross-browser, axe integration, agentic ecosystem | — Confirmed |
| better-sqlite3 over raw sqlite3 | Synchronous API, better Windows support | — Pending |
| Depth-1 link scan only | Avoid bot-protection issues on client sites | — Pending |
| Write to stderr only in MCP server | Stdout reserved for JSON-RPC — any console.log corrupts protocol | — Critical |
| MCP Inspector for pre-registration testing | Validate before wiring into Antigravity | — Required |
| Stage 3: Antigravity SDK for multi-agent | Python SDK for orchestrating Researcher → Auditor → Fixer agents in later milestone | — Future milestone note |

## Future Milestone Notes

### Antigravity SDK (Stage 4+)

The **Google Antigravity SDK** (Python) enables building custom autonomous agents. For this project's advanced milestone, consider building a **multi-agent audit system**:

- **Researcher agent** — scrapes site structure, identifies URL patterns
- **Auditor agent** — runs the audit engines per URL
- **Fixer agent** — generates fix suggestions per finding category
- **Tester agent** — verifies fixes using before/after screenshot diff

This replaces the simple CLI + dashboard with a coordinated agent team. Requires downloading the Antigravity SDK plugin and switching to Python for orchestration (the Node audit engine becomes a callable subprocess).

**When to do this:** After Stage 4 (Skill) is shipped and validated. Use `/gsd-new-milestone` to start this milestone.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-next`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-17 after initialization — blueprint v1 + MCP discovery session*
