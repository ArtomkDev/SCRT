import type { ActivityProfile } from '@scrt/shared';
import { snowflakeSchema } from '@scrt/validation';

type Waiter = { id: string; resolve: (profile: ActivityProfile | null) => void; reject: (error: unknown) => void };

// One instance per render request. Batch only IDs already available; a slow
// ranking never delays another table, and shared members are read once.
export function activityProfileReader(load: (guildId: string, ids: string[]) => Promise<ActivityProfile[]>) {
  const reads = new Map<string, Promise<ActivityProfile | null>>();
  const pending = new Map<string, Waiter[]>();
  function member(guildId: string, id: string) {
    const key = `${guildId}:${id}`;
    let read = reads.get(key);
    if (!read) {
      read = new Promise((resolve, reject) => {
        let batch = pending.get(guildId);
        if (!batch) {
          batch = [];
          pending.set(guildId, batch);
          const current = batch;
          queueMicrotask(() => {
            pending.delete(guildId);
            for (let start = 0; start < current.length; start += 100) {
              const chunk = current.slice(start, start + 100);
              void Promise.resolve().then(() => load(guildId, chunk.map((item) => item.id))).then((profiles) => {
                const byId = new Map(profiles.map((profile) => [profile.userId, profile]));
                chunk.forEach((item) => item.resolve(byId.get(item.id) ?? null));
              }).catch((error: unknown) => { chunk.forEach((item) => item.reject(error)); });
            }
          });
        }
        batch.push({ id, resolve, reject });
      });
      reads.set(key, read);
    }
    return read;
  }
  return async (guildId: string, ids: string[]) => {
    const valid = ids.slice(0, 100).map((id) => snowflakeSchema.parse(id));
    return (await Promise.all(valid.map((id) => member(guildId, id)))).filter((profile): profile is ActivityProfile => profile !== null);
  };
}
