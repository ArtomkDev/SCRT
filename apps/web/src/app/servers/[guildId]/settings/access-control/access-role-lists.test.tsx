// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { UnsavedChangesProvider } from '@/app/components/unsaved-changes';
import { AccessRoleLists } from './access-role-lists';
import { AccessRoleEditor } from './access-role-editor';

vi.stubGlobal('React', React);
vi.mock('./member-directory', () => ({ useMemberDirectory: () => ({ members: [], mode: 'ready' }) }));
const guildId = '12345678901234567';
const roleId = '22345678901234567';
const actorId = '32345678901234567';
const roles = [{ id: guildId, name: '@everyone', position: 0, permissions: '0', color: 0 }, { id: roleId, name: 'Команда', position: 1, permissions: '0', color: 0 }];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe('access role presentation preserves grant policy', () => {
  it('opens edit from the menu and sends the original role fields to the existing action', async () => {
    const save = vi.fn().mockResolvedValue(undefined); const remove = vi.fn();
    render(<UnsavedChangesProvider><AccessRoleLists guildId={guildId} ownerId={actorId} mappings={[{ discordRoleId: roleId, appRole: 'ADMIN' }]} roles={roles} editable actor={{ userId: actorId, isOwner: true }} saveAction={save} removeAction={remove} /></UnsavedChangesProvider>);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Команда' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Змінити рівень' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Лише перегляд' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const data = save.mock.calls[0]![0] as FormData;
    expect(data.get('roleId')).toBe(roleId); expect(data.get('appRole')).toBe('VIEWER');
    expect(remove).not.toHaveBeenCalled();
  });
  it('confirms role removal before invoking the existing action', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(<UnsavedChangesProvider><AccessRoleLists guildId={guildId} ownerId={actorId} mappings={[{ discordRoleId: roleId, appRole: 'ADMIN' }]} roles={roles} editable actor={{ userId: actorId, isOwner: true }} saveAction={vi.fn()} removeAction={remove} /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Дії: Команда' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Скасувати доступ' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Скасувати доступ' }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect((remove.mock.calls[0]![0] as FormData).get('roleId')).toBe(roleId);
  });
  it('hides mutations for protected SUPER_ADMIN grants and read-only viewers', () => {
    const props = { guildId, ownerId: actorId, mappings: [{ discordRoleId: roleId, appRole: 'SUPER_ADMIN' as const, grantedBy: '42345678901234567' }], roles, actor: { userId: actorId, isOwner: false }, saveAction: vi.fn(), removeAction: vi.fn() };
    const view = render(<UnsavedChangesProvider><AccessRoleLists {...props} editable /></UnsavedChangesProvider>);
    expect(screen.queryByRole('button', { name: 'Дії: Команда' })).toBeNull();
    view.rerender(<UnsavedChangesProvider><AccessRoleLists {...props} editable={false} actor={{ ...props.actor, isOwner: true }} /></UnsavedChangesProvider>);
    expect(screen.queryByRole('button', { name: 'Дії: Команда' })).toBeNull();
  });
  it('limits @everyone to VIEWER in the searchable add-access flow', async () => {
    render(<UnsavedChangesProvider><AccessRoleEditor guildId={guildId} roles={roles} action={vi.fn()} /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole('combobox', { name: 'Роль Discord' }));
    fireEvent.click(screen.getByRole('option', { name: '@everyone' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Рівень доступу' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Лише перегляд' })).toBeTruthy();
  });
});
