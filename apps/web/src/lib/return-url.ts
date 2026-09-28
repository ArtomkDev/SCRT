export function safeReturnUrl(next: string, base: URL): URL {
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return new URL('/servers', base);
  try {
    const target = new URL(next, base);
    return target.origin === base.origin ? target : new URL('/servers', base);
  } catch {
    return new URL('/servers', base);
  }
}
