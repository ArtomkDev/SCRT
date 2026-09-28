---
name: discord-bot-engineering
description: Work on SCRT's discord.js bot lifecycle, commands, installation permissions, and Discord protocol boundary.
---
# Discord bot engineering

Keep Gateway intents minimal; add privileged intents only with a documented module need. Register commands explicitly and use guild registration only for nonproduction development. Handle interactions within Discord's response window and report failures once. Guild events may repeat across reconnects, so persistence must be idempotent. Keep bot installation permissions centralized in `packages/discord` and account for Discord API rate limits before introducing scans or bulk jobs.
