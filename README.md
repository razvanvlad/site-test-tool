# Site Test Tool

A local-first website audit engine that runs Playwright, Lighthouse, axe-core, and Linkinator in a single pass to gather a comprehensive set of issues. All findings are normalized, persisted to a local SQLite database, and optionally exposed via an Express dashboard or an MCP Server.

## Project Overview

The Site Test Tool automates QA workflows. When provided a URL, it:
1. **Playwright Capture**: Loads the page, captures all `console.error` logs, network request failures (HTTP >= 400), and unhandled JS exceptions.
2. **Accessibility**: Runs `axe-core` to find WCAG violations.
3. **Lighthouse**: Collects Performance, Accessibility, Best Practices, and SEO scores.
4. **Linkinator**: Crawls depth-1 links to find broken anchors (e.g. 404s).
5. **Data Storage**: Normalizes all the issues into a single standard format and stores them in a local SQLite DB (`db/audits.db`).

## Architecture

- **CLI Engine (`audit.js`)**: The primary orchestrator. Runs the engine pipeline and outputs a styled console summary.
- **Diff Engine (`compare.js`)**: Captures an "after" screenshot of a specific finding and runs `pixelmatch` against the original baseline screenshot to calculate pixel differences.
- **Express Dashboard (`server.js`)**: A lightweight web dashboard at `http://localhost:3000` to review past audits, triage findings (mark as false positive, add notes, change status), and view screenshot diffs side-by-side.
- **MCP Server (`mcp/index.js`)**: An MCP stdio server that exposes `run_audit`, `get_findings`, and `compare_screenshots` to AI agents (e.g. Antigravity) allowing autonomous auditing and review.

## Installation

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Install Playwright Browsers:**
   ```bash
   npx playwright install chromium
   ```

## Usage

### 1. Run an Audit (CLI)
```bash
node audit.js https://example.com
```

### 2. View the Dashboard
```bash
npm start
# Open http://localhost:3000
```

### 3. Verify a Fix visually (CLI)
When you've made a code change, you can verify if it fixed the visual component:
```bash
node compare.js <finding_id>
```

## Database Schema

The SQLite database uses three main tables:
- **`audits`**: Stores the high-level audit run (URL, timestamps, Lighthouse scores).
- **`findings`**: Stores the normalized issues. Key columns:
  - `category` (performance, accessibility, console, network, links, seo)
  - `severity` (critical, serious, moderate, minor)
  - `source_tool`
  - `status` (open, fixed, wontfix)
- **`fix_tracker`**: Stores before/after screenshot paths and `diff_percentage` from pixelmatch runs.

## Adding New Engines

To add a new tool (e.g. Pa11y):
1. Create a new runner script in `src/engines/` that returns an array of issues.
2. Update `audit.js` to await your new runner.
3. Update `src/normalize.js` to map your tool's proprietary output format into the standardized `findings` format.

## Antigravity MCP Integration

The project provides an MCP server (`mcp/index.js`) and a custom `SKILL.md` (Agent Skill) allowing Antigravity agents to seamlessly QA websites.
- Ensure the MCP server is registered in your `mcp_config.json`.
- When in Antigravity, simply say: **"QA klap.ro"** to invoke the skill.
