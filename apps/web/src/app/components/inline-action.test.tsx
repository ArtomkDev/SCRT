import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InlineAction } from './inline-action';

vi.stubGlobal('React', React);
describe('inline navigation actions', () => {
  it('keeps the canonical destination, accessible text and decorative icon', () => {
    const html = renderToStaticMarkup(<InlineAction href="/servers/123/activity/leaderboard" className="activity-more">Переглянути рейтинг</InlineAction>);
    expect(html).toContain('href="/servers/123/activity/leaderboard"');
    expect(html).toContain('inline-action activity-more');
    expect(html).toContain('Переглянути рейтинг');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('→');
  });
  it('supports compact back navigation', () => {
    const html = renderToStaticMarkup(<InlineAction href="/servers" direction="back">Усі сервери</InlineAction>);
    expect(html.indexOf('<svg')).toBeLessThan(html.indexOf('<span>Усі сервери'));
  });
});
