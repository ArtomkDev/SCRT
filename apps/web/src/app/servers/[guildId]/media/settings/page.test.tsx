// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mediaSettingsSchema } from '@scrt/validation';
import { UnsavedChangesProvider } from '@/app/components/unsaved-changes';

const mocks = vi.hoisted(() => ({ access: vi.fn(), settings: vi.fn(), resources: vi.fn(), save: vi.fn(), configuration: vi.fn() }));
vi.mock('@/lib/guards', () => ({ requireGuildAccess: mocks.access }));
vi.mock('@/lib/media-data', () => ({ mediaSettings: mocks.settings, mediaConfigurationError: mocks.configuration }));
vi.mock('@/lib/voice-data', () => ({ voiceResources: mocks.resources }));
vi.mock('../actions', () => ({ saveMediaSettings: mocks.save }));
import MediaSettingsPage from './page';

vi.stubGlobal('React', React);
const guildId = '12345678901234567';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ guild: { resourceRevision: 0 }, permissions: new Set(['media.manage']) });
  mocks.settings.mockResolvedValue(mediaSettingsSchema.parse({}));
  mocks.resources.mockResolvedValue({ roles: [], channels: [] });
  mocks.configuration.mockReturnValue(null);
  mocks.save.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function settingsPage() {
  const page = await MediaSettingsPage({ params: Promise.resolve({ guildId }) });
  render(<UnsavedChangesProvider>{page}</UnsavedChangesProvider>);
  fireEvent.click(screen.getByRole('switch', { name: /Увімкнути Медіа/ }));
}

describe('Media settings banner save', () => {
  it('submits enabling through the floating save button with valid native form values', async () => {
    await settingsPage();
    const enabled = screen.getByRole('switch', { name: /Увімкнути Медіа/ }) as HTMLInputElement;
    expect(enabled.form?.checkValidity()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const [savedGuild, data] = mocks.save.mock.calls[0]! as [string, FormData];
    expect(savedGuild).toBe(guildId);
    expect(data.get('enabled')).toBe('on');
    expect(data.get('skipVoteRatio')).toBe('0.5');
    await waitFor(() => expect(screen.queryByText('Незбережені зміни')).toBeNull());
    expect(screen.getByText('Зміни збережено.').closest('p')?.className).toContain('form-feedback-toast');
  });

  it('shows progress then the returned API reason and preserves unsaved changes for retry', async () => {
    let finish!: (result: { error: string }) => void;
    mocks.save.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await settingsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(screen.getByText('Збереження…').className).toContain('form-feedback-toast');
    finish({ error: 'Не вдалося підключитися до Media API. Перезапустіть бота.' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Перезапустіть бота');
    expect(alert.className).toContain('form-feedback-toast');
    expect(screen.getByText('Незбережені зміни')).toBeTruthy();
    expect(screen.queryByText('Зміни збережено.')).toBeNull();
    mocks.save.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    await waitFor(() => expect(screen.queryByText('Незбережені зміни')).toBeNull());
  });

  it('shows generic feedback for unexpected errors without exposing internal details', async () => {
    mocks.save.mockRejectedValue(new Error('Private infrastructure details'));
    await settingsPage();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не вдалося зберегти зміни. Спробуйте ще раз.');
    expect(screen.queryByText('Private infrastructure details')).toBeNull();
    expect(screen.getByText('Незбережені зміни')).toBeTruthy();
  });
});
