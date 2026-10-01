type Listener<T> = { next: (value: T) => void; error: (error: Error) => void };
type Subscription<T> = { listeners: Set<Listener<T>>; latest?: T; stop: () => void };

// A Firestore instance owns its listeners. Idle paths retain neither data nor sockets.
export function sharedSubscriptions<T>() {
  const owners = new WeakMap<object, Map<string, Subscription<T>>>();
  return (owner: object, key: string, start: (next: (value: T) => void, error: (error: Error) => void) => () => void, listener: Listener<T>): (() => void) => {
    let entries = owners.get(owner);
    if (!entries) { entries = new Map(); owners.set(owner, entries); }
    let entry = entries.get(key);
    if (entry) {
      entry.listeners.add(listener);
      if (entry.latest !== undefined) listener.next(entry.latest);
    } else {
      entry = { listeners: new Set([listener]), stop: () => {} };
      const current = entry;
      entries.set(key, current);
      try {
        const stop = start((value) => {
          current.latest = value;
          for (const subscriber of [...current.listeners]) subscriber.next(value);
        }, (error) => {
          if (entries.get(key) === current) entries.delete(key);
          const listeners = [...current.listeners];
          current.listeners.clear();
          current.stop();
          for (const subscriber of listeners) subscriber.error(error);
        });
        current.stop = stop;
        if (!current.listeners.size) stop();
      } catch (error) {
        entries.delete(key);
        throw error;
      }
    }
    const current = entry;
    return () => {
      if (!current.listeners.delete(listener) || current.listeners.size) return;
      if (entries.get(key) === current) entries.delete(key);
      current.stop();
    };
  };
}
