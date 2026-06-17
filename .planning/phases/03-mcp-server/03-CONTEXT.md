# Phase 3: MCP Server - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap the audit engine as an MCP stdio server so Antigravity can call `run_audit()`, `get_findings()`, and `compare_screenshots()` as agent tools.

</domain>

<decisions>
## Implementation Decisions

### Tool Invocation Behavior
- **D-01:** Synchronous (Blocking). `run_audit` blocks until the audit is fully complete. This is simpler for the agent, provided timeouts are not breached.

### Output Format
- **D-02:** Hybrid/Parameter-driven. The `get_findings` tool will support an argument (e.g., `format: 'markdown' | 'json'`) so the calling agent can decide. Markdown for summaries and reading, JSON for advanced automated programmatic checks.

### Execution Integration
- **D-03:** Subprocess spawning. The MCP server will execute `node audit.js <url>` as a subprocess. This completely isolates the `console.log` noise of Phase 1 from the MCP `stdout` stdio protocol, which is critical.
- **D-04:** Critical Rule inherited from ROADMAP: The MCP server's own diagnostics must be written to **stderr only**.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### General Specs
- `.planning/ROADMAP.md` — Phase 3 requirements (MCP-01 to MCP-05).
- `.planning/PROJECT.md` — Project context and critical rules for stdio output.

</canonical_refs>
