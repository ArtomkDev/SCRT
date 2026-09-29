# SCRT Control

Private-first Discord server control platform. The first feature module provides temporary voice rooms with Creator channels, room ownership and controls, a protected multi-guild dashboard, and restart recovery.

## Architecture

This pnpm workspace is a modular monolith:

| Path | Responsibility |
| --- | --- |
| `apps/bot` | Persistent discord.js Gateway worker, slash commands, guild and Voice lifecycle |
| `apps/web` | Next.js App Router dashboard, OAuth routes, server-side guards |
| `packages/config` | Validated runtime environment |
| `packages/database` | Singleton Firebase Admin, guild and Voice repositories |
| `packages/discord` | Discord OAuth/API and installation URLs |
| `packages/permissions` | Pure application permission policy |
| `packages/validation` | Untrusted input schemas |
| `packages/shared` | Domain records and structured logging |

Firestore uses `guilds/{guildId}`. The root record stores guild identity, installation state and timestamps. `guilds/{guildId}/access/roles` may store `{ mappings: [{ discordRoleId, appRole }] }`. The owner receives Super Admin independent of this document. Voice uses `voiceSettings/main`, `voiceCreators/{channelId}`, `voiceRooms/{channelId}`, `voiceInterfaces/{channelId}`, and `voiceAudit/{autoId}` under each guild. Room records contain SCRT ownership, access lists and lifecycle state; Discord remains the source for channel name, bitrate, limit and current members. Voice writes on events and control changes, without a heartbeat.

## Requirements and local setup

Node 22.12 or newer and pnpm 11. Copy `.env.example` to `.env` and fill the values below. `.env` is ignored by Git. Run:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:live
```

Use `pnpm dev:bot` and `pnpm dev:web` to run one process. The bot validates its environment at startup; the web app validates production configuration at startup and development configuration on server requests. Empty credentials allow installation and static build but cannot run the login or bot flow.

With development credentials filled, `pnpm verify:live` checks bot identity, OAuth client credentials, development `/ping` registration, and an isolated Firestore write/read/delete. It revokes its temporary OAuth token and prints only credential presence and validation status. It also reports whether the configured development guild has a Firestore record; it does not modify that guild.

| Variable | Use |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `DISCORD_BOT_TOKEN` | Bot Gateway login and server-side guild verification |
| `DISCORD_CLIENT_ID` | Shared Discord application ID |
| `DISCORD_CLIENT_SECRET` | OAuth token exchange and refresh |
| `DISCORD_GUILD_ID` | Optional development guild for fast command registration |
| `NEXT_PUBLIC_APP_URL` | Public dashboard origin, e.g. `http://localhost:3000` |
| `SESSION_SECRET` | Random secret of at least 32 characters for encrypted HTTP-only cookies |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | Service account key; multiline or escaped `\n` |

`NEXT_PUBLIC_APP_URL` is public; every other credential stays server-side. Use a unique session secret per environment. OAuth access and refresh tokens are encrypted in a seven-day HTTP-only cookie and refreshed through a route handler.

## Discord setup

Create one application in the Discord Developer Portal and enable its bot. Set its OAuth redirect URI to `http://localhost:3000/api/auth/callback` for local work and `<production-origin>/api/auth/callback` in production. Fill the bot token, application ID and client secret. OAuth login requests `identify guilds guilds.members.read` so the backend can verify the current user's Discord roles; bot installation requests `bot applications.commands`. The installation URL is pinned to a selected manageable guild. The bot requests View Channel, Manage Channels, Manage Roles, Move Members, Connect, Send Messages, Embed Links, and Read Message History. It does not request Administrator. The bot uses the nonprivileged `GuildVoiceStates` Gateway intent; privileged Gateway intents remain disabled.

For a guild where SCRT was installed before Voice, open **Голосові канали → Дозволи → Оновити дозволи** and authorize the updated bot permissions in Discord. Check effective permissions on each Creator and target category; a category overwrite can still deny the bot. The existing `permissions=0` installation is not upgraded automatically.

To set up Voice, open **Голосові канали → Налаштування** and enable the module. Add one or more Creator channels in **Creator-канали**, selecting an existing voice channel or creating one through the dashboard. Each Creator has independent room defaults, target category, access rules and owner features. Members join a Creator to create a temporary room. Owners use `/voice` or a room greeting panel; administrators can publish a shared Interface Message in **Інтерфейси**. Empty rooms are deleted after the configured delay. A room reset restores Creator defaults and clears temporary permit/block lists without changing ownership.

On startup the bot loads SCRT room records, removes records whose channels no longer exist, restores active rooms and ownership, and reschedules cleanup and owner-leave timers. It never infers managed rooms from their names and never recreates missing rooms. Creator configuration changes are observed through Firestore. A Railway redeploy does not require a persistent disk.

Run `pnpm deploy:commands` after filling credentials. With `DISCORD_GUILD_ID` in development it registers to that guild; production registers global commands, which can take time to propagate. The bot reconciles guild records on ready and handles join/leave events. A join merges metadata without replacing access settings; a leave marks the record disconnected.

## Firebase setup

Create a Firebase project and Firestore database in production mode. Create a dedicated service account with Firestore access. Put its project ID, client email and private key into the server environment. The Admin SDK bypasses Firestore client rules; this app uses only server-side Admin access and the web guard enforces Discord identity and guild permissions. No browser Firebase configuration is needed. Restrict service account access and rotate it if exposed.

## Railway

Deploy the bot as a persistent worker from this repository. Build command: `pnpm install --frozen-lockfile && pnpm --filter @scrt/bot build`. Start command: `pnpm --filter @scrt/bot start`. Set the bot's required environment variables in Railway; no local `.env` or persistent volume is required. Deploy the web app as a separate service with build command `pnpm install --frozen-lockfile && pnpm --filter @scrt/web build`, start command `pnpm --filter @scrt/web start`, and its required environment variables. Set `NEXT_PUBLIC_APP_URL` to the web service's public HTTPS origin and add its OAuth callback URL in Discord. Register global commands from a credentialed deployment environment using `pnpm deploy:commands`.

The bot tolerates reconnects and restart through guild and Voice reconciliation. Firestore is the persistent store. Guild and room recovery failures are logged individually; there is no local disk dependency.

## Graphify and Codex

The project-scoped Graphify Codex installer owns its section in `AGENTS.md` and its files under `.codex`. Install the official `graphifyy` CLI, then run `graphify codex install --project` if those files are missing. Build the graph with `graphify .`, query with `graphify query "<question>"`, and refresh after code changes with `graphify update .`. Without an LLM API key, use `graphify . --code-only` to index source files locally. The generated `graphify-out/` is ignored. Project-specific skills are in `.agents/skills/`.

## Current status and next modules

The implemented path is OAuth login → manageable guild list → installed guild dashboard → protected Voice configuration → Creator join → managed room lifecycle. Credentials and Discord/Firebase setup are required for a live end-to-end run. The Access Control page shows the owner and the backend supports stored Discord role mappings; the mapping editor is future work. Activity tracking, XP, moderation, automation and analytics remain future modules.
