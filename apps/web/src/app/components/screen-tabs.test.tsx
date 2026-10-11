// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActivityTabs } from './activity-tabs';
import { VoiceTabs } from './voice-tabs';
import { DashboardScreen, MetricCard, Panel, ScreenHeader } from './dashboard-screen';
import { ScreenTabs } from './screen-tabs';
import { PeriodLinks, MetricLinks } from '../servers/[guildId]/activity/period-links';

const navigation = vi.hoisted(() => ({ pathname: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
const guildId = '12345678901234567';
beforeEach(() => { vi.stubGlobal('React', React); navigation.pathname = ''; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  ['activity', '/games/example', 'Ігри та застосунки'],
  ['activity', '/members/person', 'Учасники'],
  ['voice', '/creators', 'Канали створення'],
  ['voice', '', 'Огляд'],
])('keeps %s navigation active on %s', (module, suffix, title) => {
  navigation.pathname = `/servers/${guildId}/${module}${suffix}`;
  const { container } = render(module === 'activity' ? <ActivityTabs guildId={guildId} /> : <VoiceTabs guildId={guildId} />);
  expect(screen.getByRole('link', { name: title }).getAttribute('aria-current')).toBe('page');
  expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});

const root = `/servers/${guildId}/activity`;
const entries = [
  { href: root, label: 'Overview', nested: true },
  { href: `${root}/games`, label: 'Games', nested: true },
  { href: `${root}/games/details`, label: 'Details', nested: true },
];

it('selects the most specific route and excludes sibling names and other guilds', () => {
  navigation.pathname = `${root}/games/details/example`;
  const view = render(<ScreenTabs entries={entries} label="Module" />);
  expect(screen.getByRole('link', { name: 'Details' }).getAttribute('aria-current')).toBe('page');
  navigation.pathname = `${root}/games-other`; view.rerender(<ScreenTabs entries={entries} label="Module" />);
  expect(screen.getByRole('link', { name: 'Games' }).hasAttribute('aria-current')).toBe(false);
  navigation.pathname = '/servers/22345678901234567/activity/games'; view.rerender(<ScreenTabs entries={entries} label="Module" />);
  expect(view.container.querySelector('[aria-current]')).toBeNull();
});

it('reveals an overflowed active tab within navigation and disconnects on unmount', () => {
  navigation.pathname = `${root}/games`;
  const scroll = vi.fn(), disconnect = vi.fn(), observe = vi.fn();
  let resize: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const outside = this.getAttribute('aria-current') === 'page';
    return { left: outside ? 240 : 0, right: outside ? 320 : 200 } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scroll });
  const pageScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const view = render(<ScreenTabs entries={entries} label="Module" />);
  expect(observe).toHaveBeenCalledWith(screen.getByRole('navigation', { name: 'Module' }));
  expect(scroll).toHaveBeenCalledWith({ left: 132 });
  resize?.();
  expect(scroll).toHaveBeenCalledTimes(2);
  expect(pageScroll).not.toHaveBeenCalled();
  view.unmount(); expect(disconnect).toHaveBeenCalledOnce();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
});

it('retargets one shared plate across rapid route changes and preserves its content position when scrolling and resizing', () => {
  const bounds: Record<string, { left: number; width: number; height: number }> = {
    [root]: { left: 0, width: 110, height: 50 },
    [`${root}/games`]: { left: 114, width: 130, height: 50 },
    [`${root}/games/details`]: { left: 248, width: 90, height: 50 },
  };
  let resize: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const bound = bounds[this.getAttribute('href') ?? ''];
    const left = bound ? 100 + bound.left - (this.parentElement?.scrollLeft ?? 0) : 100;
    const width = bound?.width ?? 400, height = bound?.height ?? 50;
    return { left, right: left + width, top: 0, bottom: height, width, height, x: left, y: 0, toJSON: () => ({}) };
  });
  navigation.pathname = root;
  const view = render(<ScreenTabs entries={entries} label="Module" />);
  const nav = screen.getByRole('navigation', { name: 'Module' });
  const plate = view.container.querySelector<HTMLElement>('.dashboard-screen-tab-indicator')!;
  expect(nav.getAttribute('data-indicator-ready')).toBe('true');
  expect(plate.style.getPropertyValue('--tab-left')).toBe('0px');
  for (const suffix of ['/games', '/games/details', '', '/games']) {
    navigation.pathname = `${root}${suffix}`; view.rerender(<ScreenTabs entries={entries} label="Module" />);
    expect(view.container.querySelector('.dashboard-screen-tab-indicator')).toBe(plate);
    expect(plate.style.getPropertyValue('--tab-left')).toBe(`${bounds[navigation.pathname]!.left}px`);
    expect(plate.style.getPropertyValue('--tab-width')).toBe(`${bounds[navigation.pathname]!.width}px`);
  }
  nav.scrollLeft = 40; act(() => resize?.());
  expect(plate.style.getPropertyValue('--tab-left')).toBe('114px');
  bounds[`${root}/games`] = { left: 120, width: 145, height: 46 }; act(() => resize?.());
  expect(plate.style.getPropertyValue('--tab-left')).toBe('120px');
  expect(plate.style.getPropertyValue('--tab-width')).toBe('145px');
  expect(plate.style.getPropertyValue('--tab-height')).toBe('46px');
  navigation.pathname = '/another-module'; view.rerender(<ScreenTabs entries={entries} label="Module" />);
  expect(nav.getAttribute('data-indicator-ready')).toBe('false');
  expect(view.container.querySelectorAll('.dashboard-screen-tab-indicator')).toHaveLength(1);
});

it('preserves fieldset, list, and definition semantics inside the shared screen', () => {
  render(<DashboardScreen header={<ScreenHeader title="Settings" />}>
    <form aria-label="Settings form"><Panel as="fieldset" disabled><legend>Read only</legend><input name="restricted" aria-label="Restricted" required /></Panel></form>
    <Panel as="ul" aria-label="Items"><li>First</li></Panel>
    <dl><MetricCard label="Rooms" value={0} /></dl>
  </DashboardScreen>);
  expect(screen.getByRole('main').contains(screen.getByRole('heading', { level: 1, name: 'Settings' }))).toBe(true);
  const form = screen.getByRole('form', { name: 'Settings form' }) as HTMLFormElement;
  expect(form.checkValidity()).toBe(true);
  expect(new FormData(form).has('restricted')).toBe(false);
  expect(within(screen.getByRole('list', { name: 'Items' })).getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('Rooms').tagName).toBe('DT');
  expect(screen.getByText('0').tagName).toBe('DD');
});

it('keeps selected period and metric in query links without linking loading placeholders', () => {
  const view = render(<><PeriodLinks path={root} period="7d" metric="messages" /><MetricLinks path={root} period="7d" metric="messages" /></>);
  const period = within(screen.getByRole('navigation', { name: 'Період' })).getAllByRole('link').find(link => link.hasAttribute('aria-current'));
  const metric = within(screen.getByRole('navigation', { name: 'Показник' })).getAllByRole('link').find(link => link.hasAttribute('aria-current'));
  expect(period?.getAttribute('href')).toBe(`${root}?period=7d&metric=messages`);
  expect(metric?.getAttribute('href')).toBe(`${root}?metric=messages&period=7d`);
  view.rerender(<PeriodLinks />);
  expect(within(screen.getByRole('navigation', { name: 'Період' })).queryByRole('link')).toBeNull();
});
