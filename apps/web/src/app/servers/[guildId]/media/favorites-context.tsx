'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { mediaFavoriteSchema, mediaFavoritesPageSchema, mediaFavoritePlaylistSchema, mediaFavoritePlaylistsPageSchema, type MediaFavorite, type MediaFavoritePlaylist } from '@scrt/validation';
import type { MediaPlaylist, MediaTrack } from '@scrt/shared';
import { Button } from '@/app/components/controls';
import { MediaIcon } from './media-icon';
import { useFavoriteCollection } from './favorite-collection';

const identity = (item: MediaTrack | MediaPlaylist) => JSON.stringify([item.provider, item.providerItemId]);
const trackOptions = {
  pageSchema: mediaFavoritesPageSchema, itemSchema: z.object({ item: mediaFavoriteSchema.nullable() }),
  entity: (item: MediaFavorite) => item.track,
  identity, payload: (track: MediaTrack) => ({ provider: track.provider, providerItemId: track.providerItemId }),
};
const playlistOptions = {
  pageSchema: mediaFavoritePlaylistsPageSchema, itemSchema: z.object({ item: mediaFavoritePlaylistSchema.nullable() }),
  entity: (item: MediaFavoritePlaylist) => item.playlist,
  identity, payload: (playlist: MediaPlaylist) => ({ providerItemId: playlist.providerItemId }),
};
type TrackCollection = ReturnType<typeof useFavoriteCollection<MediaFavorite, MediaTrack>>;
type PlaylistCollection = ReturnType<typeof useFavoriteCollection<MediaFavoritePlaylist, MediaPlaylist>>;
type FavoritesContext = TrackCollection & { userId: string; allowYoutube: boolean; playlists: PlaylistCollection; enablePlaylists: () => void };
const Context = createContext<FavoritesContext | null>(null);
export function MediaFavoritesProvider({ guildId, userId, allowYoutube, enabled = true, showErrors = true, children }: { guildId: string; userId: string; allowYoutube: boolean; enabled?: boolean; showErrors?: boolean; children: ReactNode }) {
  const endpoint = `/api/guilds/${guildId}/media/favorites`;
  const tracks = useFavoriteCollection({ ...trackOptions, endpoint, userId, enabled });
  const [playlistsEnabled, setPlaylistsEnabled] = useState(false);
  const enablePlaylists = useCallback(() => setPlaylistsEnabled(true), []);
  const playlists = useFavoriteCollection({ ...playlistOptions, endpoint: `${endpoint}/playlists`, userId, enabled: enabled && playlistsEnabled });
  const items = useMemo(() => tracks.items.filter((item) => allowYoutube || item.track.provider !== 'youtube'), [tracks.items, allowYoutube]);
  const value = useMemo(() => ({ ...tracks, items, userId, allowYoutube, playlists, enablePlaylists }), [tracks, items, userId, allowYoutube, playlists, enablePlaylists]);
  const error = tracks.error || playlists.error;
  return <Context.Provider value={value}>{showErrors && error && <p className="media-feedback is-error" role="alert">{error}</p>}{children}</Context.Provider>;
}
export const useMediaFavorites = () => useContext(Context);
function Heart({ title, favorite, userId, busy, loading, toggle }: {
  title: string; favorite?: MediaFavorite | MediaFavoritePlaylist; userId: string; busy: boolean; loading: boolean; toggle: () => void;
}) {
  const liked = favorite?.likedBy.some((like) => like.userId === userId) ?? false;
  const names = favorite?.likedBy.slice(0, 3).map((like) => like.name).join(', ');
  const others = favorite && favorite.likedBy.length > 3 ? ` та ще ${favorite.likedBy.length - 3}` : '';
  return <Button variant="icon" className={`media-favorite-button${liked ? ' is-liked' : ''}`} aria-pressed={liked} aria-label={`${liked ? 'Зняти сердечко' : 'Вподобати'}: ${title}`} title={favorite ? `Вподобали: ${names}${others}` : 'Додати до улюблених'} disabled={loading || busy} onClick={toggle}><MediaIcon name="heart" />{busy && <span className="sr-only">Збереження…</span>}</Button>;
}
export function FavoriteButton({ track }: { track: MediaTrack }) {
  const favorites = useMediaFavorites();
  if (!favorites || track.provider === 'youtube' && !favorites.allowYoutube) return null;
  return <Heart title={track.title} favorite={favorites.items.find((item) => identity(item.track) === identity(track))} userId={favorites.userId} busy={favorites.pending.has(identity(track))} loading={favorites.loading} toggle={() => void favorites.toggle(track)} />;
}
export function PlaylistFavoriteButton({ playlist }: { playlist: MediaPlaylist }) {
  const favorites = useMediaFavorites();
  const enable = favorites?.enablePlaylists;
  useEffect(() => { enable?.(); }, [enable]);
  if (!favorites) return null;
  return <Heart title={playlist.title} favorite={favorites.playlists.items.find((item) => identity(item.playlist) === identity(playlist))} userId={favorites.userId} busy={favorites.playlists.pending.has(identity(playlist))} loading={favorites.playlists.loading} toggle={() => void favorites.playlists.toggle(playlist)} />;
}
