# Phase 3 Discussion Log

**Date:** 2026-06-17
**Phase:** 3: MCP Server

## Tool Invocation Behavior
- **Options Presented:** 
  - (Recommended) Synchronous (Blocking)
  - Asynchronous (Job ID + Polling)
- **Selection:** (Recommended) Synchronous (Blocking)
- **Notes:** Simple approach.

## Output Format
- **Options Presented:** 
  - (Recommended) Formatted Markdown Summaries
  - Raw JSON Arrays
- **Selection:** "Add both, it seems the md is better for a simple page and JSON for a more advanced check like maybe a form submission or a product ordering with checkout, is this correct?"
- **Notes:** Agreed to add a parameter `format: 'markdown' | 'json'` to support both use cases on the fly.

## Execution Integration
- **Options Presented:** 
  - (Recommended) Spawn as a subprocess (`node audit.js`)
  - Import functions directly into the MCP process
- **Selection:** (Recommended) Spawn as a subprocess (`node audit.js`)
- **Notes:** Selected subprocess execution to isolate stdout.
