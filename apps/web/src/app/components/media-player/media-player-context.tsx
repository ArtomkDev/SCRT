'use client';
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { MediaSnapshot } from '@scrt/validation';
import { useMediaController } from '@/app/servers/[guildId]/media/player-controller';
import { MediaFavoritesProvider, useMediaFavorites } from '@/app/servers/[guildId]/media/favorites-context';
import { neutralPalette, type ArtworkPalette } from '@/app/servers/[guildId]/media/player-artwork';
import { useMediaAmbience } from './media-player-ambience';

export type MediaPlayerScope = { guildId: string; userId: string; guildName: string; initial: MediaSnapshot; initialError: string | null; allowYoutube: boolean };
type Controller = ReturnType<typeof useMediaController>;
type Binding = { key: string; controller: Controller };
const identity = (scope: Pick<MediaPlayerScope, 'guildId' | 'userId'>) => `${scope.guildId}:${scope.userId}`;
type Workspace = {
  scope: MediaPlayerScope | null; binding: Binding | null; open: boolean; id: string;
  trigger: RefObject<HTMLButtonElement | null>; toggle: () => void; show: () => void; close: () => void;
  register: (scope: MediaPlayerScope | null) => void;
  ambienceStyle: CSSProperties; setPalette: (palette: ArtworkPalette) => void;
};
const Context = createContext<Workspace | null>(null);
const ControllerContext = createContext<{ guildId: string | null; controller: Controller | null } | null>(null);
const Standalone = createContext<Controller | null>(null);
export const useMediaPlayerWorkspace = () => useContext(Context);
export const useHasWorkspaceMediaController = () => Boolean(useContext(ControllerContext));

const ControllerBridge = memo(function ControllerBridge({ scope, onChange }: { scope: MediaPlayerScope; onChange: (value: Binding) => void }) {
  const controller = useMediaController(scope.guildId, scope.initial, scope.initialError);
  useEffect(() => { onChange({ key: identity(scope), controller }); }, [controller, scope, onChange]);
  return null;
});
export function DashboardMediaProvider({ children, initialScope = null }: { children: ReactNode; initialScope?: MediaPlayerScope | null }) {
  const [scope, setScope] = useState(initialScope);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [open, setOpen] = useState(true);
  const [palette, setPalette] = useState(neutralPalette);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const register = useCallback((next: MediaPlayerScope | null) => {
    setScope((previous) => previous && next && identity(previous) === identity(next) ? previous : next);
  }, []);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  const toggle = useCallback(() => setOpen((previous) => !previous), []);
  const current = scope && binding?.key === identity(scope) ? binding : null;
  const track = (current ? current.controller.snapshot : scope?.initial)?.session?.currentTrack;
  // Decoder IDs change after seeking; only the source identity is a new song.
  const trackKey = scope && track ? `${identity(scope)}:${track.provider}:${track.providerItemId}` : null;
  const ambienceStyle = useMediaAmbience(trackKey, palette);
  // Opening the dock or decoding artwork must not rerender the search results.
  const controllerValue = useMemo(() => ({ guildId: scope?.guildId ?? null, controller: current?.controller ?? null }), [scope?.guildId, current]);
  return <Context.Provider value={{ scope, binding: current, open: Boolean(scope && open), id, trigger, show, close, toggle, register, ambienceStyle, setPalette }}>
    <ControllerContext.Provider value={controllerValue}>
    <MediaFavoritesProvider guildId={scope?.guildId ?? ''} userId={scope?.userId ?? ''} allowYoutube={scope?.allowYoutube ?? false} enabled={Boolean(scope)} showErrors={false}>{children}<WorkspaceFeedback controller={current?.controller ?? null} open={Boolean(scope && open)} /></MediaFavoritesProvider>
    {scope && <ControllerBridge key={identity(scope)} scope={scope} onChange={setBinding} />}
    </ControllerContext.Provider>
  </Context.Provider>;
}

function WorkspaceFeedback({ controller, open }: { controller: Controller | null; open: boolean }) {
  const favorites = useMediaFavorites();
  const error = favorites?.error || favorites?.playlists.error;
  if (error) return <p className="media-feedback is-error media-toast" role="alert">{error}<button type="button" onClick={() => { void favorites?.refresh(); void favorites?.playlists.refresh(); }}>Повторити</button></p>;
  if (!open && controller?.message) return <p className="media-feedback media-toast" role="status">{controller.message}<button type="button" aria-label="Закрити повідомлення плеєра" onClick={() => controller.setMessage('')}>×</button></p>;
  return null;
}
// Rendered only by the authorized server layout. The selected server remains
// available on the server list; a new guild replaces the entire command stream.
export function MediaGuildRegistration({ scope }: { scope: MediaPlayerScope | null }) {
  const register = useMediaPlayerWorkspace()?.register;
  useEffect(() => { register?.(scope); }, [register, scope]);
  return null;
}
function StandaloneController({ guildId, initial, initialError, children }: { guildId: string; initial: MediaSnapshot; initialError: string | null; children: ReactNode }) {
  const controller = useMediaController(guildId, initial, initialError);
  return <Standalone.Provider value={controller}>{children}</Standalone.Provider>;
}
// Isolated views and tests can own a controller; dashboard views always consume
// the persistent controller, including while its first state is loading.
export function MediaControllerBoundary(props: { guildId: string; initial: MediaSnapshot; initialError: string | null; children: ReactNode }) {
  const workspace = useContext(ControllerContext);
  return workspace ? props.children : <StandaloneController {...props} />;
}
export function useWorkspaceMediaController(guildId: string, initial: MediaSnapshot, initialError: string | null): Controller {
  const workspace = useContext(ControllerContext);
  const standalone = useContext(Standalone);
  if (!workspace && standalone) return standalone;
  if (!workspace) throw new Error('Media views require a controller boundary');
  if (workspace.guildId === guildId && workspace.controller) return workspace.controller;
  return { snapshot: { ...initial, controls: {}, queueControls: {} }, pending: [], unavailable: initialError ?? 'Підключення плеєра…', message: '', transient: false, setMessage: () => {}, send: () => {} };
}
