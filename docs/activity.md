# Activity Tracking & Leaderboards

Activity is disabled until a guild administrator enables **Активність → Налаштування**. It measures messages, eligible voice presence, screen-share duration and Discord-visible Playing activities. It does not award XP, levels, roles, rewards or currency.

## Ownership

- `apps/bot/src/modules/activity`: thin Gateway integration, central eligibility, message buffering, per-member session serialization and restart/reconnect recovery. `ActivityModule` orchestrates `MessageActivityBuffer`, `ActivitySessionService` and pure voice/game transition functions.
- `packages/database`: validated guild paths, atomic cursor/aggregate commits, settings listeners, health and normalized leaderboard queries. `ActivityLeaderboardService` is instantiated per web request; its settings/daily read memoization never crosses requests.
- `packages/validation`: settings/session runtime schemas and canonical query enums.
- `packages/shared`: domain outputs, game identity, calendar boundaries, streak policy and Ukrainian duration presentation.
- `packages/permissions`: `activity.view` for reports; `activity.manage` for settings. VIEWER can read, ADMIN can configure, the owner remains Super Admin. Existing dashboard membership guards remain authoritative; no authorization cache is added.
- `apps/web`: protected server components and a small exclusion picker. Activity and Temporary Voice share one `voiceStateUpdate` dispatcher and independent error handling. Temporary Voice behavior is unchanged.

## Gateway intents and Portal

| Intent | Purpose |
| --- | --- |
| `Guilds` | Guild/channel/category metadata and lifecycle |
| `GuildMessages` | Count original guild message creation events |
| `GuildVoiceStates` | Voice joins, moves, leaves and streaming flag transitions |
| `GuildPresences` | Playing activity appearance/disappearance; requested only when preflight reports availability |
| `GuildMembers` | Existing optional directory integration only, controlled by `DISCORD_GUILD_MEMBERS_INTENT`; Activity does not require or enable it |

**MessageContent is never requested.** Enable **Discord Developer Portal → Bot → Privileged Gateway Intents → Presence Intent**, then restart the bot. Preflight reads current application flags through the authenticated Discord REST API. If presence is unavailable (or the preflight fails), the worker connects without GuildPresences and retains messages/voice/screen sharing. If presence is rejected between preflight and login, the worker retries once with a fresh client without that intent. An independently misconfigured optional GuildMembers intent remains an existing startup error.

Discord-visible activity is incomplete: client behavior and privacy/activity-sharing settings affect visibility. Only `ActivityType.Playing` is counted. Listening, Watching, Custom, platform Streaming and Competing are ignored. Multiple Playing activities have independent sessions. Identity prefers `app:<applicationId>`, otherwise `name:<NFKC-normalized, whitespace-collapsed, case-normalized name>`. Different application IDs are never merged. The first observed spelling is canonical for the guild game record; no external artwork service or fuzzy aliases are used.

References: [Discord Gateway intents and close codes](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx), [discord.js VoiceState streaming](https://discord.js.org/docs/packages/discord.js/main/VoiceState%3AClass).

## Firestore schema

Every path below begins with `guilds/{guildId}/`. Sessions contain UTC epoch milliseconds, matching the existing Voice convention. Settings/audit/aggregate bookkeeping use server timestamps. The configured IANA timezone is used only to calculate calendar dates.

| Collection/document | Purpose |
| --- | --- |
| `activitySettings/main` | Enabled flag, tracker flags, bounded exclusions, thresholds, IANA timezone, schema version, server-owned streak revision |
| `activitySessions/{uuid}` | Active session only: guild/user/tracker, game identity when applicable, start, aggregate cursor, last durable observation and the policy captured at start |
| `activityMembers/{userId}` | All-time message/voice/stream totals, current/longest streak, qualifying date/epoch and last activity |
| `activityDailyMembers/{YYYY-MM-DD}_{userId}` | Real daily counters and qualified streak epoch |
| `activityGames/{sha256(gameKey)}` | All-time guild game totals, canonical name, qualified-session count and unique-player counter |
| `activityGameMembers/{hash}_{userId}` | All-time per-game/member totals; creates each unique player only once |
| `activityDailyGames/{date}_{hash}` | Daily game durations and unique-player count for that day |
| `activityDailyGameMembers/{date}_{hash}_{userId}` | Daily per-game/member totals; period unique players are distinct IDs, not sums of daily unique counts |
| `activityProfiles/{userId}` | Last observed Discord name, username, 64px avatar and bounded search prefixes; separate from counters |
| `activityBatches/{sha256(token)}` | Message flush receipt, seven-day expiry and commit time; contains no message/user payload |
| `activityHealth/worker` | Observed connection/presence/recovery/aggregation status and active counts |
| `activityAudit/{autoId}` | Administrative configuration event and server-derived actor; never one entry per message |

Daily/all-time aggregates remain indefinitely. Successfully aggregated closed sessions are deleted atomically. No raw session history accumulates. Flush receipts are cleaned in batches of at most 100 during five-minute reconciliation. User-owned documents have `userId` (or use it as their ID), so future privacy tools can locate a guild/user's data without scanning other guilds. Purge/rebuild workflows are outside this milestone.

## Counting and exclusions

Default minimum voice/stream/game session is 60 seconds. Bots, webhooks and DMs are always ignored. Channel, parent channel, category, role, user and AFK exclusions pass through one eligibility helper. Threads count when their channel, parent and category are eligible; missing category context fails closed when category exclusions exist. The settings picker offers actual guild channels/categories/roles and Discord member search; newly submitted exclusions are validated against guild resources on the server. Existing exclusions may retain former members.

Voice presence includes self/server mute and deafen. An eligible-to-eligible channel move stays continuous; entering AFK/excluded channels closes the counted session. Screen sharing adds `streamSeconds` independently and never subtracts from voice. Game activity has no channel attachment, so channel/category/AFK exclusions apply to messages/voice/stream; user/role exclusions also apply to games.

Original message create counts +1. Edits and deletes have no effect. A bounded 10,000-ID in-memory window suppresses replayed create events; duplicate Gateway delivery outside that window is not a durable exactly-once message guarantee. Flush transactions themselves are idempotent. No content, attachment content, URL, DM payload, voice audio, screen-share video or arbitrary presence payload is read or stored by Activity.

## Write frequency and failure handling

Messages accumulate by guild/user/date. Flush every 60 seconds, or at 1,000 occupied entries. At most 2,000 pending/snapshotted keys are held; capacity exhaustion rejects/logs new keys explicitly. Each transaction handles at most 80 increments, updates member/daily totals with increments and creates an immutable receipt token. Failed or ambiguous commits retain that same snapshot/token; new arrivals are separate. A failed batch pauses only its guild for that flush; other guilds continue, and retries preserve each guild's order. Receipts prevent retries from double-counting committed batches.

Sessions write at start, on meaningful transition/closure, and at five-minute checkpoints for currently active sessions. A checkpoint splits the uncommitted cursor-to-observation segment into guild-calendar days, updates aggregates and advances the cursor in one transaction. Before the minimum session threshold, a checkpoint only persists observation; once qualified, short later segments remain part of that already-qualified session. Game session count increases once when the session first qualifies and is assigned to its first aggregated day; time on subsequent days still counts. No per-second writes or historical session scans occur.

Session close atomically updates aggregates and deletes the active record. Repeated closes see an absent record and have no effect; an uncertain checkpoint retries from the persisted cursor. Operations are serialized by guild/user. Event snapshots are captured before awaiting database work, so mutable discord.js caches do not collapse queued transitions. Tracker policy changes close old sessions using their original policy and start fresh eligible sessions. Role exclusions use event role data and targeted REST refresh during reconciliation, without enabling GuildMembers.

Discord presentation writes coalesce concurrent events for the same member and refresh at most once per two minutes in the normal cache path. Both the presentation cache and pending presentation writes are capped at 2,000 entries. Profile metadata does not cause one database write per message in a burst.

## Calendar periods and streaks

`today` uses the current guild calendar day. `7d` means today plus six previous dates; `30d` means today plus 29 dates. Real daily aggregates power these windows, while `all` uses all-time records. Day splitting searches actual timezone calendar boundaries, including DST's 23/25-hour days, and preserves fractional seconds to avoid checkpoint rounding drift.

A voice day qualifies at the configured accumulated eligible voice threshold, default 300 seconds. Daily qualification is idempotent. Yesterday increments the streak; a missed day restarts at one. Presentation expires current streaks when the last qualifying date is older than yesterday, without clearing the historical longest value. Changing timezone, streak threshold or streak tracking increments a server-owned revision: old current streaks are hidden immediately and future qualification begins a new series. Historical days and longest streaks are not recalculated.

## Continuous Voice records

Activity → Voice includes **Топ безперервного Voice**, and Ranking includes **Безперервний Voice**. Member profiles show the historical maximum too. `longestVoiceRunSeconds` is a duration in seconds, independent of calendar-day streaks and period selection. Active runs update at the existing five-minute checkpoint and on leave; there is no per-second listener or additional timer. Historical totals cannot reconstruct continuous sessions, so existing members default to zero until a new eligible session is observed.

`voice.returnGraceSeconds` defaults to 60 for both new and legacy settings, accepts 0–86400 seconds, and is editable with `activity.manage`. Zero disables return continuity. Eligible channel moves within the same guild preserve the session. A disconnect closes its measured segment; returning within the grace deadline resumes the run, including exactly at the deadline. Time away is excluded. AFK (when excluded), excluded channels/categories/users/roles, disabled tracking, missed deadlines, reconnects and worker recovery start a fresh run while preserving the historical maximum. Grace changes apply at the next disconnect, and reducing the grace also limits pending returns.

Sessions capture a `voiceRunEpoch` and persisted `voiceRunBaseMilliseconds`. Member aggregates store `voiceRunEpoch`, `voiceRunMilliseconds`, `voiceRunEndedAt`, `voiceRunReturnUntil` and `longestVoiceRunSeconds`. Start transactions carry the prior duration only for the matching guild/user/run and a valid return window; retrying start cannot replace an advanced cursor. The in-memory return map holds only short pending returns and is pruned by the existing checkpoint, eligibility reconciliation and recovery. It never survives a worker/Gateway recovery. Cursor, run maximum, return boundary, counters and session deletion commit atomically.

The record qualifies once the combined eligible segments meet the configured Voice minimum. Short segments can contribute to the continuous record across a valid return; existing all-time/daily totals retain their per-session minimum rule. Milliseconds are carried across returns and rounded only for record presentation. Return gaps never count toward voice totals, calendar-day streaks, screen sharing or the continuous record. Rankings use a single-field descending query limited to 25 (at most 50); no additional compound index or historical scan is required.

## Restart, reconnect and shutdown

Persisted active sessions are reconciled at startup/resume. The old record closes at **last durable observation**, then the currently visible eligible voice/stream/Playing state starts a fresh session at recovery time. Missing states are cleaned up. This deliberately undercounts unproven downtime; even an apparently unchanged game could have stopped and restarted while disconnected. Recovery never fabricates that gap.

Guild availability is independent of the Gateway connection. An unavailable guild is suspended at its last observed session boundary and skipped by periodic checkpoints. When Discord emits `guildAvailable`, both modules recover from the now-visible guild state. Startup initializes guilds independently and does not wait for Temporary Voice recovery before initializing Activity. Profile enrichment and health-publishing failures cannot stop another guild's collection. Settings listeners are installed before session recovery so a failed recovery does not hide later enable/disable changes.

SIGINT/SIGTERM stop accepting new Activity events, stop timers/listeners, drain queued member work, flush all remaining message generations, checkpoint active sessions and mark worker health disconnected. The bootstrap has a 12-second shutdown deadline. An unexpected kill can lose unflushed messages and the latest uncheckpointed session segment. Normal redeploy attempts to persist them; this does not promise zero loss during a Firestore outage or forced termination. The next worker restores from durable state. Use a single Railway worker/replica; no Redis, cron service or second Activity worker is needed.

Health is stale after ten minutes and is shown as unknown/unavailable, never as a fresh green status. Configuration is observed through one Firestore settings listener per guild; leaderboards do not maintain permanent client listeners.

## Query strategy and indexes

All-time message/voice/stream/longest rankings use single-field sorted Firestore queries limited to 25 by default (maximum 50). Member ties use descending user ID, matching Firestore's default document-ID tie order. Game identity ties are also deterministic. Period rankings aggregate a maximum of 20,000 daily rows on the server. Exceeding the cap fails explicitly instead of returning an incomplete ranking. Member directory uses 25-row pagination and bounded prefix search, without loading a guild roster into client JavaScript. Leaderboard presentation profiles are fetched in one `getAll` call. Only a member detail page fetches live Discord identity individually to identify former members.

`firestore.indexes.json` defines compound indexes for the current-streak, per-member daily and game queries. If a compound index is absent, queries fall back to bounded server aggregation over the same date window or the same game/member's all-time documents. This keeps private-server reports correct while indexes are being built. Settings and daily queries are memoized within one request only. Deploy the indexes for efficient filtering at larger scale:

```sh
firebase deploy --only firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

Alternatively, an index-admin credential can run `pnpm --filter @scrt/bot verify:activity --apply-indexes`. That script only creates the declared indexes and never deletes existing indexes. Firestore index creation needs index-management permission, separate from normal document read/write access. [Official index creation API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.indexes/create).

## Verification

### Diagnosing an empty dashboard

Check the bot worker deployment separately from the web deployment. A web rollout does not update the persistent Discord worker. The worker must build the current repository with `pnpm --filter @scrt/bot build` and start `pnpm --filter @scrt/bot start`.

The `bot/ready` log includes `activityInitialized`, `presenceAvailable`, and Railway's commit `revision` when provided. Each guild emits `activity/recovery.complete` with its `enabled` flag and tracker settings; later settings changes emit `activity/config.updated`. If there is no Activity startup entry, verify that the worker runs the version containing Activity. A failed recovery is logged separately. Enable Activity for the intended guild; Presence availability affects games only, while messages, voice and screen sharing continue without it. Send a new eligible message and allow the 60-second flush; voice/stream/game sessions must pass their minimum duration before aggregation.

Structured logs include a readable `message` with module/action, context and failure reason, so hosted log exports retain guild IDs and diagnostics instead of blank informational lines. A stale `activityHealth/worker` means there is no recent worker observation in that Firestore project; check the deployed revision, running worker and its Firebase/Discord application configuration before attributing missing counts to channel permissions.

Voice audit records use `null` for missing optional actor, target, channel and creator identifiers. This handles automatic deletion/recovery events and room controls without passing `undefined` into Firestore. These audit records are separate from Activity counters; an audit failure alone does not establish why analytics are empty.

`pnpm --filter @scrt/bot verify:activity` writes a marked, synthetic guild namespace, verifies batch retries, voice/stream/game totals, session cleanup, streaks, conservative restart recovery and real period leaderboard queries, then recursively deletes only that marked test namespace. It also verifies Gateway authentication with the detected intents. It never enables Activity on a real guild or changes a real member's statistics.

Manual acceptance in a real guild remains:

1. Enable Presence Intent and restart the bot; verify the Games health changes to available.
2. Enable Activity and choose the guild timezone and exclusions.
3. Send original messages; after a flush, verify count increases. Editing/deleting must not change it.
4. Join/leave eligible voice for at least 60 seconds; check totals. Move through AFK/excluded channels.
5. Start/stop screen sharing for at least 60 seconds; check both stream and voice totals.
6. Start/stop Discord-visible Playing games; verify game/player pages, including concurrent games where available.
7. Accumulate five minutes of eligible voice on consecutive guild dates; verify current/longest streaks.
8. Redeploy the actual Railway worker with an active session and buffered messages; verify durable recovery and the stated conservative policy.
9. Check every Activity page using VIEWER/ADMIN/owner access and denied guild identities.

Gateway smoke and isolated Firestore recovery verification do not by themselves prove these human interactions or a Railway redeploy passed.

## Analytics navigation and period state

The stable Activity navigation is Огляд → Рейтинг → Ігри та застосунки → Voice → Повідомлення → Учасники → Налаштування. Overview shows a selected-period summary and three-entry previews, including historical continuous Voice records beside current calendar-day streaks; Ranking is the metric comparison hub. Voice and Messages use only their domain summaries. Member identities on rankings and contribution tables open the profile; game rows have an explicit Гравці action. Detail back links and identity links carry period state. The canonical URL periods are today, 7d, 30d and all; missing, invalid or repeated values default to all. Current/longest streak rankings and continuous Voice records always use all-time semantics and hide the period selector. The Voice threshold comes from guild settings.

Overview active members means a distinct member with messages > 0 OR voiceSeconds > 0 OR streamSeconds > 0 in the selected window. Game-only presence is deliberately excluded because member aggregates currently have no game-time counter; zero-counter records are not active. This definition also appears in the UI. Period summaries reuse the existing bounded daily-member query and request cache. All-time summaries retain the existing 20,000-member cap. Member activity shares use the complete visible per-member aggregates in the chosen period before returning the top 25; these are bounded by the same row cap, without querying individual games.

## Playing activity contributions and exclusions

Discord Playing includes applications such as Visual Studio Code, so the UI calls these **Ігри та застосунки**. Game detail summarizes the selected period and ranks up to 25 contributors. The server computes member seconds / the full game seconds for that same period × 100, safely returning zero for a zero denominator. A truncated contributor list may sum to less than 100%; the denominator is never the displayed top 25. Profiles are hydrated in a batch, with a member-ID fallback for missing presentation records.

Primary game detail reads use existing automatic indexes and never fall back to scanning other games. Period summaries and contributors combine gameKey equality with a date in-query containing exactly 1, 7 or 30 guild-calendar dates. [Firestore index merging](https://firebase.google.com/docs/firestore/query-data/index-overview#use_index_merging) supports these equality filters without deploying a compound index. All-time contributors use a gameKey equality query and rank the matching rows on the server; this reads at most 20,001 rows and fails explicitly above the 20,000-row cap. Numerators and the full-game denominator share the same period. The declared compound indexes remain available for other filtered/sorted queries, but missing index-management permissions no longer block game detail pages. List queries split groups of more than 30 game keys into bounded in-query batches, avoiding Firestore disjunction limits.

Observed activities in Settings are paginated 50 at a time from the guild's activityGames records, including ignored records. Controls use the canonical gameKey without requiring manual entry. activity.manage is required for mutations and activity.view for reads; the transaction verifies the activity exists in the selected guild. games.ignoredGameKeys defaults to an empty array for existing settings, deduplicates keys and is capped at 100 exclusions. Toggling uses an atomic settings read/update with an administrative audit record. Saving the main settings form preserves these independently managed exclusions, including concurrent changes.

Ignoring hides historical entries from game rankings, overview game previews, member game tables, contributor reads and game detail. The bot's existing settings listener reconciles the current presence immediately, closing excluded sessions at reconciliation time and rejecting new desired sessions for those keys. No aggregates are deleted. Unignoring restores historical visibility and starts a fresh session for a currently visible eligible activity. No downtime or excluded interval is reconstructed. The policy does not merge names or implement aliases.

All analytical destinations remain Server Components. Only navigation, existing small settings forms and the retry boundary use client code. The visual test fixture exporter runs only under SCRT_ACTIVITY_PREVIEW_DIR and renders isolated synthetic data; it is not a dashboard route or authorization bypass.

Verification on 2026-10-02: workspace typecheck, lint, test and production build passed. The test suite covers all contribution periods, percentages/limits/ties, authorization, reversible exclusions, active-session closure and query budgets. Real Server Component fixtures were inspected at 1920×1080, 1440×900 and 390×844; nine destinations had no page overflow, with active tabs and game actions visible. Both overview/game/member and ranking/member link journeys preserved period state. These are isolated synthetic renders; authenticated live acceptance and index deployment were not performed.
