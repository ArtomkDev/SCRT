'use client';

import { useState } from 'react';
import type { BotGuildRole } from '@scrt/discord';
import { ActionForm } from '@/app/components/action-form';

export function AccessRoleEditor({ guildId, roles, action }: { guildId: string; roles: BotGuildRole[]; action: (form: FormData) => Promise<void> }) {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const everyone = selectedRoleId === guildId;
  return <ActionForm trackChanges={false} action={action} className="access-role-form" successMessage="Доступ надано." feedbackPlacement="toast">
    <label>Роль Discord<select name="roleId" required value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}><option value="" disabled>Виберіть роль</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
    <label>Рівень доступу<select key={everyone ? 'everyone' : 'role'} name="appRole" defaultValue={everyone ? 'VIEWER' : 'ADMIN'}>{!everyone && <><option value="SUPER_ADMIN">Повний доступ</option><option value="ADMIN">Налаштування бота</option></>}<option value="VIEWER">Лише перегляд</option></select></label>
    <button type="submit" className="action-link" disabled={roles.length === 0}>Надати доступ</button>
  </ActionForm>;
}
