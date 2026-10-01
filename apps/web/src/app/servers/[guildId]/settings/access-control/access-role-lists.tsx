'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import type { BotGuildRole } from '@scrt/discord';
import { canEditAccessGrant, type AccessActor, type RoleMapping } from '@scrt/permissions';
import type { DirectoryMember } from '@scrt/validation';
import { ActionForm } from '@/app/components/action-form';
import { useMemberDirectory } from './member-directory';
import { membersByHighestAccessRole } from './role-members';

const hex = (value: number) => `#${Math.max(0, Math.min(value, 0xffffff)).toString(16).padStart(6, '0')}`;
function roleBadgeStyle(role: BotGuildRole | undefined): CSSProperties {
  const primary = role?.colors?.primary_color ?? role?.color ?? 0;
  const secondary = role?.colors?.secondary_color;
  const tertiary = role?.colors?.tertiary_color;
  if (!primary) return {};
  return {
    backgroundColor: hex(primary),
    backgroundImage: tertiary !== null && tertiary !== undefined && secondary !== null && secondary !== undefined
      ? `linear-gradient(110deg, ${hex(primary)}, ${hex(secondary)}, ${hex(tertiary)}, ${hex(primary)})`
      : secondary !== null && secondary !== undefined ? `linear-gradient(110deg, ${hex(primary)}, ${hex(secondary)})` : undefined,
  };
}

function RoleBadge({ role }: { role: BotGuildRole | undefined }) {
  const animated = role?.colors?.secondary_color !== null && role?.colors?.secondary_color !== undefined;
  return <span className={animated ? 'access-role-badge access-role-badge-animated' : 'access-role-badge'} style={roleBadgeStyle(role)}>
    {role?.icon ? <Image src={`https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.webp?size=64`} alt="" width={18} height={18} unoptimized /> : role?.unicode_emoji ? <span aria-hidden="true">{role.unicode_emoji}</span> : null}
    {role?.name ?? 'Роль видалено'}
  </span>;
}

function RoleMembers({ members, mode }: { members: DirectoryMember[]; mode: string }) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(40);
  const note = mode === 'loading' && !members.length ? 'Завантаження учасників…'
    : mode === 'fallback' ? 'Список учасників недоступний. У налаштуваннях бота в Discord увімкніть Server Members Intent.'
      : mode === 'error' ? 'Не вдалося завантажити учасників ролі.'
        : !members.length ? 'Немає учасників для показу. Учасники з вищою роллю відображаються в її списку.' : null;
  return <div className="access-role-members">
    {note ? <p className="muted access-role-members-note" role={mode === 'loading' ? 'status' : undefined}>{note}</p> : <>
              <button type="button" className="access-role-members-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                <span className="access-role-avatar-stack" aria-hidden="true">{members.slice(0, 3).map((member) => <Image key={member.id} src={member.avatarUrl} alt="" width={30} height={30} unoptimized />)}</span>
                <span>Учасників: {members.length.toLocaleString('uk-UA')}{mode === 'loading' ? '+' : ''} · {expanded ? 'Згорнути' : 'Переглянути'}</span><span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
              </button>
              {mode === 'loading' && <span className="muted access-role-members-note" role="status">Завантаження решти учасників…</span>}
              {expanded && <div className="access-role-members-expanded"><ul className="access-role-member-list">{members.slice(0, visible).map((member) => <li key={member.id}>
      <Image src={member.avatarUrl} alt="" width={32} height={32} unoptimized /><span><strong>{member.nick ?? member.globalName ?? member.username}</strong><small>@{member.username} · {member.id}</small></span>
              </li>)}</ul>{visible < members.length && <button type="button" className="secondary-button" onClick={() => setVisible((value) => value + 40)}>Показати ще</button>}</div>}
            </>}
  </div>;
}

function AccessRoleCard({ guildId, mapping, role, members, mode, editable, saveAction, removeAction }: {
  guildId: string; mapping: RoleMapping; role: BotGuildRole | undefined; members: DirectoryMember[]; mode: string; editable: boolean;
  saveAction: (form: FormData) => Promise<void>; removeAction: (form: FormData) => Promise<void>;
}) {
  return <li className="detail-panel access-role-card">
    <div className="access-role-card-head"><div className="access-role-card-identity"><RoleBadge role={role} /><span className="mono-line">{mapping.discordRoleId}</span></div>
      {editable && <div className="access-role-actions">
        {mapping.discordRoleId === guildId ? <span className="muted">Перегляд для всіх</span> : role && <ActionForm trackChanges={false} action={saveAction} className="access-role-update" successMessage="Рівень доступу змінено." feedbackPlacement="toast"><input type="hidden" name="roleId" value={mapping.discordRoleId} /><label>Рівень доступу<select name="appRole" defaultValue={mapping.appRole}><option value="SUPER_ADMIN">Повний доступ</option><option value="ADMIN">Налаштування бота</option><option value="VIEWER">Лише перегляд</option></select></label><button type="submit" className="action-link">Змінити</button></ActionForm>}
        <ActionForm trackChanges={false} action={removeAction} feedbackPlacement="toast" confirmation={{ title: 'Скасувати доступ?', description: 'Доступ за цією роллю буде скасовано. Інші призначення залишаться чинними.', actionLabel: 'Скасувати доступ' }}><input type="hidden" name="roleId" value={mapping.discordRoleId} /><button type="submit" className="danger-button">Скасувати доступ</button></ActionForm>
      </div>}
    </div>
    {!editable && mapping.appRole === 'SUPER_ADMIN' && <p className="muted">Змінювати цей доступ може лише власник сервера або адміністратор, який його надав.</p>}
    <RoleMembers members={members} mode={mode} />
  </li>;
}

export function AccessRoleLists({ guildId, ownerId, mappings, roles, editable, actor, saveAction, removeAction }: {
  guildId: string; ownerId: string; mappings: readonly RoleMapping[]; roles: BotGuildRole[]; editable: boolean; actor: Pick<AccessActor, 'userId' | 'isOwner'>;
  saveAction: (form: FormData) => Promise<void>; removeAction: (form: FormData) => Promise<void>;
}) {
  const { members, mode } = useMemberDirectory();
  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const grouped = useMemo(() => membersByHighestAccessRole(guildId, members, mappings, roles, ownerId), [guildId, members, mappings, roles, ownerId]);
  const sorted = [...mappings].sort((left, right) => (roleById.get(right.discordRoleId)?.position ?? -1) - (roleById.get(left.discordRoleId)?.position ?? -1));
  const sections = [
    { title: 'Повний доступ', description: 'Налаштування бота та керування доступом.', mappings: sorted.filter((mapping) => mapping.appRole === 'SUPER_ADMIN') },
    { title: 'Налаштування бота', description: 'Налаштування бота без права змінювати доступ.', mappings: sorted.filter((mapping) => mapping.appRole === 'ADMIN') },
    { title: 'Лише перегляд', description: 'Перегляд доступних розділів без права вносити зміни.', mappings: sorted.filter((mapping) => mapping.appRole === 'VIEWER') },
  ];
  return <div className="access-role-sections">{sections.map((section) => <section key={section.title}>
    <div className="access-role-section-head"><div><h2>{section.title}</h2><p>{section.description}</p></div><span className="count-badge">{section.mappings.length}</span></div>
    {section.mappings.length ? <ul className="mapping-list">{section.mappings.map((mapping) => <AccessRoleCard key={mapping.discordRoleId} guildId={guildId} mapping={mapping} role={roleById.get(mapping.discordRoleId)} members={grouped.get(mapping.discordRoleId) ?? []} mode={mode} editable={editable && canEditAccessGrant(actor, mapping)} saveAction={saveAction} removeAction={removeAction} />)}</ul> : <p className="empty-state">Немає призначених ролей.</p>}
  </section>)}</div>;
}
