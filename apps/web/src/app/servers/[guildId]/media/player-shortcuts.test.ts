// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayerShortcuts } from './player-shortcuts';

const options = () => ({ canToggle: true, canSeek: true, blocked: false, onToggle: vi.fn(), onSeek: vi.fn(), onSearch: vi.fn() });
afterEach(() => { cleanup(); document.body.replaceChildren(); });

describe('Media keyboard controls', () => {
  it('uses physical seek keys for Ukrainian layouts and current permission state', () => {
    const callbacks = options();
    const { rerender } = renderHook((state) => usePlayerShortcuts(state), { initialProps: callbacks });
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    fireEvent.keyDown(document.body, { code: 'KeyJ', key: 'о' });
    fireEvent.keyDown(document.body, { code: 'KeyL', key: 'д' });
    expect(callbacks.onToggle).toHaveBeenCalledOnce();
    expect(callbacks.onSeek.mock.calls).toEqual([[-10000], [10000]]);
    rerender({ ...callbacks, canToggle: false, canSeek: false });
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    fireEvent.keyDown(document.body, { code: 'KeyL', key: 'l' });
    expect(callbacks.onToggle).toHaveBeenCalledOnce(); expect(callbacks.onSeek).toHaveBeenCalledTimes(2);
  });
  it('blocks playback while commands are pending but keeps search focus available', () => {
    const callbacks = { ...options(), blocked: true }; renderHook(() => usePlayerShortcuts(callbacks));
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
    fireEvent.keyDown(document.body, { code: 'KeyL', key: 'l' });
    fireEvent.keyDown(document.body, { code: 'Slash', key: '/' });
    expect(callbacks.onToggle).not.toHaveBeenCalled(); expect(callbacks.onSeek).not.toHaveBeenCalled(); expect(callbacks.onSearch).toHaveBeenCalledOnce();
  });
  it.each(['input', 'textarea', 'select', 'button', 'a', 'summary', 'div[contenteditable="true"]', 'div[role="slider"]'])('preserves native input in %s', (selector) => {
    const callbacks = options(); renderHook(() => usePlayerShortcuts(callbacks));
    const element = document.createElement(selector.split('[')[0]!);
    if (selector.includes('contenteditable')) element.setAttribute('contenteditable', 'true');
    if (selector.includes('role=')) element.setAttribute('role', 'slider');
    document.body.append(element);
    for (const event of [{ code: 'Space', key: ' ' }, { code: 'KeyL', key: 'l' }, { code: 'Slash', key: '/' }]) fireEvent.keyDown(element, event);
    expect(callbacks.onToggle).not.toHaveBeenCalled(); expect(callbacks.onSeek).not.toHaveBeenCalled(); expect(callbacks.onSearch).not.toHaveBeenCalled();
  });
  it('ignores open dialogs, modifiers, held keys and removes listeners on departure', () => {
    const callbacks = options(); const { unmount } = renderHook(() => usePlayerShortcuts(callbacks));
    const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
    fireEvent.keyDown(document.body, { code: 'Slash', key: '/' }); dialog.remove();
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ', ctrlKey: true });
    fireEvent.keyDown(document.body, { code: 'Space', key: ' ', repeat: true });
    unmount(); fireEvent.keyDown(document.body, { code: 'KeyL', key: 'l' });
    expect(callbacks.onToggle).not.toHaveBeenCalled(); expect(callbacks.onSeek).not.toHaveBeenCalled(); expect(callbacks.onSearch).not.toHaveBeenCalled();
  });
});
