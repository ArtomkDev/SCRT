# Dashboard screen components

Protected dashboard routes use the same layered layout, including Media, Activity,
Voice, server selection, access control, loading states, and error screens.
Authorization and data reads remain in their existing server layouts and pages.

- `DashboardScreen` owns the full-width back sheet and the rounded content sheet.
  Its `standard`, `wide`, and `compact` widths constrain content, never the header.
- `ScreenHeader` places the title, description, live status, navigation, and actions.
  Its status row reserves 20px even before asynchronous reads complete.
- `ScreenTabs` renders route links, selects the most specific matching route, and
  reveals the active link within its own horizontal scroller on narrow screens.
  One persistent selection plate animates its position and size between links.
  It is measured on route and size changes; reduced motion disables its tween.
- `FilterLinks` renders query-based filters with the selection supplied by the
  server. Loading entries have no link until the target is known.
- `Panel` owns card background, border, corner radius, and padding. Its `as` prop
  preserves fieldset/legend, details/summary, list, and article semantics.
- `PanelHeader` and `MetricCard` provide consistent block headings and statistics.

Screen and card styles are defined in `components/dashboard-screen.css`.
Use `--radius-sheet` for both top corners of the content sheet and shared panels.
Feature CSS owns grids, rows, spacing between blocks, and responsive behavior.
Only override `--panel-space` when a dense list needs different internal padding;
do not reintroduce feature-specific card backgrounds or borders.

```tsx
<DashboardScreen
  width="wide"
  header={<ScreenHeader title="Module" navigation={<ModuleTabs guildId={guildId} />} />}
>
  <Panel aria-label="Module status">
    <PanelHeader title="Status" description="Current state of the module" />
    {children}
  </Panel>
</DashboardScreen>
```

Keep headers and content in normal layout flow. Player and log docks belong to the
workspace shell, so their open/close transitions resize every module consistently.

Media module status belongs to `ScreenHeader.status`, under the title. Connection
status belongs to the persistent player and its topbar toggle, rather than the
search or queue. The provider badge links to the current track's external URL.
Previous playback uses the existing authorized `PLAY_TRACK` command with the last
playable track in the played list; an empty list uses `SEEK` to return to zero.

`GuildModuleStatusProvider` shares the already authorized sidebar and module
statuses within one server layout. Header loading states consume that cache;
an unknown status uses a static grey dot until a server read supplies its value.
Changing guilds resets the cache, and no additional request is made by the client.

Player ambience is keyed by guild, user, provider, and provider item identity.
Decoder queue IDs can change on seeking and must not select another composition.
The header, corner, and dock background share the same viewport-aligned mesh.
They sample it with local background positions anchored to the player's right
edge and topbar height. Do not use `background-attachment: fixed` in the contained
dock: collapsing and fading that surface can leave a stale background paint.
Animate its registered properties on those leaf layers; keep them off the module
workspace so each animation frame does not invalidate the entire content tree.
Open/close fades use opacity, while the fixed-width dock content stays mounted.
Controller and favorites contexts retain their identities through these toggles;
the artwork component is memoized to avoid repainting on progress updates.
