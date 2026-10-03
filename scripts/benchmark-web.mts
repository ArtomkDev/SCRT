import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { DirectoryMember } from '../packages/validation/src/index';
import { sharedReads } from '../packages/database/src/shared-reads';
import { sharedSubscriptions } from '../packages/database/src/shared-subscriptions';
import { memberSearchIndex, searchMemberIndex } from '../apps/web/src/app/servers/[guildId]/settings/access-control/member-search-utils';
import { membersByHighestAccessRole } from '../apps/web/src/app/servers/[guildId]/settings/access-control/role-members';
import { botGuildMember } from '../packages/discord/src/index';

// Synthetic, repeatable work; no credentials, Discord calls or database writes.
const guildId = '100000000000000000';
const roles = Array.from({ length: 250 }, (_, i) => ({ id: String(200000000000000000n + BigInt(i)), position: i, name: `Role ${i}`, permissions: '0' }));
const members: DirectoryMember[] = Array.from({ length: 100_000 }, (_, i) => ({
  id: String(300000000000000000n + BigInt(i)), username: `user_${String(i).padStart(6, '0')}`,
  globalName: null, nick: null, avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
  roleIds: [roles[i % roles.length]!.id, roles[(i + 1) % roles.length]!.id],
}));
const elapsed = (start: number) => Math.round((performance.now() - start) * 100) / 100;

let start = performance.now();
const index = memberSearchIndex(members);
const indexMs = elapsed(start);
start = performance.now();
const results = searchMemberIndex(index, 'user', new Set());
const searchMs = elapsed(start);
assert.equal(results.total, members.length);
assert.equal(results.matches.length, 30);

start = performance.now();
const groups = membersByHighestAccessRole(guildId, members, roles.map((role) => ({ discordRoleId: role.id, appRole: 'VIEWER' })), roles, 'owner');
const groupMs = elapsed(start);
assert.equal([...groups.values()].reduce((total, group) => total + group.length, 0), members.length);

const database = {};
const read = sharedReads<number>();
let reads = 0;
start = performance.now();
await Promise.all(Array.from({ length: 1000 }, () => read(database, 'guilds/example', async () => ++reads)));
const readsMs = elapsed(start);
assert.equal(reads, 1);

const subscribe = sharedSubscriptions<number>();
let listeners = 0;
let notifications = 0;
let released = 0;
let emit!: (value: number) => void;
start = performance.now();
const stops = Array.from({ length: 1000 }, () => subscribe(database, 'guilds/example', (next) => {
  listeners++; emit = next;
  return () => { released++; };
}, { next: () => { notifications++; }, error: (error) => { throw error; } }));
emit(1);
stops.forEach((stop) => stop());
const fanoutMs = elapsed(start);
assert.equal(listeners, 1);
assert.equal(notifications, 1000);
assert.equal(released, 1);

// Exercise the real Discord scheduler with simulated network delay, without
// credentials. This measures contention rather than page-cache performance.
const fetchBeforeBenchmark = globalThis.fetch;
const simulatedReadMs = 30;
let simulatedRequests = 0;
let fifoAccessMs = 0;
let priorityAccessMs = 0;
try {
  globalThis.fetch = async (input) => {
    simulatedRequests++;
    await new Promise((resolve) => setTimeout(resolve, simulatedReadMs));
    return new Response(JSON.stringify({ roles: [], user: { id: String(input).split('/').at(-1), username: 'Benchmark' } }));
  };
  for (const priority of ['normal', 'interactive'] as const) {
    const token = `synthetic-queue-${priority}`;
    const readers = Array.from({ length: 8 }, (_, index) => botGuildMember(token, guildId, members[index]!.id));
    const accessStarted = performance.now();
    await botGuildMember(token, guildId, '99999999999999999', { priority });
    const accessMs = elapsed(accessStarted);
    if (priority === 'normal') fifoAccessMs = accessMs; else priorityAccessMs = accessMs;
    await Promise.all(readers);
  }
} finally { globalThis.fetch = fetchBeforeBenchmark; }
assert.equal(simulatedRequests, 18);

console.log(JSON.stringify({
  kind: 'synthetic-local-benchmark', members: members.length, roles: roles.length, concurrentVisitors: 1000,
  indexMs, searchMs, groupMs, readsMs, fanoutMs, upstreamReads: reads, upstreamListeners: listeners,
  requestContention: { simulatedReadMs, queuedProfiles: 8, fifoAccessMs, priorityAccessMs, simulatedRequests },
}, null, 2));
