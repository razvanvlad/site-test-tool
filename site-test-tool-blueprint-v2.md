# Building a Local Website Audit Tool That Plugs Into Google Antigravity
## Blueprint v2 — Updated 2026-06-17 (MCP Discovery Session)

> **Changes from v1:** Corrected MCP config paths, confirmed chrome-devtools-mcp tool list (31 tools), fixed path confusion between config/ and antigravity-ide/ files, added Antigravity SDK future milestone note, updated server health status, added Node v24.13.1 confirmation.

---

## TL;DR

- **Build a local-first audit engine in Node.js using Playwright as the browser driver, wrapping Lighthouse, axe-core, linkinator, and pixelmatch, with an Express/SQLite dashboard for findings triage and before/after screenshot comparison — then expose it to Antigravity as a custom local MCP server registered in `~/.gemini/config/mcp_config.json`.**
- **Antigravity already ships the pieces you'd otherwise build by hand: a `/browser` subagent and a pre-bundled Chrome DevTools MCP server that capture screenshots, console errors, network requests, accessibility/SEO/best-practices Lighthouse audits, and performance traces — so your custom tool should focus on aggregation, persistence, the triage dashboard, and the fix tracker, not on re-implementing browser capture.**
- **Ship the capability two ways: (a) an MCP server so any agent (Antigravity, Claude, Cursor) can call `run_audit(url)` and `compare_screenshots(before, after)`; and (b) a portable `SKILL.md` Agent Skill that teaches the agent the audit workflow and points at your scripts. The MCP server is the engine; the Skill is the playbook.**

---

## Key Findings

1. **Google Antigravity is Google's agentic development platform**, released in public preview on **November 18, 2025** alongside Gemini 3 Pro, and updated to "Antigravity 2.0" around Google I/O 2026. Supports Gemini 3 Pro, Claude Sonnet 4.6 / Opus 4.6, and GPT-OSS-120B (model lineup confirmed in current session as Claude Sonnet 4.6 Thinking).

2. **Antigravity has first-class browser automation built in.** A "Browser Subagent" launches/controls Chrome via a debugging session (triggered by the `/browser` slash command). Chrome DevTools for agents (`chrome-devtools-mcp`) comes **pre-bundled** — zero manual install needed.

3. **Antigravity MCP config — CORRECTED PATH:** There are **two** config files on this machine, not one:
   - `C:\Users\razva\.gemini\config\mcp_config.json` — **MASTER (Antigravity reads this)**
   - `C:\Users\razva\.gemini\antigravity-ide\mcp_config.json` — real file (symlinked from `antigravity/mcp_config.json`)
   - Both must be kept in sync. Add `site-audit` entry to **both** in Phase 3.

4. **Playwright is the recommended browser engine** — cross-browser, auto-waiting, first-class console/network/screenshot capture. **Node v24.13.1 is installed** (blueprint assumed 22+; 24 exceeds requirement).

5. **The audit "engines" are all open-source and runnable programmatically from Node.** The recommended stack for this project: Playwright + Lighthouse + @axe-core/playwright + linkinator + pixelmatch + better-sqlite3.

6. **Before/after screenshot comparison** with `pixelmatch` + `pngjs` is the fix tracker mechanism. Returns pixel count + percentage and writes a visual diff PNG.

7. **Agent Skills (`SKILL.md`)** are discovered at:
   - **Global (confirmed active):** `C:\Users\razva\.gemini\config\skills\<skill>\` — 51 skills present
   - **Also mirrored to:** `C:\Users\razva\.gemini\antigravity\skills\` (identical, stays in sync)
   - **Cross-tool:** `C:\Users\razva\.agents\skills\` (Firecrawl skills live here)
   - **Project-local:** `<project-root>\.agents\skills\` — needs to be created

---

## Environment Confirmed (This Machine)

| Item | Value | Status |
|---|---|---|
| Node.js | v24.13.1 | ✅ Exceeds 22+ requirement |
| npm | 11.8.0 | ✅ |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` | ✅ |
| chrome-devtools-mcp | 31 tools pre-bundled | ✅ Auto-available |
| MCP master config | `C:\Users\razva\.gemini\config\mcp_config.json` | ✅ Confirmed |
| Global skills dir | `C:\Users\razva\.gemini\config\skills\` | ✅ 51 skills |

## MCP Servers — Current Status

| Server | Type | Status | Notes |
|---|---|---|---|
| context7 | stdio (npx) | ✅ Working | v3.2.1 |
| playwright | stdio (npx) | ✅ Working | v1.61.0-alpha |
| sequential-thinking | stdio (npx) | ✅ Working | v0.2.0 |
| supabase-mcp-server | stdio (npx) | ✅ Working | v0.8.2 (fixed: cleared broken zod cache) |
| stitch | Remote HTTP | ✅ Working | Confirmed — returned design projects in live test |
| chrome_devtools | Auto-bundled | ✅ Working | 31 tools, no config entry needed |
| github | — | ❌ Removed | Was `YOUR_GITHUB_PAT` placeholder — fails all calls |

---

## Details

### 1. What Google Antigravity is and what it can do

*(Unchanged from v1)*

**Chrome DevTools MCP is pre-bundled — 31 confirmed tools:**
- `take_screenshot`, `take_snapshot`, `list_console_messages`, `get_console_message`
- `list_network_requests`, `get_network_request`
- `lighthouse_audit` — accessibility, SEO, best practices (excludes performance)
- `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`
- `evaluate_script`, `take_memory_snapshot`, `screencast_start/stop`
- `navigate_page`, `new_page`, `close_page`, `list_pages`, `select_page`, `resize_page`
- `click`, `fill`, `fill_form`, `hover`, `drag`, `press_key`, `type_text`, `upload_file`
- `handle_dialog`, `wait_for`, `emulate`

**Implication:** much of your "capture browser-side issues" requirement is *already available inside Antigravity*. Your custom tool's value-add is **aggregation + persistence + triage dashboard + before/after fix tracker**.

### 2. MCP support in Antigravity — CORRECTED

**Config file chain (confirmed by file inspection):**

```
C:\Users\razva\.gemini\config\mcp_config.json       ← MASTER (Antigravity reads this)
C:\Users\razva\.gemini\antigravity\mcp_config.json   ← SYMLINK → antigravity-ide/
C:\Users\razva\.gemini\antigravity-ide\mcp_config.json ← REAL FILE (stale, now synced)
```

The `site-audit` server entry must be added to **both** the master config and `antigravity-ide/mcp_config.json` (they are now kept in sync after this session).

**Entry to add in Phase 3:**

```json
{
  "mcpServers": {
    "site-audit": {
      "command": "node",
      "args": ["G:/PROJECTS - WORK - CLIENTS -NEW PC/ABC INTERNAL PROJECTS - SOFTSITE - ONLINEGSM/Site-test-tool/mcp/build/index.js"]
    }
  }
}
```

**Known caveats (unchanged):** Write diagnostics to **stderr**, not stdout — stdout is reserved for JSON-RPC. Return typed text strings rather than raw nested objects. Test with MCP Inspector first.

### 3. Browser engine: Playwright ✅

Confirmed choice. Playwright is cross-browser (Chromium, Firefox, WebKit), auto-waiting, has first-class axe-core integration, and the strongest agentic ecosystem.

```js
const { chromium } = require('playwright');
const consoleErrors = [], failedRequests = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));
page.on('requestfailed', req => failedRequests.push({ url: req.url(), err: req.failure()?.errorText }));
page.on('response', res => { if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() }); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'before.png', fullPage: true });
await browser.close();
```

### 4. Audit engines (unchanged from v1)

| Capability | Tool | How to run | Notes |
|---|---|---|---|
| Performance, SEO, PWA, best-practices, a11y score | **Lighthouse** (Node API) | `import lighthouse from 'lighthouse'` + `chrome-launcher` | Returns LHR JSON; Node 22+ required ✅ |
| Detailed accessibility (WCAG 2.1/2.2 A/AA) | **axe-core** via `@axe-core/playwright` | `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` | axe-core v4.11.x |
| Broken links / 404s | **linkinator** | `new LinkChecker().check({ path: url, recurse: true })` | depth 1 for v1 |
| Console/JS/network errors, screenshots | **Playwright** | event listeners + `page.screenshot` | Browser-side capture layer |
| Before/after screenshot diff | **pixelmatch** + **pngjs** | `pixelmatch(img1, img2, diff, w, h, {threshold: 0.1})` | Returns diff pixel count + writes diff PNG |

### 5. Data model (unchanged from v1)

```sql
CREATE TABLE audits (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  started_at TEXT, finished_at TEXT,
  lighthouse_perf REAL, lighthouse_a11y REAL, lighthouse_seo REAL,
  status TEXT  -- running | done | error
);

CREATE TABLE findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  category TEXT,     -- accessibility | performance | console | network | links | seo
  severity TEXT,     -- critical | serious | moderate | minor
  title TEXT,
  description TEXT,
  selector TEXT,
  source_url TEXT,
  source_tool TEXT,  -- lighthouse | axe | pa11y | linkinator | playwright
  evidence_path TEXT,
  status TEXT DEFAULT 'open',  -- open | fixed | wontfix
  is_false_positive INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT
);

CREATE TABLE fix_tracker (
  id INTEGER PRIMARY KEY,
  finding_id INTEGER REFERENCES findings(id),
  before_screenshot TEXT,
  after_screenshot TEXT,
  diff_image TEXT,
  diff_pixels INTEGER,
  diff_percentage REAL,
  verified INTEGER DEFAULT 0,
  updated_at TEXT
);
```

### 6. MCP server (Path A)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "site-audit", version: "1.0.0" });

server.registerTool("run_audit",
  { description: "Run a full audit (Lighthouse, axe, links, console/network) on a URL and store findings.",
    inputSchema: { url: z.string() } },
  async ({ url }) => {
    const auditId = await runFullAudit(url);
    return { content: [{ type: "text", text: `Audit ${auditId} complete for ${url}` }] };
  });

server.registerTool("get_findings",
  { description: "Get all findings for an audit run.",
    inputSchema: { auditId: z.number() } },
  async ({ auditId }) => { /* query SQLite */ });

server.registerTool("compare_screenshots",
  { description: "Diff a before/after screenshot pair for a finding.",
    inputSchema: { findingId: z.number() } },
  async ({ findingId }) => { /* pixelmatch + store diff */ });

await server.connect(new StdioServerTransport());
```

**Critical:** Write diagnostics to **stderr only** — stdout is JSON-RPC.

### 7. Agent Skill (Path B)

```markdown
---
name: site-audit-reporter
description: >
  Runs a website audit capturing screenshots, console errors, JavaScript errors,
  network failures, accessibility (axe/Lighthouse) and performance metrics, then
  reports findings clearly. Use when the user asks to audit, QA, or bug-check a site.
---

# Site Audit Reporter

## Instructions
1. Ask for (or confirm) the target URL.
2. Run the audit script: `node scripts/audit.js <url>` (drives Playwright + Lighthouse + axe + linkinator).
3. The script writes findings to the local SQLite DB and a full-page screenshot to `assets/`.
4. Summarize results grouped by severity. For each finding give: title, where it occurs, why it matters, and a suggested fix.
5. For console/JS errors include the exact message; for network errors include URL + status; attach screenshots as evidence.
6. To verify a fix, run `node scripts/compare.js <findingId>` and report the pixel/percentage diff with the before/after/diff images.

## Guidelines
- Never invent findings; only report what the tools detected.
- Flag low-confidence items (e.g. bot-protected 403/999 links) as "needs manual check," not "broken."
```

**Install path:** `C:\Users\razva\.gemini\config\skills\site-audit-reporter\SKILL.md`

---

## Stage Plan (Corrected)

### Stage 1 — CLI Engine (Phase 1)
Build `node audit.js <url>` → 5 signal types → SQLite + JSON report.

**Benchmark:** `node audit.js https://example.com` produces JSON with ≥3 source tools represented, SQLite populated, screenshot saved.

### Stage 2 — Dashboard + Fix Tracker (Phase 2)
Express dashboard with findings triage + pixelmatch before/after diff.

**Benchmark:** Triage a real client audit end-to-end in the UI.

### Stage 3 — MCP Server (Phase 3)
`@modelcontextprotocol/sdk` wrapper → MCP Inspector → register in both `~/.gemini/config/mcp_config.json` and `~/.gemini/antigravity-ide/mcp_config.json`.

**Benchmark:** In Antigravity, "audit example.com and show me the critical findings" triggers the tool.

### Stage 4 — Skill + Polish (Phase 4)
`site-audit-reporter` SKILL.md at `~/.gemini/config/skills/`. README.md. Project-local `.agents/skills/` copy.

**Benchmark:** Fresh Antigravity session, "QA this site" runs audit, reports clearly, verifies fix.

### Future Milestone — Antigravity SDK Multi-Agent (Stage 5+)

The **Google Antigravity SDK** (Python) enables building custom autonomous agents. For the advanced milestone:

- **Researcher agent** — scrapes site structure, identifies URL patterns
- **Auditor agent** — runs audit engines per URL
- **Fixer agent** — generates fix suggestions per finding category
- **Tester agent** — verifies fixes using before/after screenshot diff

Requires downloading the Antigravity SDK plugin. Use `/gsd-new-milestone` when Stage 4 is shipped.

---

## Caveats (Updated)

- **Two MCP config files, not one.** The master is `~/.gemini/config/mcp_config.json`. The `antigravity/mcp_config.json` is a symlink to `antigravity-ide/mcp_config.json`. Keep both in sync when adding `site-audit`.
- **Stitch server:** Works as remote HTTP — the API key format (short-lived `AQ.` prefix) means it may expire. If stitch stops working, regenerate the key from the Stitch console.
- **Supabase cache:** Had broken `zod` dependency in npx cache. Fixed by clearing `npm-cache\_npx\53c479...`. If broken again, run `npx cache clean` for the package.
- **Lighthouse runs one audit per Node process** — sequential, not concurrent.
- **Automated audits catch 57% of a11y issues** on average. Present as first pass, not compliance guarantee.
- **Write to stderr only in MCP server** — stdout is JSON-RPC.
- **Model lineup:** Current session is Claude Sonnet 4.6 (Thinking). Claude Sonnet 4.6 / Opus 4.6 available.
