# Медіа v1

Media is a guild module alongside Temporary Voice and Activity. `/servers/{guildId}/media` is the player; history, settings, sources and diagnostics are separate tabs. There is one Discord audio connection per guild. No microphone audio is received or stored.

## Ownership and control plane

Browser → authenticated Next.js Media API (session-derived identity, strict request and origin validation) → authenticated bot HTTP endpoint → live membership/`PermissionService`/shared Media policy → `MediaCommandService` → `MediaSessionService` → `MediaPlaybackEngine` → Discord Voice. Pages and direct Firestore history reads additionally use `requireGuildAccess`; worker operations have one live authorization boundary in the bot rather than duplicating Discord/Firestore reads in web.

`packages/media` owns providers, safe audio HTTP and the deterministic queue scheduler. `packages/permissions` owns pure control policy; `packages/validation` owns schemas; `packages/shared` owns public metadata/session types; `packages/database` owns Firestore. Gateway and audio live in `apps/bot`. Web never imports bot runtime or handles audio. Media uses the existing VoiceStateUpdate and ChannelDelete dispatchers, including deletion by TempVoice.

`POST /internal/media` requires an independent bearer secret with at least 32 characters and accepts only validated state/search/settings/semantic-command requests. The endpoint caps bodies at 64 KiB, limits concurrent requests and throttles per guild/actor/operation. Unknown paths and unauthenticated requests fail closed. All commands fetch live Discord membership/roles and re-read current Gateway voice location. Actor IDs in browser payloads are rejected; the web derives them from the authenticated session. Web mutations enforce origin and JSON content type. Public bot endpoints require HTTPS in web configuration; private Railway and loopback HTTP origins are supported. The endpoint carries no bot/OAuth token or provider credentials in responses.

## Permissions and precedence

`media.view`: player, search and history. `media.request`: ordinary queue requests and configured same-Voice actions. `media.control` or a configured DJ role: broader playback controls. `media.manage`: module settings and administration. Existing SCRT owner/SUPER_ADMIN/ADMIN mappings grant management; VIEWER now also grants `media.request` so regular guild members can participate. This is intentional: they remain unable to change settings, remote-admin policy, volume or other unrestricted controls by default.

All controllers, including DJs, must be in the session Voice. `media.manage` bypasses location for ordinary controls only when `allowRemoteAdminControl` is enabled; default false. Starting audio always needs an eligible Voice. Ordinary users restore in the original Voice; a manager can explicitly choose “Відновити тут” to move a saved queue into their current eligible Voice and start it, including after the original temporary channel was deleted. Restoration rechecks live location and effective ViewChannel/Connect/Speak before joining. `MOVE_SESSION` requires media.manage, current presence in the target channel and the same effective permissions. Moving an active session restarts the current track from the beginning, preserves the queue and explains the behavior in a confirmation dialog.

Control modes OPEN/QUEUE/DJ and `sameVoiceUsersCan` configure ordinary actions. Defaults permit requests, pause/resume and own removal/reordering, with stronger actions reserved for DJ/manage. Own reordering cannot cross another requester's items. Session locks take precedence: DJ lock restricts controls while allowing configured requests; admin lock requires media.manage. DJs cannot set an admin lock.

Default skip mode is vote, ratio 0.5 rounded up, minimum one. Count all currently connected humans, including deafened users; ignore bots. Votes live in runtime and are tied to the current queue item. Leaving removes a vote; listener join/leave recalculates the threshold. Track, lock and settings changes clear votes. DJ/manage can directly skip. DJ/admin locks also restrict voting; remote administrators cannot vote on behalf of listeners.

## Sources

| Provider | Search | Metadata | Playback | Live | Seek |
| --- | --- | --- | --- | --- | --- |
| Direct HTTP audio | Exact URL | Filename/host + audio headers | Yes | ICY radio headers | No |
| Operator radio catalog | Titles and exact public station URL | Configured station | Yes | Yes | No |
| Spotify Web API | Official API, optional credentials | Track/artist/artwork/duration when supplied | No | No | No |
| YouTube / YouTube Music | yt-dlp, track URL or title/artist | Video/channel/artwork/duration | Public HTTP audio | No | No |
| SoundCloud | yt-dlp, track URL or title/artist | Track/artist/artwork/duration | Public HTTP audio | No | No |

YouTube and SoundCloud use a pinned official yt-dlp standalone build installed automatically by bot dev/build scripts (Windows x64, Linux x64/arm64 and macOS). No provider API key is needed for this audio path. Only public, non-age-gated HTTP audio is supported; playlists, HLS, private/authenticated content and access restrictions are not bypassed. A source may refuse requests from a hosting IP or demand authentication. Those failures are reported explicitly; a working extractor does not guarantee every upstream track is accessible. Spotify remains metadata-only and offers external links. Source URLs are routed to their provider and cannot masquerade as direct playable audio.

The executable runs without a shell, local configuration or plugins and receives only canonical provider URLs or bounded provider search expressions. Child environments omit SCRT credentials. Each extraction has a 20-second timeout, a 2-MB JSON limit, socket/retry bounds and a four-process concurrency limit. Signed CDN URLs and upstream headers remain transient in a bounded 128-entry, 30-second worker cache; queue/history and responses store only canonical track references. Search → selection → playback can reuse a recently inspected public audio resource. Expired entries are extracted again; failed stream opens invalidate the entry. Every playback open still passes the DNS-pinned, SSRF-protected HTTP transport and provider CDN allowlist. FFmpeg receives bytes over stdin only.

Search uses explicit submission, bounded provider fanout, in-flight coalescing, a 128-query/page, 2-minute runtime cache and bounded responses. «Завантажити ще» requests a validated page from 0 to 9 and appends distinct canonical track identities. Online audio searches extract only three items from the selected result range and print only the required JSON fields; full format/thumbnail collections never consume the process output budget. Exact track URLs have no further page. Catalog 429 responses respect Retry-After with a bounded cooldown. Outages are isolated by provider. Optional credentials never prevent bot startup. Health reports configuration and recent failures; it is not a continuous upstream availability probe.

YouTube Music `watch?v=...`, YouTube watch/short/live/embed and youtu.be URLs normalize to one video ID, ignoring share/playlist parameters. SoundCloud track URLs normalize to their public path. The optional YouTube Data API remains a metadata-only fallback when the audio extractor is unavailable. Search results distinguish playable tracks from metadata and report source/access failures instead of false empty matches.

Direct URLs are limited to HTTP/HTTPS on normal ports without credentials, fragments or query parameters. Validate literals and all DNS answers against public address ranges; reject loopback, private, link-local, metadata, reserved IPv4, private/mapped IPv6 and special transition ranges. Each connection pins the validated DNS result and preserves the hostname for TLS verification. Every redirect is independently checked, with at most three redirects, a DNS deadline, an 8-second header timeout and a 15-second stalled-read timeout. Only recognized audio MIME types are accepted; HTML/HLS/playlists are rejected. Search/resolve checks headers and closes the stream without downloading the file. Playback opens a new validated stream.

FFmpeg receives **stdin only**, with `-protocol_whitelist pipe`; user URLs are never FFmpeg arguments. Audio files with unknown duration are capped at the configured maximum decoded duration. Recognized live streams require explicit guild opt-in. Radio stores a canonical station ID, with its stream URL resolved from bot-only configuration at playback; private query tokens are not returned or persisted in queue/history. Do not place secrets in artwork or station `externalUrl` fields.

## Queue, progress and persistence

Queue metadata is embedded in `mediaState/current` so queue/current/revision updates are atomic; maximum 100 total pending/current items bounds the active queue. `played` retains the last 100 distinct completed/skipped tracks, independently of request limits, across navigation, stop and worker restart. Old documents default to an empty retained list. The player shows current, upcoming and played sections; played covers replay through the same authorized command, with a fresh queue identity to reject old engine events. Own-item removal policy applies to retained entries; reordering applies only to upcoming entries. Repeat does not accumulate duplicate retained rows. FIFO and requester round-robin preserve metadata. Fair scheduling starts after the last requester; shuffle randomizes stored upcoming order and repeat controls track/queue end behavior. Failed items never repeat. Runtime transitions make at most three failed-source attempts within a 45-second deadline before preserving the remaining queue for explicit recovery.

Every browser/slash command carries commandId, guildId, actorUserId, sessionId and expectedQueueVersion. A per-guild serial executor and Firestore revision transaction reject conflicts. Durable receipts make identical retries safe; changing the payload with an existing ID is rejected. Version checks apply to controls as well as queue edits, so stale double skip cannot skip a newly started track. Intent is persisted before initial playback. Audible effects and Firestore cannot form one transaction; crash recovery conservatively treats prior audio as interrupted.

The player offers ▶ on search/queue artwork for `PLAY_TRACK` and a separate + action to append. Selecting a queued track preserves its original requester and the other queued tracks; explicit selection takes priority over fair scheduling for that transition. Replacing the current track requires direct-skip/DJ/manage policy and cannot bypass voting, Voice location or session locks. A new session can start under normal request policy. Queue arrows and drag-and-drop preserve backend own-item/fair-mode restrictions.

Playing a search cover includes canonical references for the following loaded, playable results in the current source filter, at most 99. The worker obtains their public metadata from a bounded 512-track/24-hour search cache or persisted retained entries, deduplicates identities, skips prohibited tracks, respects live guild/per-requester limits and appends after existing manual requests. After a worker restart, cache misses resolve through the actual source in a fanout of at most four with a 15-second preparation budget and cancellation. Preparation failures report a safe error before interrupting current audio; browser metadata never authorizes a track. The whole accepted continuation is checkpointed once before playback, so advancing does not depend on an open browser or add one request/write per search result. Source restrictions are refreshed before each audio start; metadata never authorizes a stale/restricted stream. Submitted queues survive restart and use normal explicit recovery.

The player derives its accent from the current cover's dominant chromatic region. A darker tint creates a stronger radial glow around the artwork, fading into the normal surface toward the controls; readable controls retain the lighter accent. A decoded cover overlays the previous cover with a 1.6-second fade while a registered CSS color property interpolates the accent. Previous visible layers remain until the newer one is opaque, including rapid track changes. A 64-cover client cache avoids repeated palette work. YouTube's equivalent JPEG is used where WebP lacks canvas CORS access; other inaccessible artwork keeps a neutral accent and a normally loaded cover. Reduced-motion preferences disable the animation.

Search drafts, completed results (maximum 200), next page, source filter and mobile panel survive page navigation in validated sessionStorage scoped by authenticated user and guild. They expire after 24 hours; disabled storage falls back to normal page behavior. Authorization, pending commands and live session state are never restored from that cache. The last confirmed guild volume remains in `mediaState/current` and is reused for a new playback session, including after a worker restart, clamped to the current guild volume limit.

Pause/resume, volume, repeat, locks and queue edits update the client immediately. An ordered local command stream accepts further clicks while a request is pending and dispatches them with the latest acknowledged session/queue version. Each successful command returns a validated public snapshot, removing state preflight and follow-up GET requests. A rejected/uncertain command rolls back optimistic state, cancels its dependent queued actions and reconciles once; mutations are never automatically retried. Old polls cannot overwrite command acknowledgments. Discord permission checks and Firestore revision/receipt checks still run for every command; audio startup remains subject to upstream network and decoding time.

Ordinary successful controls use the existing synchronization indicator, without a persistent generic success banner. Add/vote acknowledgments appear in a small fixed toast and dismiss after 3.2 seconds without shifting the page. Errors and explicit recovery instructions remain visible until dismissed or the next action.

Progress is interpolated from bot timestamps once per second in a focused client component. State uses non-overlapping 5-second polling only while visible; each poll reauthorizes access and includes runtime listeners/votes. This was chosen over a new cross-process SSE/WebSocket transport to retain a bounded, auditable deployment footprint. Firestore is written at semantic transitions, not for progress or presentation-only listener changes. A separate 60-second ownership lease renews every 30 seconds per installed guild; this is coordination, not a playback clock. Keep **one bot replica**. The lease protects rollout overlap and failed renewal revokes control and stops playback.

Actual guild paths:

```
guilds/{guildId}/mediaSettings/main
guilds/{guildId}/mediaState/current       # session + bounded queue
guilds/{guildId}/mediaHistory/{historyId}
guilds/{guildId}/mediaAudit/{auditId}
guilds/{guildId}/mediaCommands/{commandId}
guilds/{guildId}/mediaLease/worker
guilds/{guildId}/mediaFavorites/{sha256}  # explicit saved-reference repository; UI deferred
```

History loads 25 rows, capped at 50 in the repository, and excludes the configured retention window. History/audit/command receipts have expiresAt timestamps; deploy Firestore TTL policies from `firestore.indexes.json`. Recovery also removes a bounded batch of expired history. Favorites retain only explicit metadata and references; playlist editing/personal favorites are deferred.

## Lifecycle and recovery

States: idle, connecting, buffering, playing, paused, reconnecting, stopping, error. Connections use @discordjs/voice readiness/reconnect lifecycle with bounded recovery; engine errors and expired/unavailable resources mark a history item failed and advance to the next item. Errors never retry a broken resource indefinitely. Permanent disconnect/channel deletion preserves the interrupted track at the front for recovery. Manual moves update actual Voice identity only if the target is eligible; invalid targets interrupt safely.

Empty channel default: pause, wait 120 seconds, leave if still empty, preserve queue. Rejoining cancels the timer and leaves playback paused unless resumeOnRejoin is explicitly enabled. The stop-then-leave alternative saves the interrupted track for a fresh restart. A stream is not started when the channel has no human listeners.

SIGTERM/SIGINT checkpoint queue/current identity, stop FFmpeg and destroy Voice within the existing bot shutdown deadline. On startup any persisted active audio is interrupted, current track returns to the front, session identity rotates, and audio never auto-plays. Authorized users in the original Voice choose **Відновити**. Media engine import/dependency/startup errors degrade Media while Activity and TempVoice remain available.

## Setup

1. Update the bot install permissions to include **Speak**, plus ViewChannel and Connect, and check effective channel/category overwrites. No Administrator, MessageContent or new privileged intent is required by Media. `/media` replies are ephemeral; existing core message permissions remain centralized.
2. Use Node >=22.12 for pinned @discordjs/voice 0.19.2, installed `opusscript` and the bundled DAVE library. Install FFmpeg on PATH, or set MEDIA_FFMPEG_PATH to a server executable path. Dependency health is checked at startup; missing FFmpeg degrades Media.
3. Bot and web: set the **same independent random MEDIA_INTERNAL_SECRET** (at least 32 characters; different from SESSION_SECRET). Locally set bot host 127.0.0.1, port 3100, and web MEDIA_BOT_URL=http://127.0.0.1:3100.
4. Railway bot: set MEDIA_INTERNAL_HOST=::, MEDIA_INTERNAL_PORT=3100 and RAILPACK_CONFIG_FILE=railpack.bot.json. The bot-specific config retains generated runtime packages and adds FFmpeg. Web on the same Railway project: MEDIA_BOT_URL=http://<bot-service>.railway.internal:3100. Web outside that private network needs an HTTPS bot domain pointing to port 3100. Configure only one persistent bot replica. The HTTP port is an authenticated control plane, not a keepalive.
5. Bot-only optional Spotify credentials: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET; YouTube: YOUTUBE_API_KEY. No provider key belongs in NEXT_PUBLIC_* or browser code. Availability depends on official API access/quota.
6. Bot-only radio catalog: MEDIA_RADIO_CATALOG_JSON is an array of `{id,title,artist?,url,externalUrl,artworkUrl?}` for streams the operator is permitted to relay. Empty array disables radio search. Enable guild allowLiveStreams for radio.
7. Deploy Firestore index/TTL configuration. Register `/media` with `pnpm deploy:commands` in the intended environment. Enable the module through Media settings; choose DJ roles, Voice allow/deny lists or categories, queue policy and remote-admin behavior.

## Railway release check

Names visible in the Railway variables screenshot do not verify their values or whether they are configured on both services. Keep the repository root as the source root because the bot imports shared workspace packages. Select the Railpack builder and apply `RAILPACK_CONFIG_FILE` to the bot service only; the checked-in configuration supplies installation, build, start and runtime FFmpeg. Keep one persistent bot replica. A service settings command override must match these commands; installation must include `--prod=false` so TypeScript and tsup are available with `NODE_ENV=production`.

| Service | Variable | Required value |
| --- | --- | --- |
| Bot | `NODE_ENV` | `production` |
| Bot | `RAILPACK_CONFIG_FILE` | `railpack.bot.json` |
| Bot | `MEDIA_INTERNAL_HOST` | `::` |
| Bot | `MEDIA_INTERNAL_PORT` | `3100` (also the code default) |
| Bot and web | `MEDIA_INTERNAL_SECRET` | The same independent random value, at least 32 characters, different from `SESSION_SECRET` |
| Web | `MEDIA_BOT_URL` | `http://<bot-service>.railway.internal:3100` when both services are in the same Railway project **and environment**; otherwise the bot's public HTTPS origin |

For web hosted in Firebase App Hosting, Railway's private hostname is unreachable. Give the bot a Railway HTTPS domain targeting port 3100 and use that HTTPS origin in web `MEDIA_BOT_URL`. Keep bearer authentication enabled. Restart/roll out both services after changing the shared secret. Provider credentials on the screenshot (`STEAMGRIDDB_API_KEY`, `IGDB_TWITCH_CLIENT_ID`, `IGDB_TWITCH_CLIENT_SECRET`) serve Activity artwork; they do not enable Media audio. Public YouTube/SoundCloud playback does not require a new API key. Spotify and the radio catalog remain optional.

In the deployed bot container, run `node apps/bot/dist/verify-media.js` from the repository root (or `node dist/verify-media.js` from `apps/bot`). It validates control configuration, loads FFmpeg/Opus/DAVE and executes the installed extractor's version probe. A missing/non-executable extractor, invalid control configuration, missing/shared secret or unavailable engine exits unsuccessfully. A successful result verifies local dependencies only: it does not verify web reachability, upstream access, Firestore permissions or audible Discord playback. Do not run this diagnostic as the persistent Start Command.

Before enabling the module on the main Discord server, confirm worker startup logs include `media / internal.started`, `media / recovery.complete` for the guild and `bot / ready`. On the web Media diagnostics page, verify the worker and engine are available. Grant effective ViewChannel, Connect and Speak, register global `/media`, deploy Firestore index/TTL configuration with `firebase deploy --only firestore:indexes`, then enable Media. Complete the live manual sequence below, including an interrupted-worker queue restore. Initial playback may be delayed by the previous worker's 60-second ownership lease during a rollout.

Deployment audit on 2026-10-10 fixed immediate settings-save retries, late reconnect completion after session destruction/replacement, Voice-location changes during session moves, and enforcement of updated channel restrictions before queue advancement. Blocking the active channel in settings now interrupts audio and preserves the queue; removing channel permissions prevents starting the next track without marking the queued track as failed. Production bot startup skips local `.env` loading. `/media play` now reports source access errors without claiming that playable YouTube sources are metadata-only.

Verification: all workspace typechecks and lint passed, bot and web production builds passed, and the final package suites passed 903 tests (154 bot, 441 web). Both source and bundled Media diagnostics returned `ready: true` locally with FFmpeg, Opus, DAVE and the executable extractor. Official checksums matched the pinned Windows x64 and Linux x64/arm64 extractor assets. Railway rollout, deployed-container validation, web-to-hosted-worker connectivity and live Discord audio remain **BLOCKED: not performed in this audit**.

For local development, save the root `.env` and restart both processes with `corepack pnpm dev` after changing environment variables. The bot logs `media / internal.started` with its listening host and port when the control API starts. Media settings show saving progress and safe API errors in a fixed notification; a failed save preserves the unsaved form for retry. Missing FFmpeg prevents audio playback but does not itself prevent saving settings through a running bot.

Startup logs distinguish environment validation, Firebase initialization, the presence-intent check, engine import/dependency checks and Discord login. Discord Voice loads through its supported CommonJS entry because its ESM import stalled in the local Windows `tsx watch` process. The control API starts before Gateway login completes, but requests remain authenticated and settings changes require a ready Discord client and ownership of the guild's worker lease.

Guild lease acquisition and renewal retry every 30 seconds, including when an old process still holds the 60-second lease after a development restart. A denied or failed renewal immediately disables commands and suspends audio. Recovery reads current persisted state and preserves queued tracks for explicit resume; it never auto-plays. Removed guilds and shutdown cancel retries, and releasing a lease can only update the releasing worker's own record.

Provider docs: [Discord Voice](https://discord.js.org/docs/packages/voice/0.19.2), [Spotify search](https://developer.spotify.com/documentation/web-api/reference/search), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [Railpack runtime packages](https://railpack.com/guides/installing-packages).

## Acceptance

Automated checks cover policy, schemas, SSRF, scheduling, votes, idempotency, concurrency, session playback transitions with an engine double, recovery, channel deletion, internal HTTP authentication and web transport guards. They do not prove live Discord audio or a Railway rollout.

Player upgrade verification on 2026-10-09: `pnpm typecheck`, `pnpm lint` and `pnpm build` passed. The full suite passed 847 tests; two further bot regressions then passed with the complete bot suite (133 bot, 418 web; 849 tests across the final package suites). Tests cover immediate controls while worker replies are deferred, ordered versioned queue edits, rejection rollback, reconciliation races, stale polls, direct-play policy, exact selection in fair mode, receipt replay and audio-resource cache expiry. An authenticated local browser verified real worker acknowledgments for artwork playback and pause/resume, plus desktop and 390px layouts without horizontal overflow. Browser state showed SoundCloud and YouTube playback; this check did not measure audible output or hosting latency. Railway rollout and multi-user/empty-channel scenarios remain outside this upgrade's live verification.

Manual sequence: enable → join Voice → search/play approved audio → pause/resume → add second track → skip → volume as DJ → second user same-Voice control → leave/different-Voice denial → vote threshold/join/leave → empty grace/rejoin → stop → bot leaves → restart worker → recover queue explicitly. Verify TempVoice deletion, Activity tracking, OAuth, access mappings and responsive 390/1440/2560px layouts. Record **BLOCKED** when not actually performed.
