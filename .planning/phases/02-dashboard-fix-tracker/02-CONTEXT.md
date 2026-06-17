# Phase 2: Dashboard + Fix Tracker - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

An Express web dashboard where you can triage findings from any audit run — filter by severity/category, mark false positives, add notes, and view before/after/diff screenshots for fixed issues.
Includes the `compare.js` script to capture post-fix screenshots and run pixelmatch diffs.
</domain>

<decisions>
## Implementation Decisions

### Dashboard Architecture
- **D-01:** Vanilla JS Single Page App (SPA) calling JSON APIs served by Express.
- **D-02:** Use AJAX/Fetch API to update finding status, add notes, or mark false positives instantly inline without page reloads.

### Screenshot Diffing
- **D-03:** Capture element-specific screenshots for the "after" diff (using the finding `selector` if available) to reduce noise. 
- **D-04:** Dashboard Diff Presentation: "Click to toggle" — A single image container that flips between before, after, and diff views when clicked.

### Visual Style & Layout
- **D-05:** OS-Aware CSS Variables — Support both Dark and Light modes out of the box based on system preferences.
- **D-06:** Table View for findings — Dense table that allows sorting/filtering by severity/category, with rows that can expand to show full details (descriptions, notes, diffs).

### Deferred Ideas (Out of Scope for Phase 2)
- Multi-viewport capture runs (Desktop/Tablet/Mobile) for responsive diffs.
- Automated whole-page section mapping and isolation for batch diffs.
*(These advanced capture behaviors belong in a future phase. Phase 2 will focus on element-level precision via finding selectors.)*
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture
- `.planning/PROJECT.md` — Technology Stack (Express + Vanilla JS/HTML/CSS)
- `.planning/REQUIREMENTS.md` — DASH-01 to DASH-04, DIFF-01 to DIFF-02
</canonical_refs>
