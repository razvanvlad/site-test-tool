# 04-02: Agent Skill - Summary

## What Was Built
- Created `site-audit-reporter` Agent Skill.
- The skill defines how an Antigravity agent should react to "QA this site" commands.
- It instructs the agent to run the MCP `site-audit` tool to invoke `audit.js` and retrieve the database findings in Markdown.
- It ensures the agent does not autonomously change code unless explicitly requested by the user, and correctly formats known broken link false-positives.

## Key Files
### Created
- `.agents/skills/site-audit-reporter/SKILL.md` (project-local version)
- `~/.gemini/config/skills/site-audit-reporter/SKILL.md` (global version)

## Verification
- Both files exist. The skill logic matches the roadmap requirements.
