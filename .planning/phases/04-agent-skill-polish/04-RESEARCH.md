# Phase 4: Agent Skill + Polish - Research

## CLI Polish with `chalk` and `ora`
- We will install `chalk` and `ora`.
- Note: Both `chalk` and `ora` are pure ESM packages. Our project uses ES modules (`"type": "module"` in `package.json`), so we can safely `import chalk from 'chalk'` and `import ora from 'ora'`.
- `audit.js` currently uses `console.log` for step-by-step progress. We will replace these with `ora` spinners.
- The severity and category summaries at the end of `audit.js` can be styled with `chalk` (e.g., critical = `chalk.red.bold`, serious = `chalk.red`, moderate = `chalk.yellow`, minor = `chalk.cyan`). We can also use `console.table` for a structured output of the findings or counts.

## SKILL.md
- The `SKILL.md` file needs to be placed at `~/.gemini/config/skills/site-audit-reporter/SKILL.md` (and a project-local copy).
- The skill should instruct the agent to run `node audit.js <url>` when asked to audit or QA a site.
- It should explain how to read the JSON or markdown reports.
- Wait, the skill should actually call the newly created MCP tools if possible, OR it can call `node audit.js`. Wait, Phase 3 created the MCP server. If the MCP server is registered, the agent can just call `run_audit` and `get_findings`. So the `SKILL.md` should instruct the agent to use the `site-audit` MCP tools (`run_audit(url)` and `get_findings(auditId, format: 'markdown')`).
- If the agent is instructed to verify a fix, it should use `compare_screenshots(findingId)`.
- The guidelines MUST say: "never invent findings, flag 403/999 as 'needs manual check'" as specified in the ROADMAP.

## README.md
- The README should contain:
  - Project Goal & Overview
  - Architecture (CLI, Dashboard, MCP Server)
  - Installation Instructions (npm install, Playwright browsers)
  - Usage (CLI commands, Dashboard start)
  - SQLite Database schema overview
  - Instructions on adding new tools (like Pa11y)
  - Details on the Antigravity integration (MCP Server + Agent Skill)

## RESEARCH COMPLETE
