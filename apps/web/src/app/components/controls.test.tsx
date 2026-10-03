// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Button, Checkbox, Switch } from './controls';
import { Select } from './select';
import { DurationInput } from './duration-input';
import { ResourceMultiSelect } from './resource-multiselect';
import { ActionForm } from './action-form';
import { UnsavedChangesProvider } from './unsaved-changes';
import { UserExclusions } from '../servers/[guildId]/activity/settings/user-exclusions';
import { Dialog } from './dialog';

vi.stubGlobal('React', React);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

function Settings({ action = vi.fn(), children }: { action?: (form: FormData) => Promise<void>; children: React.ReactNode }) {
  return <UnsavedChangesProvider><ActionForm action={action}>{children}<Button type="submit">Зберегти форму</Button></ActionForm></UnsavedChangesProvider>;
}

describe('dashboard controls and form lifecycle', () => {
  it('keeps labels, switches, disabled checkboxes and native form values accessible', () => {
    render(<Settings><Checkbox name="messages" label="Повідомлення" defaultChecked /><Checkbox name="voice" label="Voice" disabled /><Switch name="enabled" label="Модуль активності" /></Settings>);
    const checkbox = screen.getByRole('checkbox', { name: 'Повідомлення' }) as HTMLInputElement;
    fireEvent.click(screen.getByText('Повідомлення'));
    expect(checkbox.checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Voice' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Модуль активності' }));
    expect(new FormData(checkbox.form!).get('enabled')).toBe('on');
    expect(screen.getByText('Незбережені зміни')).toBeTruthy();
  });

  it('supports searchable selection, keyboard navigation, Escape, submit and discard', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<Settings action={action}><label>Роль<Select name="roleId" aria-label="Роль Discord" defaultValue="1" searchable><option value="1">Admin</option><option value="2">Moderator</option><option value="3" disabled>Disabled</option></Select></label></Settings>);
    const trigger = screen.getByRole('combobox', { name: 'Роль Discord' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Mod' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const option = screen.getByRole('option', { name: 'Moderator' });
    expect(document.activeElement).toBe(option);
    fireEvent.click(option);
    expect(trigger.textContent).toContain('Moderator');
    expect(screen.getByText('Незбережені зміни')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати зміни' }));
    await waitFor(() => expect(trigger.textContent).toContain('Admin'));
    expect(screen.queryByText('Незбережені зміни')).toBeNull();
    fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull(); expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('option', { name: 'Moderator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти форму' }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect((action.mock.calls[0]![0] as FormData).get('roleId')).toBe('2');
  });

  it('shows validation at a required custom select and keeps disabled selects inert', () => {
    render(<Settings><Select name="roleId" aria-label="Роль" required defaultValue=""><option value="" disabled>Виберіть</option><option value="1">Admin</option></Select><Select name="level" aria-label="Доступ" disabled defaultValue="VIEWER"><option value="VIEWER">Перегляд</option></Select></Settings>);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти форму' }));
    expect(screen.getByRole('alert').textContent).toContain('Виберіть значення');
    expect(screen.getByRole('combobox', { name: 'Роль' }).getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Доступ' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('converts minutes to stored seconds, rejects invalid durations and restores visible state', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<Settings action={action}><DurationInput name="voiceMinimum" label="Мінімальна сесія Voice" defaultSeconds={60} max={3600} /></Settings>);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('1');
    fireEvent.change(input, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByText('Незбережені зміни')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти форму' }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect((action.mock.calls[0]![0] as FormData).get('voiceMinimum')).toBe('300');
    fireEvent.change(input, { target: { value: '-4' } }); fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toContain('3600 секунд');
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати зміни' }));
    await waitFor(() => expect(input.value).toBe('5'));
    expect(screen.queryByText('Незбережені зміни')).toBeNull();
  });

  it('keeps searchable resource chips in the form and discards selection changes', async () => {
    render(<Settings><ResourceMultiSelect name="roleIds" label="Ролі" options={[{ id: '1', name: 'Admin' }, { id: '2', name: 'Moderator' }]} defaultSelected={['1']} /></Settings>);
    fireEvent.click(screen.getByText('+ Вибрати ролі'));
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'Moderator' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Moderator' }));
    expect(screen.getByRole('button', { name: 'Прибрати: Moderator' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати: Admin' }));
    expect(new FormData(search.closest('form')!).getAll('roleIds')).toEqual(['2']);
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати зміни' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Прибрати: Moderator' })).toBeNull());
    expect(new FormData(search.closest('form')!).getAll('roleIds')).toEqual(['1']);
  });

  it('detects removed user chips and restores them on discard', async () => {
    render(<Settings><UserExclusions guildId="12345678901234567" editable selected={[{ userId: '22345678901234567', displayName: 'Artom' }]} /></Settings>);
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати: Artom' }));
    await waitFor(() => expect(screen.getByText('Незбережені зміни')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати зміни' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Прибрати: Artom' })).toBeTruthy());
    expect(screen.queryByText('Незбережені зміни')).toBeNull();
  });

  it('requires confirmation for destructive actions and restores focus after cancellation', () => {
    const action = vi.fn();
    render(<UnsavedChangesProvider><ActionForm action={action} trackChanges={false} confirmation={{ title: 'Скасувати доступ?', description: 'Роль втратить доступ.', actionLabel: 'Скасувати доступ' }}><Button type="submit">Прибрати роль</Button></ActionForm></UnsavedChangesProvider>);
    const trigger = screen.getByRole('button', { name: 'Прибрати роль' }); trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скасувати' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it('keeps Tab and Shift+Tab inside the dialog at both boundaries', () => {
    const rectangles = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    try {
      render(<Dialog open onClose={vi.fn()} title="Доступ" footer={<Button>Зберегти</Button>}><Button>Редагувати</Button></Dialog>);
      const first = screen.getByRole('button', { name: 'Закрити діалог' });
      const last = screen.getByRole('button', { name: 'Зберегти' });
      first.focus(); fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
      fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
    } finally { rectangles.mockRestore(); }
  });
});
