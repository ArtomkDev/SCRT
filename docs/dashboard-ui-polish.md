# Final dashboard responsive polish

## Verification boundary

Authenticated visual acceptance is **not verified**. The signed-in browser connection failed twice with `trusted Node process exited unexpectedly; kernel reset`. A fresh isolated Chrome could reach the running `http://localhost:3000/servers` development shell (HTTP 200, title `SCRT Control [DEV]`), but did not obtain authenticated guild content. Screenshot capture of that live shell timed out, and its console recorded one resource 404. This is not a clean live-browser result.

No session/profile files, cookies, secrets, or production data were read. No authentication bypass or application test route was added. The measurements and screenshots below are explicitly **fallback component evidence**, not equivalent to live authenticated application QA. Live before/after analytics widths at every requested viewport remain unmeasured.

## Root cause of remaining width issue

The restricting rule was `dashboard-ui.css`: `.content-page.content-wide { max-width: 1860px; }`. ActivityLayout applies those classes to its `<main>`. At 3440px the main surface was 3136px wide, but the main container stopped at 1860px, leaving 1275px of auto margin on the right plus the 64px content gutter. The usable analytics width was therefore only 1732px. At 2560px the same cap left a 446px right gutter.

The source and fallback DOM were traced through `.app-shell` → `.shell-body` → `.shell-content` → `.guild-workspace` → `.guild-content` → `main.content-page.content-wide.activity-content` → page section → metric grids/panels/tables. The shell flex tracks and guild content had no maximum width, fit-content width, or centering rule. The main container had a zero left margin; its maximum width was the limiting wrapper.

The cap is removed for wide analytics. Compact selectors now target direct settings/creator roots; Access Control is explicitly compact. Normal pages retain the existing 1440px cap. Analytics intentionally fills the available surface rather than enforcing a fixed 1500–1800px cap, which would preserve the half-empty appearance at 3440px. Text descriptions retain their readable line-length limit.

## Before / After — fallback rendered DOM only

Widths exclude content padding; gutters are measured from the guild main surface to the analytics content edges. The one-pixel difference between left and right gutters is the surface border. These are not live authenticated measurements.

| Viewport | Main surface | Before analytics | After analytics | Left gutter after | Right gutter before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1366 × 768 | 1062px | 1006px | 1006px | 28px | 27px → 27px |
| 1440 × 900 | 1136px | 1077px | 1077px | 30px | 29px → 29px |
| 1920 × 1080 | 1616px | 1538px | 1538px | 39px | 38px → 38px |
| 2560 × 1080 | 2256px | 1758px | 2153px | 52px | 446px → 51px |
| 2560 × 1440 | 2256px | 1758px | 2153px | 52px | 446px → 51px |
| 3440 × 1440 | 3136px | 1732px | 3007px | 65px | 1339px → 64px |
| 390 × 844 | 390px | 358px | 358px | 16px | 16px → 16px |

At large viewports, Settings and Access Control containers remain 1240px including gutters (1163px inner width at 1920, 1138px at 2560, 1112px at 3440). Normal Voice pages remain capped at 1440px. Analytics does not grow further at 1920 because it already filled the available workspace.

## Pixel polish

- Overview explicitly keeps four summary metrics across desktop width; three-metric pages retain three columns. Summary grids use two columns below 1280px. Leaderboard panels remain balanced in two columns and stack below 1280px. The required 1366/1440 laptop layouts fit without forcing a collapse.
- Metric cards and leaderboard panels share semantic background, border, radius, and padding tokens. Panel headings use one 17px hierarchy; section headings use 22px, descriptions 14px, table headings 12px. Font family is unchanged.
- Page-heading spacing is shared across modules. Leaderboard/panel spacing uses 20/24px steps; the streak note has a 16px separation from the previous panel.
- Games and contributor identities use the flexible column. Time, counts, percentages, and last-activity columns have compact pixel widths; the games action column is 48px. At 3440px, numeric columns remain 150/140/90/170px instead of stretching with the table. Mobile row layouts remain intact.
- Enabled/disabled sidebar dots retained green/muted colors and measured zero vertical offset from their row centers in all fallback captures. The existing degraded primitive retains amber; no automatic degraded state was introduced.
- Settings selectors and form controls were retained. Access Control stays narrower than analytics.

## Pages checked in fallback rendering

Both before and after runs captured 12 cases at all seven viewports (84 captures per run): Activity Overview, Ranking, Games, Activity Voice, Messages, game contributors, Activity Settings, Access Control, Voice Overview, Voice Settings, disabled Activity, and disabled Voice. Completed content was awaited. Representative desktop, laptop, ultrawide, and mobile screenshots were visually inspected across the requested pages.

The final after run recorded no horizontal document overflow or component-fixture console errors. One 3440px Overview capture recorded CLS 0.0126; the other 83 captures recorded zero. Five subsequent diagnostic reloads of that Overview retained the 3007px content width and recorded zero shifts, so the isolated shift was not reproduced; the original observation is retained. These values describe fixture rendering only; they do not establish live streamed-route or authenticated navigation behavior.

The existing shared-control SSR/hydration interaction fixture was also checked for required select validation, keyboard/search, switches, resource chips, minute serialization, unsaved navigation/discard, Access edit actions, dialog portal/focus/Escape, and revoke cancellation. It is separate from live application QA.

Temporary evidence is under ignored `node_modules/.cache/scrt-ui-qa/polish/{before,after}/`, including screenshots and `results.json` with ancestor styles, table widths, dots, overflow, and layout-shift measurements. `polish/live.json` contains the bounded running-app attempt. These files are local QA artifacts, not application content.

## Regression status

This pass changes only `apps/web/src/app/dashboard-ui.css`, `apps/web/src/app/activity-games.css`, and verification documentation. No business logic, Firestore, permissions, OAuth, Activity tracking, TempVoice runtime, data model, data-loading code, or client JavaScript was changed. There are no new requests or dependencies. Existing sidebar/module states, disabled gates, control system, Access Control interactions, and development branding remain in place.

- `corepack pnpm typecheck`: passed for all nine workspace projects.
- `corepack pnpm lint`: passed for all nine workspace projects.
- `corepack pnpm test`: 498 tests passed, including 274 web tests.
- `corepack pnpm build`: passed across the workspace; the web production build was repeated after final spacing edits.
- `git diff --check`: passed.
- `graphify update .`: AST-only update completed.

The CSS fix and fallback polish are implemented. Final live authenticated screenshot acceptance remains outstanding because the available signed-in browser connection could not start.
