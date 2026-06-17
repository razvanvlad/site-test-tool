# Site Test Tool — Project Guide

> This file is read by Antigravity agents at session start to understand the project context and GSD workflow state.

## What This Project Builds

A **local-first website audit engine** — `node audit.js <url>` captures screenshots, console errors, JS exceptions, network failures, accessibility violations, broken links, and performance metrics into SQLite. Exposed as an MCP server for Antigravity agent use, and packaged as an Agent Skill.

## GSD Workflow State

- **Planning:** `.planning/` directory contains all project context
- **Current Phase:** Phase 1 — CLI Engine (ready to start)
- **Mode:** YOLO (auto-approve)
- **Read state:** `.planning/STATE.md`
- **Read roadmap:** `.planning/ROADMAP.md`

## Key Files

| File | Purpose |
|---|---|
| `.planning/PROJECT.md` | Full project context, stack decisions, future notes |
| `.planning/REQUIREMENTS.md` | All v1 requirements with REQ-IDs |
| `.planning/ROADMAP.md` | 4-phase plan with success criteria |
| `.planning/STATE.md` | Current position, session history, decisions log |
| `site-test-tool-blueprint-v2.md` | Full research blueprint (updated from discovery session) |

## Critical Technical Notes

- **MCP logging:** Write to **stderr only** in the MCP server — stdout is JSON-RPC protocol
- **MCP registration:** Add entry to BOTH `~/.gemini/config/mcp_config.json` AND `~/.gemini/antigravity-ide/mcp_config.json`
- **Node:** v24.13.1 — Lighthouse requires 22+, we have 24 ✓
- **Chrome:** `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **Skills install path:** `C:\Users\razva\.gemini\config\skills\site-audit-reporter\`

## GSD Commands

```
/gsd-plan-phase 1    # Plan Phase 1 in detail
/gsd-execute-phase 1 # Execute Phase 1 plans
/gsd-progress        # Check current state
/gsd-next            # Advance to next step automatically
```
