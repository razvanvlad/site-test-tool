# 02-03: Compare Script (Diff Capture) - Summary

## What Was Built
Implemented `compare.js`, a CLI tool to capture visual diffs for specific findings after a fix.
- **compare.js**: 
  - Takes `findingId` via CLI argument.
  - Queries SQLite for finding and audit details (specifically the target URL and `evidence_path` for the before-screenshot).
  - Uses Playwright to navigate to the URL and capture an "after" full-page screenshot (matching Phase 1 baseline dimensions).
  - Runs `pixelmatch` via `pngjs` to generate a diff image and calculate diff percentage.
  - Upserts the results into the `fix_tracker` SQLite table.
- **server.js**: Updated during this task to correctly map database column names (`after_screenshot`, `diff_image`, `diff_pixels`) when joining fix data for the frontend.

## Key Files
### Created
- compare.js

### Modified
- server.js

## Verification
- Script safely validates inputs and fails early if evidence is missing.
- Upsert logic safely handles updates without requiring UNIQUE constraints on the `finding_id` column.
