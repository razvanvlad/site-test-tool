# Site Test Tool 🧪

A powerful, local-first website audit engine designed for continuous QA, accessibility monitoring, and AI-driven resolution. It combines leading testing engines (Playwright, Lighthouse, axe-core, Linkinator) with cutting-edge AI (Gemini 2.5 Flash, Groq Llama 3) to not just find bugs, but to prioritize them and propose code fixes. 

All findings are persisted to a local SQLite database, exposed via a rich Express dashboard, and integrated directly into your IDE through a robust MCP (Model Context Protocol) Server.

---

## 🚀 Key Capabilities

### 1. Unified Auditing Pipeline
- **Playwright Capture:** Intercepts `console.error` logs, network request failures (HTTP >= 400), and unhandled JS exceptions.
- **Accessibility (a11y):** Uses `@axe-core/playwright` to detect WCAG violations directly within the DOM.
- **Lighthouse Metrics:** Gathers Core Web Vitals, Performance, Accessibility, Best Practices, and SEO scores.
- **Linkinator:** Crawls depth-1 links to catch 404s and broken anchors.
- **Data Normalization:** All issues are standardized into a single `findings` schema, regardless of which tool caught them.

### 2. AI-Powered Analysis & Triage
- **Mobile Visual Analysis:** Employs Gemini-Vision to analyze full-page screenshots in a mobile viewport, identifying CSS overflow, truncated text, and unresponsive elements.
- **AI Executive Summaries:** Automatically generates categorized markdown reports for both **Desktop Performance** and **Mobile Responsiveness** based on raw metrics.
- **Interactive Action Tasks:** AI converts raw findings into prioritized checklist tasks (Priority 1-3). The dashboard acts as a Task Manager where you can add "Resolution Notes" and mark tasks as "Done".
- **Code Healer:** Includes an "AI Propose Fix" feature that leverages AI to generate patch diffs and specific code solutions for identified issues.
- **Auto Model Routing:** Intelligent failover between Gemini and Groq based on rate limits.

### 3. Comprehensive Dashboard (`http://localhost:3001`)
- **Project & Domain Management:** Group your audits by "Project" and manage individual sub-pages.
- **Rich Data Filtering:** Filter findings by Severity (Critical, Serious, Moderate, Minor), Category, Tool, and Status (Open, Fixed).
- **Historical Tracking:** Visual charts map Lighthouse scores over time to prevent regressions.
- **CSV Export:** Export audit findings for client reporting or external tracking.
- **Light/Dark Mode:** Seamlessly respects system-level theme preferences.

### 4. Visual Regression Testing
- **Diff Engine (`compare.js`):** Captures an "after" screenshot of a specific finding and runs `pixelmatch` against the original baseline screenshot to calculate pixel differences, proving UI fixes.

### 5. Agentic Workflows (MCP Integration)
The tool exposes an MCP stdio server (`mcp/index.js`) allowing autonomous AI agents (like Antigravity or Claude) to interact with your audits programmatically:
- `run_audit`: Trigger a new site audit.
- `get_findings`: Fetch normalized JSON or Markdown findings.
- `get_action_tasks`: Fetch the prioritized AI-generated tasks.
- `update_action_task`: Let the agent automatically mark a task as "Done" and inject resolution notes after pushing a fix to your codebase.
- `compare_screenshots`: Trigger a visual regression check.

---

## 🏗️ Architecture

- **`audit.js`**: The primary orchestrator CLI. Runs the engine pipeline and outputs a styled console summary.
- **`server.js`**: The Express API backend and UI dashboard. Connects the frontend to the database and AI routing logic.
- **`src/engines/`**: Individual runner scripts for Playwright, Lighthouse, Axe, and Mobile Vision.
- **`src/db.js`**: Manages the SQLite database and schema.
- **`mcp/index.js`**: The MCP Server entry point.

---

## 📦 Installation & Setup

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright Browsers:**
   ```bash
   npx playwright install chromium
   ```

3. **Configure Environment:**
   Create a `.env` file in the root directory with your AI API keys:
   ```env
   GEMINI_API_KEY=your_gemini_key_here
   GROQ_API_KEY=your_groq_key_here
   PORT=3001
   ```

---

## 🛠️ Usage

### 1. Launch the Dashboard
The primary way to use the tool is via the web UI:
```bash
npm start
# Opens http://localhost:3001
```

### 2. Run a Headless Audit (CLI)
You can run audits directly from the command line:
```bash
node audit.js https://example.com
```

### 3. Verify a Fix visually (CLI)
When you've made a code change, you can verify if it fixed a visual issue by comparing pixels:
```bash
node compare.js <finding_id>
```

---

## 🗄️ Database Schema (`audits.db`)

The local SQLite database uses robust relational tables:
- **`projects`**: Top-level tracking of domains and their local file paths.
- **`project_pages`**: Sub-pages tracked under a specific project.
- **`audits`**: Stores the high-level audit run metrics (Scores, AI Summaries, AI Tasks JSON).
- **`findings`**: The normalized issues (Category, Severity, Status, Title, Description, Node path).
- **`fix_tracker`**: Stores before/after screenshot paths and `diff_percentage` from `pixelmatch`.

---

## 🤖 MCP Registration for Antigravity

To let your local AI agents run QA workflows autonomously:
1. Ensure the MCP server path is registered in your `mcp_config.json`.
2. When in Antigravity, simply say: **"QA [your_domain]"** or use the included **Site Audit Reporter** skill.
3. You can tell the agent: **"Check the Action Tasks and fix them for me."** The agent will fetch the tasks via MCP, implement the code changes, and update the task status in the dashboard automatically.
