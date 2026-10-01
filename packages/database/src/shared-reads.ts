// Coalesce simultaneous reads, then discard the result so authorization stays live.
export function sharedReads<T>() {
  const owners = new WeakMap<object, Map<string, Promise<T>>>();
  return (owner: object, path: string, read: () => Promise<T>): Promise<T> => {
    let pending = owners.get(owner);
    if (!pending) { pending = new Map(); owners.set(owner, pending); }
    const existing = pending.get(path);
    if (existing) return existing;
    if (pending.size >= 512) return Promise.reject(new Error('Too many concurrent database reads'));
    const request = Promise.resolve().then(read);
    pending.set(path, request);
    void request.finally(() => { if (pending.get(path) === request) pending.delete(path); }).catch(() => {});
    return request;
  };
}
