# Dashboard UI refinement

## Problems found

The server sidebar exposed an Overview link that only redirected to Voice. Module links did not communicate whether collection was enabled. Disabled Activity could render empty analytics as if collection were running. Settings mixed native selects, oversized switches, checkbox walls, and nested cards. Access mappings exposed identifiers and permanently visible editing controls more prominently than identities and permissions. Analytics and forms shared restrictive width rules, leaving large displays underused.

## Navigation and module states

The server sidebar now contains Voice, Activity, and Access Control, each subject to its existing permission. Voice and Activity retain their own Overview tabs. The server landing route retains its permission-aware redirect.

Voice and Activity links display accessible green enabled or muted disabled dots and remain navigable while disabled. Access Control has no module status dot. Status reads stream inside the existing server shell; the navigation fallback remains usable while they resolve. Settings saves and enable actions invalidate the guild layout so sidebar and page status refresh together.

- Enabled Activity renders the existing analytics and filters.
- Disabled Activity renders an explanation, preserved-history notice, settings link, and enable action only for `activity.manage`. Analytics components are not evaluated in that state.
- Enabled Voice retains creator/room summaries and module navigation.
- Disabled Voice explains the stopped creation behavior and existing-room handling, and keeps room/settings navigation. The enable action requires `voice.manage`.
- The status primitive supports an amber degraded state, covered by tests. Automatic degraded detection was not added to the sidebar; existing tracker health details remain in Activity settings.

## Shared design system

`dashboard-ui.css` and semantic surface, text, border, radius, and spacing tokens establish a common visual grammar while supporting existing feature classes. Controls use restrained borders, visible focus, compact sizing, and consistent pending, disabled, invalid, and destructive states.

Shared primitives: Button (primary, secondary, ghost, danger, icon), Input, Textarea, Checkbox, Switch, searchable Select/combobox, ResourceMultiSelect, DurationInput, DropdownMenu, Dialog, ModuleStatusDot, ModuleStatus, and ModuleDisabledState.

Select menus use styled listboxes, keyboard navigation/typeahead/search, outside dismissal, and portals into the nearest dialog or document body. A visually hidden native select preserves form submission and required validation. Dialogs use the native top layer, one scrollable body, Escape dismissal, focus boundaries, and focus restoration. Destructive actions retain confirmation through ActionForm.

ActionForm tracks named submitted controls and supplies the saved FormData on discard. Duration, select, and user/resource chips synchronize their visible state with that baseline. Search inputs do not mark forms dirty by themselves. No UI component library or package dependency was added.

## Activity and Voice settings

Activity settings use unboxed sections: Main, Tracking, Time and streaks, Exclusions; application tracking, artwork sources, and tracker health follow the main form. Timezone selection is searchable. Durations show seconds/minutes but continue submitting exact integer seconds. Channel/category/role exclusions use searchable chips; users retain the existing debounced guild member search. Removed resources remain identifiable instead of silently disappearing. Read-only users see disabled controls and an explanation.

Voice settings use the same section structure and controls. Creator role selectors use chips; channel/category/region selections and interface/access selectors share Select. Feature behavior, resource validation, defaults, and persistence schemas are retained.

## Access Control

Owner identity is compact. Role/member mappings prioritize display names, avatars/role colors, and permission badges; IDs remain secondary tooltips. Row menus expose edit, member inspection where applicable, and revoke. Editing uses the existing server actions in Dialog; revoke uses the existing confirmation flow. Read-only/protected grants expose no mutation menu. Everyone remains VIEWER-only; owner and SUPER_ADMIN grant restrictions are unchanged.

## Responsive layout and browser evidence

Content stays anchored next to the sidebar. Forms/creator editors and Access Control cap at 1240 px including gutters; normal pages cap at 1440 px. The final polish removed the former 1860 px analytics cap: analytics now uses the main surface between responsive gutters. Numeric table columns stay compact while identities take flexible width. Mobile collapses form columns and wraps module tabs. See [the final polish report](dashboard-ui-polish.md) for the root cause, before/after measurements, and live-browser limitations.

Real page components were server-rendered with synthetic data and production-built CSS in isolated localhost fixtures. Twelve cases (Activity overview, games, settings; Voice overview, settings, creators, rooms, interfaces, permissions; Access Control; disabled Activity and Voice) were captured at each required viewport. All 84 captures had no document horizontal overflow, browser console errors, or visible native select controls. Completed content was awaited before capture. Representative screenshots were visually inspected, including compact desktop, wide analytics, mobile settings/access, disabled states, and a select inside a dialog.

| Viewport | Analytics inner width | Settings inner width | Result |
| --- | ---: | ---: | --- |
| 1366 × 768 | 1006 px | 1006 px | Fits beside compact sidebar; forms remain usable |
| 1440 × 900 | 1077 px | 1077 px | Balanced desktop forms and analytics |
| 1920 × 1080 | 1538 px | 1163 px | Analytics expand; forms retain readable line lengths |
| 2560 × 1440 | 2153 px | 1138 px | Analytics fills the main surface; capped forms |
| 2560 × 1080 | 2153 px | 1138 px | Uses horizontal space without requiring extra height |
| 3440 × 1440 | 3007 px | 1112 px | Left anchored analytics; bounded form width |
| 390 × 844 | 358 px | 358 px | Single-column content; no page overflow |

Eleven browser interaction checks passed against an SSR-hydrated fixture using the real controls: required select validation; search/arrow/Enter; Space on a switch; resource chips and Escape; minutes-to-seconds submission; dirty navigation/discard; access menu/edit; existing permission form submission; unclipped select portal in Dialog; Shift-Tab focus boundary; Escape/focus restoration and revoke cancellation. The interactive fixture had no console or hydration errors and retained the development environment badge.

The in-app signed-in browser runtime could not start because Windows sandbox setup failed. Browser evidence therefore covers isolated real-component fixtures, not a live authenticated Next session or Discord/Firestore writes. Those live integration checks remain unverified. No cookies, existing browser profiles, credentials, or production data were read for fixture QA.

Temporary fixture sources, screenshots, and metrics live under ignored `node_modules/.cache/scrt-ui-qa/`; they are not application routes or shipped authentication bypasses.

## Performance

Server Components remain the default for layouts, page data, authorization, and status. Interactive controls are the new client boundaries. No dependencies were added by this refinement. An isolated minified bundle containing all six new shared control modules measured 14,319 bytes / 4,692 bytes gzip with React external. This is a bounded component estimate, not a measured before/after Next route bundle delta; the repository already contained substantial unrelated local changes.

The sidebar adds at most one cached Voice settings read and one cached Activity settings read for permitted modules. Headers, gates, and settings reuse the request-scoped readers. No health polling or per-row status read was added. Disabled Activity skips downstream analytics queries. Resource pickers reuse existing batched channel/role loading; filtering is local. User exclusion search keeps its existing debounce and guild endpoint. Access member batching is retained. Code and mock tests show no new N+1 read pattern; production Firestore/Discord request totals were not profiled against live credentials.

## Security and boundaries

New enable actions authorize before reading/writing, preserve all existing settings except `enabled`, retain audit behavior, and invalidate the guild layout. Existing save validation still checks guild channel/category/role membership and newly excluded users. Access grant actions and their backend permission checks are unchanged. No OAuth/session/token boundary, permission policy, database schema, bot collection logic, or guild isolation rule was changed by this UI refinement. No new module was started.

## Verification

- `corepack pnpm typecheck`: passed across all nine workspace packages.
- `corepack pnpm lint`: passed across all nine workspace packages.
- `corepack pnpm test`: 498 tests passed, including 274 web tests in 49 files.
- `corepack pnpm build`: production build passed for all workspace packages.
- Browser: 84 responsive fixture captures and 11 interaction checks passed; no fixture console/hydration errors. Live authenticated verification remains limited as described above.
- Diff: reviewed for authorization, guild scoping, duplicate controls, obsolete styling, and whitespace errors.
- Graph: updated with `graphify update .` using AST-only extraction.

## Important files

- `apps/web/src/app/dashboard-ui.css`, `globals.css`, `shell.css`, `activity-games.css`
- `apps/web/src/app/components/{controls,select,resource-multiselect,duration-input,dropdown-menu,dialog,module-status,action-form,dashboard-nav,live-refresh}.tsx`
- `apps/web/src/app/servers/[guildId]/layout.tsx`
- `apps/web/src/app/servers/[guildId]/activity/{layout,module-content}.tsx`, `actions.ts`, and gated analytics pages
- `apps/web/src/app/servers/[guildId]/activity/settings/{page,user-exclusions,artwork-controls}.tsx`
- `apps/web/src/app/servers/[guildId]/voice/{layout,page}.tsx`, `actions.ts`, and settings/creators/interfaces pages
- `apps/web/src/app/servers/[guildId]/settings/access-control/{access-level,access-mapping-actions,access-role-editor,access-role-lists,member-identity,member-search,page}.tsx`
- Navigation, controls, module-state, streaming, access mapping, analytics, and enable-action tests beside their sources

The working tree already contained unfinished Activity/artwork and shell work before this task. This file describes the UI refinement; it does not attribute every modified or untracked repository file to it.
