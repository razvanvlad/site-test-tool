# Phase 4: Agent Skill + Polish - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Package the audit workflow as a `SKILL.md` so any agent session knows how to run audits and report findings. Perform a final polish pass on the CLI and write comprehensive README documentation.

</domain>

<decisions>
## Implementation Decisions

### Skill Scope
- **D-01:** The skill will only run the audit and present the findings at first. It will NOT automatically attempt to fix and verify issues. A selector for the category of audit and custom instructions will be considered. Fix/verify automation is pushed to a future v2 stage.

### CLI Polish
- **D-02:** Add `chalk` and `ora` to the CLI to provide a premium feel with colors and loading spinners.

### README Detail Level
- **D-03:** Comprehensive documentation. The `README.md` must cover basic usage, installation, architecture details, the SQLite schema, and instructions on how to add new audit tools.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### General Specs
- `.planning/ROADMAP.md` — Phase 4 requirements (SKILL-01 to SKILL-03).
- `.planning/PROJECT.md` — Overall aesthetic and project goals.

</canonical_refs>
