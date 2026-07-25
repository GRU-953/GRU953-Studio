---
name: studio-update
description: >-
  Manually triggers an update check for Universal Agentic Studio.
---

# Universal Agentic Studio Auto-Updater

This command forces the studio to check for and apply any updates from the upstream repository immediately.

### What is happening?

Universal Agentic Studio is checking if you have the latest skills, rules, and ecosystem improvements.

If an update is found, it will pull the latest version and apply it automatically. You may need to restart your current session to see the effects.

<SKILL>The system is attempting to update the studio. The path to the update script is:
`${CLAUDE_PLUGIN_ROOT}/hooks/auto-update.mjs --force`
Please execute this script now to force an update check, then report the result back to the user.</SKILL>
