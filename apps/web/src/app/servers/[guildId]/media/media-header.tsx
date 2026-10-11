'use client';
import { Button } from '@/app/components/controls';
import { ScreenHeader } from '@/app/components/dashboard-screen';
import { ScreenTabs } from '@/app/components/screen-tabs';
import { GuildModuleStatus } from '@/app/components/guild-module-status';
import { useMediaPlayerWorkspace } from '@/app/components/media-player/media-player-context';
import { MediaIcon } from './media-icon';
import './media-header.css';

const screens = [
  ['', 'Пошук і черга'], ['/favorites', 'Улюблені'], ['/history', 'Історія'],
  ['/settings', 'Налаштування'], ['/sources', 'Джерела'], ['/diagnostics', 'Діагностика'],
] as const;

export function MediaHeader({ guildId }: { guildId: string }) {
  const root = `/servers/${guildId}/media`;
  const workspace = useMediaPlayerWorkspace();
  const player = workspace?.scope?.guildId === guildId ? workspace : null;
  const snapshot = player?.binding?.controller.snapshot ?? player?.scope?.initial;
  const unavailable = player?.binding?.controller.unavailable ?? player?.scope?.initialError;
  return <ScreenHeader title="Медіа" description="Спільне відтворення у голосовому каналі."
    status={<GuildModuleStatus guildId={guildId} module="media" state={snapshot ? !snapshot.settings.enabled ? 'disabled' : unavailable || !snapshot.engine.available || snapshot.session?.lastError ? 'degraded' : 'enabled' : undefined} />}
    navigation={<ScreenTabs label="Розділи Медіа" entries={screens.map(([suffix, label]) => ({ href: `${root}${suffix}`, label, nested: Boolean(suffix) }))} />}
    actions={player && <Button className="media-module-player-toggle" variant="secondary" aria-label={player.open ? 'Приховати панель плеєра' : 'Відкрити плеєр'} aria-expanded={player.open} aria-controls={player.id} onClick={player.toggle}><MediaIcon name="music" width="15" height="15" /><span>{player.open ? 'Плеєр відкрито' : 'Відкрити плеєр'}</span></Button>}
  />;
}
