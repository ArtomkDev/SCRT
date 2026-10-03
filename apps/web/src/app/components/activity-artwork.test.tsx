// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { generatedArtwork } from '@scrt/artwork';
import { ActivityHero, ActivityIcon } from './activity-artwork';
vi.stubGlobal('React', React);
afterEach(cleanup);
const identity = { gameKey: 'name:customlauncher', displayName: 'CustomLauncher', applicationId: null };
describe('Activity visual fallbacks', () => {
  it('always renders a stable identity and wide hero without external images', () => {
    const { container } = render(<ActivityHero gameKey={identity.gameKey} name={identity.displayName} />);
    expect(container.querySelector('.activity-artwork-hero')).not.toBeNull();
    expect(container.textContent).toContain('CustomLauncher'); expect(container.querySelector('.activity-artwork-icon')?.textContent).toBe('CL');
  });
  it('removes broken remote icons and reveals initials, then accepts a changed URL', () => {
    const artwork = generatedArtwork(identity); artwork.overrides.iconUrl = 'https://images.example.com/manual.png';
    const view = render(<ActivityIcon gameKey={identity.gameKey} name={identity.displayName} artwork={artwork} />);
    const image = view.container.querySelector('img')!;
    expect(image.src).toContain('manual.png'); fireEvent.load(image);
    expect(view.container.querySelector('.activity-artwork-initials')).toBeNull();
    fireEvent.error(image); expect(view.container.querySelector('img')).toBeNull(); expect(view.container.textContent).toBe('CL');
    view.rerender(<ActivityIcon gameKey={identity.gameKey} name={identity.displayName} artwork={{ ...artwork, overrides: { iconUrl: 'https://images.example.com/new.png', heroUrl: null } }} />);
    expect(view.container.querySelector('img')?.src).toContain('new.png');
  });
  it('uses a manual banner and falls back to the generated hero on image errors', () => {
    const artwork = generatedArtwork(identity); artwork.overrides.heroUrl = 'https://images.example.com/banner.png';
    const { container } = render(<ActivityHero gameKey={identity.gameKey} name={identity.displayName} artwork={artwork} />);
    const banner = container.querySelector('.activity-artwork-banner')!; fireEvent.error(banner);
    expect(container.querySelector('.activity-artwork-banner')).toBeNull(); expect(container.querySelector('.activity-artwork-hero')).not.toBeNull();
    expect(container.textContent).toContain('CustomLauncher');
  });
});
