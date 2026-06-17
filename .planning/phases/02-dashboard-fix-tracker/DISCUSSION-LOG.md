# Phase 2 Discussion Log

**Date:** 2026-06-17

## Q1: Dashboard Architecture
**Options:**
- Vanilla JS SPA calling JSON API
- Server-rendered HTML (EJS/Pug)

**Selection:** Vanilla JS SPA calling JSON API

## Q2: Triage Interaction
**Options:**
- AJAX/Fetch API (instant inline updates)
- Form submission (page reload)

**Selection:** AJAX/Fetch API

## Q3: Screenshot Diffing
**Options:**
- Full page diff
- Isolate element

**Selection / User Feedback:** 
"Full page diff sounds too heavy, the pages will be large images and can provide lower quality results. We should separate or setup in the start to map out the page sections. It should map out sections then work on each section, and maybe even add more specific selectors via html class or div name to map out or filter specific. Does that sound good? There should also be desktop/tablet/mobile separate view for each section with the option to select where we work or ignore tablet/mobile as default."

**the agent Synthesis:** User prefers element/section-specific precision. Multi-viewport and automatic section-mapping are advanced workflow orchestrations deferred to a later phase (to prevent scope creep on Phase 2 `compare.js`). Element-specific diffing based on the finding `selector` will be implemented as the Phase 2 baseline.

## Q4: Diff Presentation
**Options:**
- Side-by-side
- Overlay/Slider
- Click to toggle

**Selection:** Click to toggle

## Q5: Visual Style
**Options:**
- OS-Aware (Dark & Light)
- Forced Dark Mode
- Forced Light Mode

**Selection:** OS-Aware (Dark & Light)

## Q6: Findings Display
**Options:**
- Table View (expandable)
- Card View

**Selection:** Table View
