import type { ActivityArtwork, ArtworkIdentity } from '@scrt/shared';
import { effectiveArtwork } from '@scrt/shared';
import { ActionForm } from '@/app/components/action-form';
import { editActivityArtwork, refreshActivityArtwork, resetActivityArtwork } from '../artwork-actions';
import { ArtworkPicker } from '../artwork-picker';
import { Select } from '@/app/components/select';

const sources: Record<string, string> = { discord: 'Discord', steamgriddb: 'SteamGridDB', igdb: 'IGDB', 'simple-icons': 'Simple Icons', brand: 'Іконка видавця', manual: 'Ручний вибір' };
export function ArtworkControls({ guildId, identity, artwork }: { guildId: string; identity: ArtworkIdentity; artwork?: ActivityArtwork }) {
  const icon = effectiveArtwork(artwork, 'icon'); const hero = effectiveArtwork(artwork, 'hero');
  const key = <input type="hidden" name="gameKey" value={identity.gameKey} />;
  return <div className="activity-artwork-controls"><small>Іконка: {sources[icon?.source ?? ''] ?? 'Резервна'} · Банер: {sources[hero?.source ?? ''] ?? 'Резервний'}{artwork?.status === 'error' ? ' · Тимчасова помилка джерела' : artwork?.status === 'not_found' ? ' · Надійного збігу немає' : !artwork ? ' · Очікує пошуку' : ''}</small>
    <ArtworkPicker guildId={guildId} identity={identity} artwork={artwork} />
    <ActionForm action={refreshActivityArtwork.bind(null, guildId)} trackChanges={false} successMessage="Оновлення завершено. Стан і джерела показано вище.">{key}<button type="submit" className="secondary-button">Оновити оформлення</button></ActionForm>
    <details><summary>Підтверджений ID гри</summary><ActionForm key={JSON.stringify(artwork?.mapping)} action={editActivityArtwork.bind(null, guildId)} className="voice-form">{key}<input type="hidden" name="mode" value="mapping" /><label>Підтверджене джерело<Select name="provider" aria-label="Підтверджене джерело" defaultValue={artwork?.mapping?.provider ?? 'steamgriddb'}><option value="steamgriddb">SteamGridDB</option><option value="igdb">IGDB</option></Select></label><label>ID гри у джерелі<input name="entityId" inputMode="numeric" pattern="[1-9][0-9]{0,11}" maxLength={12} defaultValue={artwork?.mapping?.entityId ?? ''} /></label><p className="field-help">Необов’язково: наступний автоматичний пошук використовуватиме цей ID. Власні зображення зберігаються.</p><button type="submit" className="action-link">Зберегти ID</button></ActionForm><ActionForm action={resetActivityArtwork.bind(null, guildId)} trackChanges={false}>{key}<button type="submit" className="secondary-button">Повернути автоматичний пошук</button></ActionForm></details>
  </div>;
}
