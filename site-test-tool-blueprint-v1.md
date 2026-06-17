# Building a Local Website Audit Tool That Plugs Into Google Antigravity

## TL;DR
- **Build a local-first audit engine in Node.js using Playwright as the browser driver, wrapping Lighthouse, axe-core, linkinator, and pixelmatch, with an Express/SQLite (or FastAPI/SQLite) dashboard for findings triage and before/after screenshot comparison — then expose it to Antigravity as a custom local MCP server registered in `~/.gemini/config/mcp_config.json`.**
- **Antigravity already ships the pieces you'd otherwise build by hand: a `/browser` subagent and a pre-bundled Chrome DevTools MCP server that capture screenshots, console errors, network requests, accessibility/SEO/best-practices Lighthouse audits, and performance traces — so your custom tool should focus on aggregation, persistence, the triage dashboard, and the fix tracker, not on re-implementing browser capture.**
- **Ship the capability two ways: (a) an MCP server so any agent (Antigravity, Claude, Cursor) can call `run_audit(url)` and `compare_screenshots(before, after)`; and (b) a portable `SKILL.md` Agent Skill that teaches the agent the audit workflow and points at your scripts. The MCP server is the engine; the Skill is the playbook.**

## Key Findings

1. **Google Antigravity is Google's agentic development platform**, released in public preview on **November 18, 2025** alongside Gemini 3 Pro, and updated to "Antigravity 2.0" around Google I/O 2026. It is a VS Code fork that adds an agent-first "Manager" surface and lets agents operate across editor, terminal, and browser. Google's launch blog states: "From today, Google Antigravity is available in public preview at no charge, with generous rate limits on Gemini 3 Pro usage." It supports Gemini 3 Pro plus Anthropic Claude (Sonnet 4.5 at launch; Wikipedia's June 2026 entry lists Claude Sonnet 4.6 and Opus 4.6) and an open-source OpenAI variant (GPT-OSS-120B).

2. **Antigravity has first-class browser automation built in.** A "Browser Subagent" launches/controls Chrome via a debugging session (triggered by the `/browser` slash command), takes screenshots, reads the DOM and console logs, records WebP browser recordings as "Artifacts," and verifies UI. Chrome DevTools for agents (`chrome-devtools-mcp`) comes pre-bundled with Antigravity 2.0.

3. **Antigravity supports MCP (Model Context Protocol)** for connecting local tools, with config in `~/.gemini/config/mcp_config.json` — a unified location shared across the Antigravity IDE, CLI, and standalone app in 2.0.

4. **Playwright is the recommended browser engine** for a new local audit tool over Puppeteer and Selenium: cross-browser, auto-waiting, first-class console/network/screenshot capture, and the strongest agentic ecosystem.

5. **The audit "engines" are all open-source and runnable programmatically from Node**: Google Lighthouse (performance/SEO/PWA/accessibility), axe-core (accessibility, via `@axe-core/playwright`), Pa11y (CLI accessibility), and linkinator (broken links). Aggregate their JSON output into one findings store.

6. **Before/after screenshot comparison is a solved problem** with `pixelmatch` (+ `pngjs`) or `resemble.js` — both produce a numeric diff and a visual diff image you can store and render in the dashboard.

7. **Agent Skills (`SKILL.md`)** are an open, portable standard (originated by Anthropic, now adopted across Claude, Codex, Gemini CLI, and Antigravity) — a folder with a `SKILL.md` (YAML frontmatter + Markdown instructions) plus optional scripts.

## Details

### 1. What Google Antigravity is and what it can do

Antigravity is described by Google as "a new agentic development platform designed to help you operate at a higher, task-oriented level." It is not just an editor — it deploys agents that "autonomously plan, execute, and verify complex tasks across your editor, terminal, and browser." It is built on a VS Code fork and introduces two surfaces: the **Editor View** (familiar AI IDE with tab completion and inline commands) and the **Manager** (a "mission control" for spawning and orchestrating multiple agents in parallel).

A defining concept is **Artifacts** — tangible deliverables (task lists, implementation plans, screenshots, browser recordings) that the agent produces so you can verify its work asynchronously, and leave Google-Docs-style comments on. This "trust" model is directly relevant to a client-facing audit tool: the audit artifacts (screenshots, reports) are exactly what Antigravity is designed to surface and let you annotate.

**Browser capabilities.** Antigravity includes an integrated Chrome browser the agents control directly. After writing code, agents can "automatically launch your app, interact with it in the browser, take screenshots, and verify functionality." The browser behaviour is gated behind an explicit slash command:

> "`/browser`: We heard the feedback that the agents were still not capable enough to determine exactly when to be using the browser. So for now, we've made it such that an explicit slash command controls these behaviors. When used, the agent diligently uses the browser primitives. This requires both Google Chrome and the user to provide permission in Google Chrome to start a debugging session." — Antigravity docs

The browser subagent can read/analyze the full DOM, extract data, verify element presence, read console logs, and convert pages to markdown. All browser interactions are recorded and saved as WebP recordings to the artifacts directory.

**Chrome DevTools MCP is pre-bundled.** Per Chrome for Developers: "Chrome DevTools for agents comes pre-bundled with Antigravity 2.0. You can start using it immediately with the browser sub-agent." This `chrome-devtools-mcp` server exposes roughly **30+ tools** (the count varies by version — ~29 in v0.19, ~33 in v0.21 as of March 2026), and the ones most relevant to auditing are:
- `take_screenshot` (full-page or element, png/jpeg/webp)
- `take_snapshot` (text snapshot of the accessibility tree with element UIDs)
- `list_console_messages` / `get_console_message` (console output with source-mapped stack traces)
- `list_network_requests` / `get_network_request` (full request/response bodies and headers)
- `lighthouse_audit` — verbatim from the tool reference: "Get Lighthouse score and reports for accessibility, SEO, best practices, and agentic browsing. This excludes performance. For performance audits, run performance_start_trace."
- `performance_start_trace` / `performance_stop_trace` / `performance_analyze_insight` (Core Web Vitals and performance insights)

**Implication:** much of your "capture browser-side issues" requirement (screenshots, console/JS errors, network errors, accessibility/SEO via Lighthouse, performance) is *already available inside Antigravity*. Your custom tool's value-add is the **aggregation + persistence + triage dashboard + before/after fix tracker** that Antigravity does not provide.

### 2. MCP support in Antigravity and how to connect your local project

Antigravity "supports the Model Context Protocol (MCP), a standard that allows the editor to securely connect to your local tools, databases, and external services." Configuration lives in a single file:

- **Path:** `~/.gemini/config/mcp_config.json` (the unified/shared location in Antigravity 2.0, shared across IDE, CLI, and the standalone app).
- **UI:** Settings → Customizations → "Manage MCP Servers" → "View raw config" (or open the MCP store via the "…" dropdown at the top of the agent panel).

The schema is a single `mcpServers` object. A local stdio server entry looks exactly like this (verbatim from the official docs):

```json
{
  "mcpServers": {
    "serverName": {
      "command": "path/to/executable",
      "args": ["--arg1", "value1"],
      "env": { "API_KEY": "your-api-key" }
    }
  }
}
```

For your audit tool you would register something like:

```json
{
  "mcpServers": {
    "site-audit": {
      "command": "node",
      "args": ["/abs/path/to/site-audit-mcp/build/index.js"]
    }
  }
}
```

Known caveats: Antigravity does not support the MCP OAuth client-id/secret spec for remote Google Cloud servers (not relevant for a local stdio server); and a launch-window bug reportedly forced hardcoding env-var values in the global MCP config. Antigravity also recommends keeping total enabled tools under 50 for performance. The first time the agent calls your tool, Antigravity prompts for approval.

### 3. Browser engine: Playwright vs Puppeteer vs Selenium

For a 2026 greenfield local audit tool, **Playwright is the recommended default**. The consensus across the comparisons reviewed:

- **Playwright (Microsoft):** Cross-browser (Chromium, Firefox, WebKit), auto-waiting (less flaky), isolated browser contexts, built-in test runner, traces, codegen, and official bindings for JS/TS, Python, Java, and .NET. Strongest agentic ecosystem (native MCP support, accessibility-tree snapshots). "Default for new projects."
- **Puppeteer (Google):** Chromium-only (Firefox experimental, no WebKit), thin dependency, direct Chrome DevTools Protocol access. Good for "Chrome-only, low-complexity" scraping/auditing or when you want a small dependency.
- **Selenium:** Widest browser/language support and enterprise grid integration, but slower, more verbose, manual waits, more flaky. "Do not start a greenfield project with it in 2026."

Capturing the signals you need in Playwright is concise:

```js
const { chromium } = require('playwright');
const consoleErrors = [], failedRequests = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));     // uncaught JS exceptions
page.on('requestfailed', req => failedRequests.push({ url: req.url(), err: req.failure()?.errorText }));
page.on('response', res => { if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() }); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: 'before.png', fullPage: true });
await browser.close();
```

Playwright's `tracing` API can additionally capture screenshots-at-every-action, DOM snapshots, network, and console into a single zip viewable in the Trace Viewer — useful evidence to attach to a finding.

### 4. The audit engines and how they fit together

Run each engine programmatically and normalize every result into a single `findings` table. Recommended stack:

| Capability | Tool | How to run | Notes |
|---|---|---|---|
| Performance, SEO, PWA, best-practices, a11y score | **Lighthouse** (Node API) | `import lighthouse from 'lighthouse'` + `chrome-launcher`; or `playwright-lighthouse` to reuse a Playwright page | Returns LHR JSON; Node 22+ required. One audit per process (no concurrency). |
| Detailed accessibility (WCAG 2.1/2.2 A/AA) | **axe-core** via `@axe-core/playwright` | `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa']).analyze()` | axe-core v4.11.x; catches ~57% of WCAG issues by volume; low false-positive rate; the engine under Lighthouse/Pa11y. |
| Accessibility (URL/sitemap, alt engine) | **Pa11y** | `pa11y(url)` (wraps HTML_CodeSniffer or axe-core) | Good for crawling many URLs; binary issues-or-not output. |
| Broken links / 404s | **linkinator** | `new LinkChecker().check({ path: url, recurse: true })` | Emits `link` events with `state: 'BROKEN'`, status, parent; handles bot-protection (403/999) gracefully. |
| Console/JS/network errors, screenshots | **Playwright** (above) | event listeners + `page.screenshot` | The "browser-side issues" capture layer. |
| Before/after screenshot diff | **pixelmatch** + **pngjs** | `pixelmatch(img1, img2, diff, w, h, {threshold: 0.1})` | Returns # of differing pixels and writes a visual diff PNG. Use `resemble.js` if you want %-difference and antialiasing tolerance. |

**Aggregation pattern:** wrap each engine in an adapter that returns `{ category, severity, title, description, evidence (screenshot path / selector / url), source_tool }`. Lighthouse, axe, and Pa11y all emit JSON; map their violation objects into your normalized finding shape and `INSERT` into SQLite.

### 5. Architecting the local dashboard

Two equally valid lightweight stacks; pick by language preference:

- **Node (recommended for this project):** Express (or Fastify) + `better-sqlite3` backend; plain HTML or a small React/Next.js frontend. Keeps the whole project in one language since your audit engines are Node-based — no cross-language process juggling.
- **Python:** FastAPI + SQLite (via SQLModel/SQLAlchemy) backend; serve a simple HTML/HTMX or React frontend. FastAPI + SQLite is the canonical lightweight CRUD stack and runs from a single file with `uvicorn`. For an even faster start, an admin-panel generator like CRUDAdmin gives you a findings table UI with minimal config.

**Suggested data model:**

```sql
-- one row per audit run
CREATE TABLE audits (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  started_at TEXT, finished_at TEXT,
  lighthouse_perf REAL, lighthouse_a11y REAL, lighthouse_seo REAL,
  status TEXT  -- running | done | error
);

-- one row per detected issue
CREATE TABLE findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  category TEXT,          -- accessibility | performance | console | network | links | seo
  severity TEXT,          -- critical | serious | moderate | minor
  title TEXT,
  description TEXT,
  selector TEXT,          -- DOM target where applicable
  source_url TEXT,        -- failing request / broken link
  source_tool TEXT,       -- lighthouse | axe | pa11y | linkinator | playwright
  evidence_path TEXT,     -- screenshot / trace reference
  status TEXT DEFAULT 'open',     -- open | fixed | wontfix
  is_false_positive INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT
);

-- before/after fix tracking
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

The dashboard endpoints map directly to your requirements: list findings; `PATCH /findings/:id` to mark false positive / add notes / change status; `POST /findings/:id/fix` to attach a before+after screenshot, run pixelmatch, and store the diff image and pixel/percentage delta. Render before/after/diff side-by-side in the UI.

### 6. Path A — connect the local project to Antigravity via MCP

Build the audit engine as an **MCP server** so the Antigravity agent can invoke it as a tool. Use the official SDKs: for Node, `@modelcontextprotocol/sdk` (or the higher-level `fastmcp`); for Python, the `mcp` package with `FastMCP` (decorator-based). A minimal Node MCP tool:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "site-audit", version: "1.0.0" });

server.registerTool("run_audit",
  { description: "Run a full audit (Lighthouse, axe, links, console/network) on a URL and store findings.",
    inputSchema: { url: z.string() } },
  async ({ url }) => {
    const auditId = await runFullAudit(url);   // your aggregator
    return { content: [{ type: "text", text: `Audit ${auditId} complete for ${url}` }] };
  });

server.registerTool("compare_screenshots",
  { description: "Diff a before/after screenshot pair for a finding.",
    inputSchema: { findingId: z.number() } },
  async ({ findingId }) => { /* pixelmatch + store diff */ });

await server.connect(new StdioServerTransport());
```

Two gotchas from the field: (1) write diagnostics to **stderr**, never stdout — stdout is reserved for JSON-RPC and a stray `console.log` corrupts the protocol stream; (2) return typed text strings rather than raw nested objects (some clients truncate). Test with the MCP Inspector (`npx @modelcontextprotocol/inspector node build/index.js`) before wiring into Antigravity. Then add the `site-audit` block to `~/.gemini/config/mcp_config.json` as shown above, refresh MCP servers in Antigravity, and approve the tool on first use.

**Division of labour:** Let Antigravity's pre-bundled Chrome DevTools MCP / `/browser` subagent do live, interactive debugging during development. Let *your* `site-audit` MCP server do the repeatable, persisted, client-deliverable audit + the before/after fix tracking that Antigravity has no built-in store for. You can also point `chrome-devtools-mcp` at Antigravity's own browser with `--browser-url=http://127.0.0.1:9222` if you want your server to reuse the same Chrome session.

### 7. Path B — package it as an Agent Skill (`SKILL.md`)

A Skill is "a folder containing a SKILL.md file" with YAML frontmatter (required `name` and `description`) plus Markdown instructions, and optional `scripts/`, `references/`, and `assets/` folders. Skills use progressive disclosure: only the name/description load until the agent decides the skill is relevant. Antigravity discovers skills at:
- **Global (all Antigravity products):** `~/.gemini/config/skills/<skill>/` (the codelab also references `~/.gemini/antigravity/skills/`; the Antigravity CLI uses `~/.gemini/antigravity-cli/skills/`).
- **Project/workspace:** `<project-root>/.agents/skills/`.

(The cross-tool "standard" location is `~/.agents/skills/`; tools disagree, so a symlink is a common fix.)

A skill for your use case:

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

The skill bundles `scripts/audit.js` and `scripts/compare.js` (the same code your MCP server calls). This gives you reuse: the **MCP server is the callable engine**; the **Skill is the procedural playbook** that teaches any agent how and when to use it. The `vercel-labs/skills` CLI (`npx skills add … -a antigravity`) helps install/sync skills across agents.

## Recommendations

**Stage 1 — Local CLI engine (week 1).** Build a Node project that, given a URL, runs Playwright (screenshots + console + page errors + failed requests), Lighthouse (Node API), `@axe-core/playwright`, and linkinator, and writes normalized rows into SQLite. Output a simple HTML/JSON report. This is independently useful and is the foundation for everything else. *Benchmark to proceed:* a single `node audit.js <url>` produces a findings JSON with at least the five required signal types.

**Stage 2 — Dashboard + fix tracker (week 2).** Add an Express + SQLite backend and a minimal React/HTML frontend implementing the `audits`/`findings`/`fix_tracker` schema: list findings, mark false positives, add notes, and a before/after pixelmatch view. *Benchmark:* you can triage a real client's audit end-to-end in the UI.

**Stage 3 — MCP server (week 3).** Wrap the engine in `@modelcontextprotocol/sdk`, exposing `run_audit`, `get_findings`, and `compare_screenshots`. Test in MCP Inspector, then register in `~/.gemini/config/mcp_config.json`. *Benchmark:* in Antigravity, "audit example.com and show me the critical findings" triggers your tool and returns stored findings.

**Stage 4 — Skill + polish (week 4).** Add the `site-audit-reporter` SKILL.md so the agent knows the workflow and reporting format. *Benchmark:* a fresh Antigravity session, given only "QA this site," runs the audit, reports clearly, and can verify a fix with a before/after diff.

**What would change this plan:**
- If you only ever need Chrome and want zero browser-engine dependency, you can lean entirely on Antigravity's pre-bundled `chrome-devtools-mcp` for capture and have your tool only persist/triage — but you lose cross-browser coverage and standalone (non-Antigravity) runs.
- If you later want to offer audits as a hosted SaaS, switch SQLite → Postgres and the stdio MCP transport → Streamable HTTP; both are drop-in in the stacks above.
- If accessibility compliance becomes the headline deliverable, add Pa11y as a second a11y engine and reconcile its findings with axe to widen coverage (combined automated tools still catch only a minority of issues — see Caveats).

## Caveats

- **Antigravity is in public preview and moving fast.** "Antigravity 2.0," Gemini 3.5 Flash, and a standalone desktop app were announced around Google I/O 2026; feature names, the exact MCP config path, and skills directories have shifted between the original November 2025 release and 2.0. Some of these details come from practitioner blogs (Google Cloud Community/Medium, Google Developer Experts) rather than formal Google docs, and at least one author reported a launch-window bug where env-vars in the global MCP config had to be hardcoded. Verify the current config path against the live `antigravity.google/docs/mcp` page before you build.
- **The config-path conflict is real:** official docs and the Antigravity 2.0 community guide point to `~/.gemini/config/mcp_config.json`, while several third-party install guides still reference the older per-app `~/.gemini/antigravity/mcp_config.json`. Use the official path and fall back only if the server isn't detected.
- **Automated audits catch a minority of accessibility issues.** Deque's own coverage study (over 2,000 audits spanning ~13,000 pages and ~300,000 issues) found "on average, 57 percent of accessibility issues were completely covered by this automated testing" — but axe fully automates only ~29.5% of WCAG 2.2 success criteria, and the general automated-tool baseline is 30–40% of WCAG failures, with the remaining 60–70% requiring manual testing (per TestParty). Present automated results to clients as a first pass, not a compliance guarantee, and pair with manual review.
- **Security:** giving an agent a live browser (or auto-connecting `chrome-devtools-mcp` to an authenticated Chrome session) exposes whatever that browser can see; Chrome's own docs warn the agent "can effectively act on your behalf." Run audits against client sites in a clean profile, and treat the `browser_run_code_unsafe`-style tools as RCE-equivalent — enable only for trusted use.
- **Lighthouse runs one audit per Node process** and reloads the page, so multi-page/multi-config audits are sequential and slow; plan for that (queue runs) rather than expecting concurrency.
- **Subagent-derived internals** (e.g., the native browser subagent's port 3025 bridge / "Jetski" language server / WebP recording) come from a reverse-engineering blog and are not officially confirmed; treat as color, not contract.
- **Model lineup varies by source:** launch-era coverage (Nov 2025) cites Claude Sonnet 4.5 and GPT-OSS, while Wikipedia's June 2026 entry lists Claude Sonnet 4.6/Opus 4.6 and GPT-OSS-120B. Confirm available models in the app's model picker.