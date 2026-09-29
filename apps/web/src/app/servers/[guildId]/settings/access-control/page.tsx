import { requireGuildAccess } from '@/lib/guards';
import { botGuild } from '@scrt/discord';
import { env, guilds } from '@/lib/server';
import { permissionsForRole, type AppPermission, type AppRole } from '@scrt/permissions';

const permissionLabels: Record<AppPermission, string> = {
  'dashboard.access': 'Доступ до огляду', 'members.view': 'Перегляд учасників', 'members.manage': 'Керування учасниками',
  'activity.view': 'Перегляд активності', 'voice.view': 'Перегляд голосових каналів', 'voice.manage': 'Керування голосовими каналами',
  'moderation.view': 'Перегляд модерації', 'moderation.manage': 'Керування модерацією', 'automation.view': 'Перегляд автоматизації',
  'automation.manage': 'Керування автоматизацією', 'logs.view': 'Перегляд журналу', 'settings.view': 'Перегляд налаштувань',
  'settings.manage': 'Керування налаштуваннями',
};
const roleLabels: Record<AppRole, string> = { SUPER_ADMIN: 'Суперадміністратор', ADMIN: 'Адміністратор', VIEWER: 'Спостерігач' };
const describePermissions = (role: AppRole) => permissionsForRole(role).map((permission) => permissionLabels[permission]).join(' · ');

export default async function AccessControl({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  await requireGuildAccess(guildId, 'settings.view');
  const [liveGuild, mappings] = await Promise.all([botGuild(env().DISCORD_BOT_TOKEN, guildId), guilds().roleMappings(guildId)]);
  const ownerId = liveGuild.owner_id;
  return <main className="content-page">
    <div className="page-heading"><h1>Керування доступом</h1><p>Власник Discord-сервера завжди має повний доступ. Налаштування ролей з’явиться пізніше.</p></div>
    <div className="detail-panel">
      <div className="muted">Власник сервера · Суперадміністратор</div>
      <div className="mono-line">{ownerId}</div>
      <p className="muted">{describePermissions('SUPER_ADMIN')}</p>
    </div>
    <h2 className="subheading">Відповідність ролей Discord</h2>
    {mappings.length ? <ul className="mapping-list">{mappings.map((mapping) => <li key={mapping.discordRoleId} className="detail-panel"><span className="mono-line">{mapping.discordRoleId}</span><span className="role-label">{roleLabels[mapping.appRole]}</span><p className="muted">{describePermissions(mapping.appRole)}</p></li>)}</ul> : <p className="muted">Відповідність ролей ще не налаштована.</p>}
  </main>;
}
