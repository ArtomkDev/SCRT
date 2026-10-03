'use client';

import { useState } from 'react';
import type { BotGuildRole } from '@scrt/discord';
import { ActionForm } from '@/app/components/action-form';
import { Select } from '@/app/components/select';
import { Button } from '@/app/components/controls';
import { AccessLevelSelect } from './access-level';

export function AccessRoleEditor({ guildId, roles, action }: { guildId: string; roles: BotGuildRole[]; action: (form: FormData) => Promise<void> }) {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const everyone = selectedRoleId === guildId;
  return <ActionForm trackChanges={false} action={action} className="access-role-form" successMessage="Доступ надано." feedbackPlacement="toast">
    <label>Роль Discord<Select name="roleId" aria-label="Роль Discord" required searchable value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}><option value="" disabled>Виберіть роль</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></label>
    <label>Рівень доступу<AccessLevelSelect key={everyone ? 'everyone' : 'role'} defaultValue={everyone ? 'VIEWER' : 'ADMIN'} viewerOnly={everyone} /></label>
    <Button type="submit" disabled={roles.length === 0}>Надати доступ</Button>
  </ActionForm>;
}
