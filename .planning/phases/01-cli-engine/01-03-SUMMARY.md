# 01-03: Normalization & CLI Orchestrator Complete

## What Was Built
- Implemented `src/normalize.js` to map findings from all 4 engines into the unified `{ category, severity, title, description, selector, source_url, source_tool }` schema.
- Built the `audit.js` CLI entry point.
- The CLI automatically initializes the database, sequences Playwright → axe-core → Lighthouse → Linkinator.
- Findings are successfully saved to SQLite and exported as a JSON report in `reports/`.
- Terminal output shows a structured summary of the audit.

## Key Files
- `src/normalize.js`
- `audit.js`

## Verification
- Tested `node audit.js https://example.com`. The CLI successfully executed all engines, generated a screenshot, saved data to SQLite, and wrote the JSON report to `reports/`.
