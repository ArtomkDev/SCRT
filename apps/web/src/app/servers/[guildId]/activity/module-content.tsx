import { Suspense, type ReactNode } from 'react';
import { requireGuildAccess } from '@/lib/guards';
import { activitySettings } from '@/lib/activity-data';
import { ModuleDisabledState, ModuleStatus } from '@/app/components/module-status';
import { ActionForm } from '@/app/components/action-form';
import { Button } from '@/app/components/controls';
import { DataLoading } from '@/app/components/data-loading';
import { InlineAction } from '@/app/components/inline-action';
import { enableActivity } from './actions';

export async function ActivityStatus({ guildId }: { guildId: string }) {
  const settings = await activitySettings(guildId);
  return <ModuleStatus state={settings.enabled ? 'enabled' : 'disabled'} />;
}

async function ActivityState({ guildId, children }: { guildId: string; children: ReactNode }) {
  const settings = await activitySettings(guildId);
  if (settings.enabled) return children;
  const access = await requireGuildAccess(guildId, 'activity.view');
  return <ModuleDisabledState title="Активність вимкнено" description="SCRT не збирає нову статистику повідомлень, Voice, демонстрації екрана, ігор та застосунків. Історичні дані збережено.">
    {access.permissions.has('activity.manage') && <ActionForm action={enableActivity.bind(null, guildId)} trackChanges={false}><Button type="submit">Увімкнути активність</Button></ActionForm>}
    <InlineAction href={`/servers/${guildId}/activity/settings`}>Налаштування активності</InlineAction>
  </ModuleDisabledState>;
}

export function ActivityModuleContent(props: { guildId: string; children: ReactNode }) {
  return <Suspense fallback={<DataLoading label="Перевірка стану активності…" />}><ActivityState {...props} /></Suspense>;
}
