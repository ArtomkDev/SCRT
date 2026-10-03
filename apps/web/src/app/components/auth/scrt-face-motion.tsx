'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function ScrtFaceMotion({ children }: { children: ReactNode }) {
  const face = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = face.current;
    if (!element || typeof window.matchMedia !== 'function') return;
    const motion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    let frame = 0;
    let x = 0;
    let y = 0;
    function paint() {
      element!.style.setProperty('--face-x', `${x.toFixed(2)}px`);
      element!.style.setProperty('--face-y', `${y.toFixed(2)}px`);
      element!.style.setProperty('--eye-x', `${(x * .75).toFixed(2)}px`);
      element!.style.setProperty('--eye-y', `${(y * .75).toFixed(2)}px`);
      frame = 0;
    }
    function move(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return;
      x = Math.max(-6, Math.min(6, (event.clientX / window.innerWidth - .5) * 12));
      y = Math.max(-4, Math.min(4, (event.clientY / window.innerHeight - .5) * 8));
      if (!frame) frame = requestAnimationFrame(paint);
    }
    function reset() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      x = 0; y = 0;
      paint();
    }
    function removeTracking() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', reset);
      document.documentElement.removeEventListener('pointerleave', reset);
    }
    function configure() {
      removeTracking(); reset();
      if (!motion.matches) return;
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('blur', reset);
      document.documentElement.addEventListener('pointerleave', reset);
    }
    configure();
    motion.addEventListener('change', configure);
    return () => { removeTracking(); motion.removeEventListener('change', configure); reset(); };
  }, []);
  return <div ref={face} className="auth-face-motion">{children}</div>;
}
