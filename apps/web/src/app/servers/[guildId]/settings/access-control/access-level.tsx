import type { RoleMapping } from '@scrt/permissions';
import { Select } from '@/app/components/select';

export const accessRoleLabels = { SUPER_ADMIN: 'Повний доступ', ADMIN: 'Налаштування бота', VIEWER: 'Лише перегляд' } as const;

export function PermissionBadge({ role }: { role: RoleMapping['appRole'] }) {
  return <span className="permission-badge">{accessRoleLabels[role]}</span>;
}

export function AccessLevelSelect({ defaultValue, viewerOnly = false }: { defaultValue: RoleMapping['appRole']; viewerOnly?: boolean }) {
  return <Select name="appRole" aria-label="Рівень доступу" defaultValue={defaultValue}>{Object.entries(accessRoleLabels).filter(([role]) => !viewerOnly || role === 'VIEWER').map(([role, label]) => <option key={role} value={role}>{label}</option>)}</Select>;
}
