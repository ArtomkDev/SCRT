// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrtFaceMotion } from './scrt-face-motion';

let matches: boolean;
let frame: FrameRequestCallback | undefined;
let mediaChange: (() => void) | undefined;

function pointer(clientX: number, clientY: number, pointerType = 'mouse') {
  const event = new Event('pointermove');
  Object.assign(event, { clientX, clientY, pointerType });
  fireEvent(window, event);
}

describe('decorative SCRT face motion', () => {
  beforeEach(() => {
    matches = true; frame = undefined; mediaChange = undefined;
    vi.stubGlobal('React', React);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return matches; }, addEventListener: (_name: string, callback: () => void) => { mediaChange = callback; }, removeEventListener: vi.fn() })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('coalesces pointer updates, caps movement and recenters on blur', () => {
    const { container } = render(<ScrtFaceMotion><span>artwork</span></ScrtFaceMotion>);
    const face = container.firstElementChild as HTMLElement;
    pointer(window.innerWidth * 2, window.innerHeight * 2);
    pointer(window.innerWidth * 3, window.innerHeight * 3);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frame?.(0));
    expect(face.style.getPropertyValue('--face-x')).toBe('6.00px');
    expect(face.style.getPropertyValue('--face-y')).toBe('4.00px');
    expect(face.style.getPropertyValue('--eye-x')).toBe('4.50px');
    expect(face.style.getPropertyValue('--eye-y')).toBe('3.00px');
    fireEvent(window, new Event('blur'));
    expect(face.style.getPropertyValue('--face-x')).toBe('0.00px');
    expect(face.style.getPropertyValue('--face-y')).toBe('0.00px');
    expect(face.style.getPropertyValue('--eye-x')).toBe('0.00px');
    expect(face.style.getPropertyValue('--eye-y')).toBe('0.00px');
  });
  it('does not track touch input', () => {
    render(<ScrtFaceMotion><span>artwork</span></ScrtFaceMotion>);
    pointer(100, 100, 'touch');
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it('disables tracking for reduced motion or coarse pointers', () => {
    matches = false;
    render(<ScrtFaceMotion><span>artwork</span></ScrtFaceMotion>);
    expect(matchMedia).toHaveBeenCalledWith('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    pointer(100, 100);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it('cancels scheduled work and stops tracking when the motion preference changes', () => {
    const { container } = render(<ScrtFaceMotion><span>artwork</span></ScrtFaceMotion>);
    pointer(100, 100);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    matches = false;
    act(() => mediaChange?.());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue('--face-x')).toBe('0.00px');
    pointer(200, 200);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
