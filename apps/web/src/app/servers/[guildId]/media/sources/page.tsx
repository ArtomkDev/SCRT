import { requireGuildAccess } from '@/lib/guards';
import { initialMediaSnapshot } from '@/lib/media-data';
import { Panel, PanelHeader } from '@/app/components/dashboard-screen';
const labels = { available: 'Доступно', degraded: 'Тимчасово недоступне', unconfigured: 'Не налаштовано', error: 'Помилка конфігурації' };
export default async function MediaSourcesPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params; const { user } = await requireGuildAccess(guildId, 'media.view'); const { snapshot, unavailable } = await initialMediaSnapshot(guildId, user.id);
  return <section><h2 className="subheading">Джерела</h2>{unavailable && <p className="form-feedback">{unavailable}</p>}
    <div className="media-health-grid">{snapshot.providers.map((provider) => <Panel key={provider.id}>
      <PanelHeader level={3} title={provider.name} description={labels[provider.state]} />
      <dl><dt>Пошук</dt><dd>{provider.capabilities.search ? 'Так' : 'Ні'}</dd>
        <dt>Інформація</dt><dd>{provider.capabilities.metadata ? 'Так' : 'Ні'}</dd>
        <dt>Відтворення</dt><dd>{provider.capabilities.playback ? 'Так' : 'Лише інформація'}</dd>
        <dt>Прямі трансляції</dt><dd>{provider.capabilities.live ? 'Так' : 'Ні'}</dd>
        <dt>Перемотування</dt><dd>{provider.capabilities.seek ? 'Так' : 'Ні'}</dd></dl>
    </Panel>)}</div>
    <p className="field-help">YouTube, YouTube Music і SoundCloud підтримують відтворення доступних публічних треків. Також доступні прямі посилання на HTTP аудіофайли. Приватні треки й обмеження доступу джерел не обходяться.</p>
  </section>;
}
