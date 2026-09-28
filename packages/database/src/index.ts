import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { GuildRecord } from '@scrt/shared';

export type FirebaseCredentials = { projectId: string; clientEmail: string; privateKey: string };
export function firestore(credentials: FirebaseCredentials) {
  const app = getApps().find((value) => value.name === 'scrt') ?? initializeApp({ credential: cert({ ...credentials, privateKey: credentials.privateKey.replace(/\\n/g, '\n') }) }, 'scrt');
  return getFirestore(app);
}

export class GuildRepository {
  constructor(private readonly db: ReturnType<typeof firestore>) {}
  async installedGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    const installed = new Set<string>();
    for (let start = 0; start < guildIds.length; start += 100) {
      const ids = guildIds.slice(start, start + 100);
      const snapshots = await this.db.getAll(...ids.map((id) => this.db.collection('guilds').doc(id)));
      for (const snapshot of snapshots) {
        if (snapshot.get('botInstalled') === true) installed.add(snapshot.id);
      }
    }
    return installed;
  }
  async get(guildId: string): Promise<GuildRecord | null> {
    const snapshot = await this.db.collection('guilds').doc(guildId).get();
    return snapshot.exists ? snapshot.data() as GuildRecord : null;
  }
  async upsertInstalled(guild: Omit<GuildRecord, 'botInstalled' | 'schemaVersion'>): Promise<void> {
    const ref = this.db.collection('guilds').doc(guild.guildId);
    await this.db.runTransaction(async (transaction) => {
      const prior = await transaction.get(ref);
      transaction.set(ref, {
        ...guild, botInstalled: true, schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
        installedAt: prior.exists && prior.get('installedAt') ? prior.get('installedAt') : FieldValue.serverTimestamp(),
        removedAt: FieldValue.delete(),
      }, { merge: true });
    });
  }
  async markDisconnected(guildId: string): Promise<void> {
    await this.db.collection('guilds').doc(guildId).set({ botInstalled: false, removedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  async roleMappings(guildId: string): Promise<Array<{ discordRoleId: string; appRole: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER' }>> {
    const snapshot = await this.db.collection('guilds').doc(guildId).collection('access').doc('roles').get();
    const mappings = snapshot.get('mappings');
    if (!Array.isArray(mappings)) return [];
    return mappings.filter((value): value is { discordRoleId: string; appRole: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER' } => typeof value === 'object' && value !== null && typeof value.discordRoleId === 'string' && ['SUPER_ADMIN', 'ADMIN', 'VIEWER'].includes(value.appRole));
  }
}
