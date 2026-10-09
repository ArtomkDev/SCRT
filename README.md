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
| `DISCORD_GUILD_MEMBERS_INTENT` | Set to `true` on the bot worker after enabling Guild Members Intent in the Discord Developer Portal; enables live member search updates |
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

SCRT Control always grants full access to the current Discord guild owner. **Керування доступом** has three levels: **Повний доступ** (`SUPER_ADMIN`, manage modules and access), **Налаштування бота** (`ADMIN`, manage modules), and **Лише перегляд** (`VIEWER`). Owners and super admins can assign roles and personal grants. A full-access grant can only be changed or removed by the current owner or its issuer; peers cannot overwrite it, demote it, or claim it through a no-op save. See [access policy and storage](docs/access-control.md). All users with `settings.view` see the three access-role lists and their member previews; viewers receive only members of configured access roles, while users with `settings.manage` can read the full guild directory. Each member appears under their highest mapped Discord role only; expanding a role loads its member cards in small batches. The member picker searches the guild roster locally on every keystroke across guild nickname, global display name, username, and Discord ID. The roster is delivered in one streamed request and member previews appear as pages arrive. Discord role colors, gradients, avatars, and guild nicknames are shown. Guild member pages are cached in bounded server memory for 120 seconds, keyed by credential fingerprint, guild, directory revision and cursor; Firestore stores revisions and live changes, not a copy of every member. With Guild Members Intent enabled, join, leave, and profile updates reach the picker through live events; a periodic reconciliation covers missed events. Discord Manage Server or Administrator alone does not grant SCRT Control access after installation. Role mappings (`mappings`) and member mappings (`members`) are stored per guild in `guilds/{guildId}/access/roles` and checked against current Discord membership on each server operation. Removing a mapping revokes the corresponding permission unless another role or individual grant still applies; the owner retains access.

For a new installation, SCRT initializes `@everyone` as **Лише перегляд** and each current Discord Administrator role as **Повний доступ**. `@everyone` cannot be promoted to configuration access. The dashboard's **Додати бота** flow also grants **Повний доступ** to the verified installer through an OAuth code callback, unless the installer is the guild owner. The owner is never added as a personal grant and legacy owner entries are hidden in the personal list. Ordinary callback-less bot invite URLs cannot identify the installer, so they only receive the role defaults. The existing OAuth callback URI serves both login and installation. Reconnects and upgrades preserve the access mappings already selected; existing installations are not silently migrated to these defaults. Their owner can promote selected administrators to **Повний доступ** through the new selector.

Create one application in the Discord Developer Portal and enable its bot. Set its OAuth redirect URI to `http://localhost:3000/api/auth/callback` for local work and `<production-origin>/api/auth/callback` in production. Fill the bot token, application ID and client secret. OAuth login requests `identify guilds guilds.members.read` so the backend can verify the current user's Discord roles; bot installation requests `bot applications.commands`. The installation URL is pinned to a selected manageable guild. The bot requests View Channel, Manage Channels, Manage Roles, Move Members, Connect, Send Messages, Embed Links, and Read Message History. It does not request Administrator. The bot uses `GuildVoiceStates` Gateway intent. For full member search, enable **Guild Members Intent** under Bot → Privileged Gateway Intents in the Developer Portal, then set `DISCORD_GUILD_MEMBERS_INTENT=true` on the bot worker and restart it. If the intent is unavailable, the picker falls back to Discord's prefix search or exact ID lookup without a page reload.

For a guild where SCRT was installed before Voice, open **Голосові канали → Дозволи → Оновити дозволи** and authorize the updated bot permissions in Discord. Check effective permissions on each Creator and target category; a category overwrite can still deny the bot. The existing `permissions=0` installation is not upgraded automatically.

To set up Voice, open **Голосові канали → Налаштування** and enable the module. Add one or more Creator channels in **Creator-канали**, selecting an existing voice channel or creating one through the dashboard. Each Creator has independent room defaults, target category, access rules and owner features. Members join a Creator to create a temporary room. Owners use `/voice` or a room greeting panel; administrators can publish a shared Interface Message in **Інтерфейси**. Empty rooms are deleted after the configured delay. A room reset restores Creator defaults and clears temporary permit/block lists without changing ownership.

On startup the bot loads SCRT room records, removes records whose channels no longer exist, restores active rooms and ownership, and reschedules cleanup and owner-leave timers. It never infers managed rooms from their names and never recreates missing rooms. Creator configuration changes are observed through Firestore. A Railway redeploy does not require a persistent disk.

Run `pnpm deploy:commands` after filling credentials. With `DISCORD_GUILD_ID` in local development it registers to that guild; production and Railway register global commands, which can take time to propagate. Railway is recognized by its provided `RAILWAY_ENVIRONMENT_ID` or `RAILWAY_PROJECT_ID`, so a leftover development guild ID cannot target the test server on the host. The bot reconciles guild records on ready and handles join/leave events. A join merges metadata without replacing access settings; a leave marks the record disconnected.

## Activity Tracking & Leaderboards

Open **Активність → Налаштування** to enable guild-scoped messages, voice time, screen-share time, Discord-visible Playing games and daily voice streaks. The dashboard includes today/7-day/30-day/all-time leaderboards, game/player rankings and member profiles. Activity starts disabled and does not implement XP or levels. It stores metadata only: no message content, voice audio or screen content.

The worker uses `Guilds`, `GuildMessages`, `GuildVoiceStates` and, when available, privileged `GuildPresences`. **Enable Presence Intent in Discord Developer Portal → Bot → Privileged Gateway Intents, then restart the bot.** Without it, messages/voice/screen sharing still work and Games health reports unavailable. Message Content Intent is never requested; Activity does not enable Guild Members Intent.

Messages flush every 60 seconds. Persistent sessions aggregate at close and five-minute checkpoints, with atomic cursor updates and timezone/DST-aware daily splitting. Restart recovery closes at the last durable observation and starts fresh from current Discord state, so unknown downtime is not invented. SIGINT/SIGTERM attempt a final flush within a 12-second deadline. Keep one Railway bot replica.

Activity documents are under `guilds/{guildId}/activity*`. Daily/all-time aggregates remain; closed sessions are removed after aggregation. AFK/channel/category/role/user exclusions are centralized. Streaks require five minutes per guild-calendar day by default. See [Activity architecture, schema, recovery, indexes and manual verification](docs/activity.md). Run `pnpm --filter @scrt/bot verify:activity` for isolated Firestore/Gateway verification; deploy `firestore.indexes.json` for efficient compound queries. Bounded server fallbacks keep private-server rankings correct while indexes are unavailable.

## Media

The guild-scoped **Медіа** module provides a web remote player, Discord Voice audio, protected controls, search, a fair queue, vote skip, history and conservative restart recovery. Direct audio, an approved radio catalog and accessible public YouTube/SoundCloud audio can play. Bot dev/build scripts install the pinned extractor automatically; Spotify provides metadata only. See [Media setup, security, providers and manual acceptance](docs/media.md). Railway's bot service needs FFmpeg and an authenticated Media control endpoint shared with the separate web service.

## Firebase setup

Create a Firebase project and Firestore database in production mode. Create a dedicated service account with Firestore access. Put its project ID, client email and private key into the server environment. The Admin SDK bypasses Firestore client rules; this app uses only server-side Admin access and the web guard enforces Discord identity and guild permissions. No browser Firebase configuration is needed. Restrict service account access and rotate it if exposed.

## Firebase App Hosting (web)

Set the backend's App root directory to `/`, not `apps/web`. The pnpm lockfile and workspace definition live at the repository root. The root `apphosting.yaml` overrides build and start commands to target only `@scrt/web`, with shared workspace dependencies available. Firebase installs dependencies using the root `pnpm-lock.yaml` and `packageManager` version. The custom build explicitly installs development dependencies with `--prod=false` because the generic pnpm buildpack initially installs only production dependencies; Next.js needs TypeScript, React types, and Tailwind/PostCSS to build. This custom build bypasses Firebase's framework adapter; the web runs with `next start` and the workspace files are retained in the deployment image. Commit and push `apphosting.yaml` before creating a rollout, and verify that the rollout targets the new commit.

Set `NODE_ENV=production`, `NEXT_PUBLIC_APP_URL` to the backend's public HTTPS origin, `DISCORD_CLIENT_ID`, and `FIREBASE_PROJECT_ID`. Store `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` through Secret Manager references instead of plain-text console values. The web server uses the bot token for Discord API calls and permission checks; it does not start the bot worker. `DISCORD_GUILD_ID` and `DISCORD_GUILD_MEMBERS_INTENT` are not required for the web.

The private key must contain only the PEM value, including its BEGIN/END markers, with real line breaks or escaped `\n`; do not paste adjacent fields from the service account JSON. Register `<NEXT_PUBLIC_APP_URL>/api/auth/callback` in Discord OAuth redirects. After changing environment variables or secrets, create a new rollout. Rotate any credentials exposed in build logs before deploying again.

## Railway

Deploy the bot as a persistent worker from the repository root. Select Railpack and set `RAILPACK_CONFIG_FILE=railpack.bot.json` on the **bot service only**. This configuration installs FFmpeg in the runtime image, installs development dependencies needed for compilation even with `NODE_ENV=production`, and selects the bot build/start commands. If overriding commands in Railway settings, use build `pnpm install --frozen-lockfile --prod=false && pnpm --filter @scrt/bot build` and start `pnpm --filter @scrt/bot start`. Set `MEDIA_INTERNAL_HOST=::`, `MEDIA_INTERNAL_PORT=3100`, an independent `MEDIA_INTERNAL_SECRET` of at least 32 characters, and one bot replica. Before enabling Media, run `node apps/bot/dist/verify-media.js` from the repository root in the deployed container; this diagnostic does not connect to Discord. See [Media deployment configuration](docs/media.md#railway-release-check).

Set the bot's required environment variables in Railway; no local `.env` or persistent volume is required. Deploy the web app as a separate service with build command `pnpm install --frozen-lockfile --prod=false && pnpm --filter @scrt/web build`, start command `pnpm --filter @scrt/web start`, and its required environment variables. Configure the same `MEDIA_INTERNAL_SECRET` on web and bot and a web-only `MEDIA_BOT_URL` that reaches the bot. Set `NEXT_PUBLIC_APP_URL` to the web service's public HTTPS origin and add its OAuth callback URL in Discord. Register global commands from a credentialed deployment environment using `pnpm deploy:commands`.

The bot tolerates reconnects and restart through guild and Voice reconciliation. Firestore is the persistent store. Guild and room recovery failures are logged individually; there is no local disk dependency.

Set `NODE_ENV=production` on the bot service and remove the local-only `DISCORD_GUILD_ID`. Optional Pre-deploy Command: `node apps/bot/dist/register-commands.js` (from the repository root); keep the persistent Start Command above. A successful build followed by `DiscordAPIError[50001]: Missing Access` in `register-commands.js` is a command-registration failure before the worker starts. Check the logged application ID and registration scope: the hosted deployment must use `global`, and `DISCORD_CLIENT_ID` must belong to `DISCORD_BOT_TOKEN`. The registration script uses platform environment variables in production/Railway and does not load a local `.env` there.

## Graphify and Codex

The project-scoped Graphify Codex installer owns its section in `AGENTS.md` and its files under `.codex`. Install the official `graphifyy` CLI, then run `graphify codex install --project` if those files are missing. Build the graph with `graphify .`, query with `graphify query "<question>"`, and refresh after code changes with `graphify update .`. Without an LLM API key, use `graphify . --code-only` to index source files locally. The generated `graphify-out/` is ignored. Project-specific skills are in `.agents/skills/`.

## Current status and next modules

Activity lists and detail pages support cached artwork, deterministic fallbacks and administrator overrides. Optional server-only providers use `STEAMGRIDDB_API_KEY`, `IGDB_TWITCH_CLIENT_ID`, and `IGDB_TWITCH_CLIENT_SECRET`; setup, priorities, TTLs and controls are documented in [Activity artwork](docs/activity-artwork.md).

The implemented path includes OAuth login, guild authorization, access-role/member editors, Temporary Voice lifecycle, and Activity tracking/leaderboards. Credentials, Presence Intent and manual Discord interactions are required to complete live acceptance. XP/Levels can consume the normalized Activity outputs in a later milestone; XP, moderation, automation and rewards are not implemented here.
