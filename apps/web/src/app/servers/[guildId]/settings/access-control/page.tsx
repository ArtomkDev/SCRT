import { Suspense } from 'react';
import AccessLoading from './loading';
import { requireGuildAccess } from '@/lib/guards';
import { ActionForm } from '@/app/components/action-form';
import { canEditAccessGrant, type MemberMapping } from '@scrt/permissions';
import { guilds } from '@/lib/server';
import { voiceRoles } from '@/lib/voice-data';
import { accessMemberProfile } from '@/lib/access-control-data';
import { removeAccessMember, removeAccessRole, saveAccessMember, saveAccessRole } from './actions';
import { MemberIdentity } from './member-identity';
import { MemberSearch } from './member-search';
import { MemberDirectoryProvider } from './member-directory';
import { AccessRoleLists } from './access-role-lists';
import { AccessRoleEditor } from './access-role-editor';
import { AccessMappingActions } from './access-mapping-actions';
import { AccessLevelSelect, PermissionBadge } from './access-level';
import { Button } from '@/app/components/controls';

async function Profile({ guildId, userId, revision, owner = false }: { guildId: string; userId: string; revision: number; owner?: boolean }) {
  try {
    const member = await accessMemberProfile(guildId, userId, revision);
    return <MemberIdentity guildId={guildId} member={member} userId={userId} fallbackName={owner ? 'Власник сервера' : undefined} />;
  } catch (error) {
    console.error('Could not load access member profile', { guildId, userId, error });
    return <MemberIdentity guildId={guildId} member={null} userId={userId} fallbackName="Не вдалося завантажити профіль" />;
  }
}

async function MemberAccessEditor({ guildId, mapping, revision }: { guildId: string; mapping: MemberMapping; revision: number }) {
  let member;
  try { member = await accessMemberProfile(guildId, mapping.discordUserId, revision); }
  catch { return null; }
  if (!member) return null;
  return <ActionForm trackChanges={false} action={saveAccessMember.bind(null, guildId)} className="access-role-update" successMessage="Рівень доступу змінено." feedbackPlacement="toast"><input type="hidden" name="userId" value={mapping.discordUserId} /><label>Рівень доступу<AccessLevelSelect defaultValue={mapping.appRole} /></label><Button type="submit">Зберегти</Button></ActionForm>;
}

function MemberAccessRow({ guildId, mapping, revision, editable }: { guildId: string; mapping: MemberMapping; revision: number; editable: boolean }) {
  const userId = mapping.discordUserId;
  return <li className="detail-panel access-role-row">
    <div><Suspense fallback={<MemberIdentity guildId={guildId} member={null} userId={userId} fallbackName="Завантаження профілю…" />}><Profile guildId={guildId} userId={userId} revision={revision} /></Suspense><PermissionBadge role={mapping.appRole} /></div>
    {editable && <AccessMappingActions label="Персональний доступ" edit={<Suspense fallback={null}><MemberAccessEditor guildId={guildId} mapping={mapping} revision={revision} /></Suspense>} remove={<ActionForm trackChanges={false} action={removeAccessMember.bind(null, guildId)} feedbackPlacement="toast" confirmation={{ title: 'Скасувати доступ?', description: 'Персональний доступ учасника буде скасовано. Доступ за ролями залишиться чинним.', actionLabel: 'Скасувати доступ' }}><input type="hidden" name="userId" value={userId} /><Button type="submit" variant="danger" tabIndex={-1}>Скасувати доступ</Button></ActionForm>} />}
    {!editable && mapping.appRole === 'SUPER_ADMIN' && <p className="muted">Змінювати цей доступ може лише власник сервера або адміністратор, який його надав.</p>}
  </li>;
}

async function AccessControlContent({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const access = await requireGuildAccess(guildId, 'settings.view');
  const { liveGuild, accessMappings } = access;
  const [roles, revision] = await Promise.all([
    voiceRoles(guildId, access.guild.resourceRevision), guilds().memberDirectoryRevision(guildId),
  ]);
  const mappings = accessMappings.roles;
  const memberMappings = accessMappings.members.filter((mapping) => mapping.discordUserId !== liveGuild.owner_id);
  const availableRoles = roles.filter((role) => !mappings.some((mapping) => mapping.discordRoleId === role.id));
  const editable = access.permissions.has('settings.manage');
  const directoryScope = access.permissions.has('settings.manage') ? 'full' : 'access-roles';
  return <main className="content-page access-control-page">
    <div className="page-heading"><h1>Керування доступом</h1><p>Доступ до панелі SCRT за ролями Discord та для окремих учасників.</p></div>
    <p className="muted">Власник сервера має всі права. Повний доступ інших адміністраторів може змінити власник або адміністратор, який його надав.</p>
    {!editable && <p className="form-feedback" role="status">Ви можете переглядати доступ. Для змін потрібен рівень «Повний доступ».</p>}
    <section className="detail-panel"><div className="member-access-head"><span className="role-label">Власник сервера</span><Suspense fallback={<MemberIdentity guildId={guildId} member={null} userId={liveGuild.owner_id} fallbackName="Власник сервера" />}><Profile guildId={guildId} userId={liveGuild.owner_id} revision={revision} owner /></Suspense></div><p className="access-owner-note">Власник завжди має повний доступ.</p></section>
    <MemberDirectoryProvider key={`${guildId}:${directoryScope}:${mappings.map((mapping) => `${mapping.discordRoleId}:${mapping.appRole}`).join('|')}`} guildId={guildId} scope={directoryScope}>
    <AccessRoleLists guildId={guildId} ownerId={liveGuild.owner_id} mappings={mappings} roles={roles} editable={editable} actor={access.accessActor} saveAction={saveAccessRole.bind(null, guildId)} removeAction={removeAccessRole.bind(null, guildId)} />
    {editable && <section className="detail-panel access-role-editor"><h2>Надати доступ ролі</h2><p className="muted">Виберіть роль Discord і рівень доступу до панелі.</p>
      <AccessRoleEditor guildId={guildId} roles={availableRoles} action={saveAccessRole.bind(null, guildId)} />
      {availableRoles.length === 0 && <p className="muted">Усі ролі вже додано.</p>}
    </section>}
    <h2 className="subheading">Учасники з персональним доступом</h2>
    {memberMappings.length ? <ul className="mapping-list">{memberMappings.map((mapping) => <MemberAccessRow key={mapping.discordUserId} guildId={guildId} mapping={mapping} revision={revision} editable={editable && canEditAccessGrant(access.accessActor, mapping)} />)}</ul> : <p className="empty-state">Немає персональних призначень.</p>}
    {editable && <MemberSearch guildId={guildId} ownerId={liveGuild.owner_id} mappings={accessMappings} action={saveAccessMember.bind(null, guildId)} />}
    </MemberDirectoryProvider>
  </main>;
}

export default function AccessControl(props: Parameters<typeof AccessControlContent>[0]) {
  return <Suspense fallback={<AccessLoading />}><AccessControlContent {...props} /></Suspense>;
}
