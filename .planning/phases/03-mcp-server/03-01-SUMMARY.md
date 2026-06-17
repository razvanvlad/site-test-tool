# 03-01: MCP Server Core and Tools - Summary

## What Was Built
Implemented the MCP stdio server utilizing `@modelcontextprotocol/sdk`.
- Installed the SDK.
- Created `mcp/index.js` setting up a `StdioServerTransport`.
- Implemented three tools:
  - `run_audit`: Spawns `node audit.js <url>` and returns stdout.
  - `get_findings`: Queries SQLite database, returning findings in requested format (`json` or `markdown`).
  - `compare_screenshots`: Spawns `node compare.js <findingId>` and returns stdout.
- Verified that all internal MCP diagnostics are correctly written to `stderr` to avoid breaking the stdio protocol.

## Key Files
### Created
- mcp/index.js

### Modified
- package.json

## Verification
- Tools are accessible.
- Execution via subprocess successfully isolates legacy stdout logging from the MCP protocol.
