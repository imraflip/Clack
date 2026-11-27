import { context, redis } from '@devvit/web/server';

// ---------------------------------------------------------------------------
// Canonical clack:v2 key schema
// ---------------------------------------------------------------------------

export function postMetaKey(postId: string): string {
  return `clack:v2:meta:post:${postId}`;
}

export function schedPostedKey(utcDay: number): string {
  return `clack:v2:sched:posted:${utcDay}`;
}

export function dayStatsKey(day: number): string {
  return `clack:v2:stats:day:${day}`;
}

export function dayLeaderboardKey(day: number): string {
  return `clack:v2:lb:day:${day}`;
}

export function userProfileKey(userId: string): string {
  return `clack:v2:user:${userId}:profile`;
}

export function userBestsKey(userId: string): string {
  return `clack:v2:user:${userId}:bests`;
}

/** True only while serving a real Devvit request (unit tests and local preview return false). */
export function hasDevvitContext(): boolean {
  try {
    return typeof context.subredditId === 'string';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback, used ONLY outside a Devvit request context. Inside
// Devvit every call goes straight to Redis so errors are never swallowed.
// ---------------------------------------------------------------------------

type FallbackEntry =
  | { readonly kind: 'string'; value: string }
  | { readonly kind: 'hash'; readonly fields: Map<string, string> }
  | { readonly kind: 'zset'; readonly scores: Map<string, number> };

const fallbackEntries = new Map<string, FallbackEntry>();
/** Per-key write counter backing optimistic WATCH semantics in the fallback. */
const fallbackVersions = new Map<string, number>();

function touch(key: string): void {
  fallbackVersions.set(key, (fallbackVersions.get(key) ?? 0) + 1);
}

function fallbackHash(key: string, create: boolean): Map<string, string> | null {
  const entry = fallbackEntries.get(key);
  if (entry?.kind === 'hash') return entry.fields;
  if (entry || !create) return null;
  const fields = new Map<string, string>();
  fallbackEntries.set(key, { kind: 'hash', fields });
  return fields;
}

function fallbackZset(key: string, create: boolean): Map<string, number> | null {
  const entry = fallbackEntries.get(key);
  if (entry?.kind === 'zset') return entry.scores;
  if (entry || !create) return null;
  const scores = new Map<string, number>();
  fallbackEntries.set(key, { kind: 'zset', scores });
  return scores;
}

function fallbackSet(key: string, value: string): void {
  fallbackEntries.set(key, { kind: 'string', value });
  touch(key);
}

function fallbackHSet(key: string, fields: Readonly<Record<string, string>>): number {
  const hash = fallbackHash(key, true);
  if (!hash) throw new Error(`WRONGTYPE ${key}`);
  let added = 0;
  for (const [field, value] of Object.entries(fields)) {
    if (!hash.has(field)) added++;
    hash.set(field, value);
  }
  touch(key);
  return added;
}

function fallbackHIncrBy(key: string, field: string, by: number): number {
  const hash = fallbackHash(key, true);
  if (!hash) throw new Error(`WRONGTYPE ${key}`);
  const current = Number.parseInt(hash.get(field) ?? '0', 10);
  const next = (Number.isSafeInteger(current) ? current : 0) + by;
  hash.set(field, String(next));
  touch(key);
  return next;
}

function fallbackZAdd(key: string, member: string, score: number): number {
  const zset = fallbackZset(key, true);
  if (!zset) throw new Error(`WRONGTYPE ${key}`);
  const added = zset.has(member) ? 0 : 1;
  zset.set(member, score);
  touch(key);
  return added;
}

/** Ascending by score, then lexicographically by member (Redis ZRANK order). */
function fallbackZRank(key: string, member: string): number | undefined {
  const zset = fallbackZset(key, false);
  const own = zset?.get(member);
  if (!zset || own === undefined) return undefined;
  let rank = 0;
  for (const [other, score] of zset) {
    if (score < own || (score === own && other < member)) rank++;
  }
  return rank;
}

/** Test-only reset of the in-memory fallback store. */
export function resetFallbackStore(): void {
  fallbackEntries.clear();
  fallbackVersions.clear();
}

// ---------------------------------------------------------------------------
// Typed operations
// ---------------------------------------------------------------------------

export async function get(key: string): Promise<string | undefined> {
  if (hasDevvitContext()) return await redis.get(key);
  const entry = fallbackEntries.get(key);
  return entry?.kind === 'string' ? entry.value : undefined;
}

export async function set(key: string, value: string): Promise<void> {
  if (hasDevvitContext()) {
    await redis.set(key, value);
    return;
  }
  fallbackSet(key, value);
}

/** SET key value NX — true only when this caller acquired the key. */
export async function setIfAbsent(key: string, value: string): Promise<boolean> {
  if (hasDevvitContext()) return (await redis.set(key, value, { nx: true })) === 'OK';
  if (fallbackEntries.has(key)) return false;
  fallbackSet(key, value);
  return true;
}

export async function del(key: string): Promise<void> {
  if (hasDevvitContext()) {
    await redis.del(key);
    return;
  }
  fallbackEntries.delete(key);
  touch(key);
}

export async function hGet(key: string, field: string): Promise<string | undefined> {
  if (hasDevvitContext()) return await redis.hGet(key, field);
  return fallbackHash(key, false)?.get(field);
}

export async function hSet(key: string, fields: Readonly<Record<string, string>>): Promise<void> {
  if (hasDevvitContext()) {
    await redis.hSet(key, { ...fields });
    return;
  }
  fallbackHSet(key, fields);
}

export async function hGetAll(key: string): Promise<Record<string, string>> {
  if (hasDevvitContext()) return await redis.hGetAll(key);
  return Object.fromEntries(fallbackHash(key, false) ?? []);
}

export async function hIncrBy(key: string, field: string, by: number): Promise<number> {
  if (hasDevvitContext()) return await redis.hIncrBy(key, field, by);
  return fallbackHIncrBy(key, field, by);
}

export async function zAdd(key: string, member: string, score: number): Promise<void> {
  if (hasDevvitContext()) {
    await redis.zAdd(key, { member, score });
    return;
  }
  fallbackZAdd(key, member, score);
}

export async function zRank(key: string, member: string): Promise<number | undefined> {
  if (hasDevvitContext()) return await redis.zRank(key, member);
  return fallbackZRank(key, member);
}

export async function zCard(key: string): Promise<number> {
  if (hasDevvitContext()) return await redis.zCard(key);
  return fallbackZset(key, false)?.size ?? 0;
}

export async function zScore(key: string, member: string): Promise<number | undefined> {
  if (hasDevvitContext()) return await redis.zScore(key, member);
  return fallbackZset(key, false)?.get(member);
}

// ---------------------------------------------------------------------------
// Optimistic transactions (WATCH / MULTI / EXEC)
// ---------------------------------------------------------------------------

export type KvTransaction = {
  readonly multi: () => Promise<void>;
  readonly hSet: (key: string, fields: Readonly<Record<string, string>>) => Promise<void>;
  readonly hIncrBy: (key: string, field: string, by: number) => Promise<void>;
  readonly zAdd: (key: string, member: string, score: number) => Promise<void>;
  /** Resolves true when the queued writes committed, false on a WATCH conflict. */
  readonly exec: () => Promise<boolean>;
  readonly discard: () => Promise<void>;
  readonly unwatch: () => Promise<void>;
};

function isCommitted(result: unknown): boolean {
  return Array.isArray(result) && result.length > 0;
}

function fallbackWatch(keys: readonly string[]): KvTransaction {
  const watched = new Map(keys.map((key) => [key, fallbackVersions.get(key) ?? 0]));
  const queued: Array<() => void> = [];
  return {
    multi: async () => {},
    hSet: async (key, fields) => {
      queued.push(() => fallbackHSet(key, fields));
    },
    hIncrBy: async (key, field, by) => {
      queued.push(() => fallbackHIncrBy(key, field, by));
    },
    zAdd: async (key, member, score) => {
      queued.push(() => fallbackZAdd(key, member, score));
    },
    exec: async () => {
      for (const [key, version] of watched) {
        if ((fallbackVersions.get(key) ?? 0) !== version) return false;
      }
      for (const run of queued) run();
      return queued.length > 0;
    },
    discard: async () => {
      queued.length = 0;
    },
    unwatch: async () => {
      watched.clear();
    },
  };
}

export async function watch(...keys: string[]): Promise<KvTransaction> {
  if (!hasDevvitContext()) return fallbackWatch(keys);
  const tx = await redis.watch(...keys);
  return {
    multi: async () => {
      await tx.multi();
    },
    hSet: async (key, fields) => {
      await tx.hSet(key, { ...fields });
    },
    hIncrBy: async (key, field, by) => {
      await tx.hIncrBy(key, field, by);
    },
    zAdd: async (key, member, score) => {
      await tx.zAdd(key, { member, score });
    },
    exec: async () => isCommitted(await tx.exec()),
    discard: async () => {
      await tx.discard();
    },
    unwatch: async () => {
      await tx.unwatch();
    },
  };
}
