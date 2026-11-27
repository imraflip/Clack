import { context, reddit } from '@devvit/web/server';
import { getIslandByDay, ISLANDS } from '../../shared/levels';
import { del, get, hasDevvitContext, hGet, hSet, postMetaKey, schedPostedKey, set, setIfAbsent } from './kv';

const MS_PER_DAY = 86_400_000;
/** UTC midnight of CLACK Day 1. */
const CLACK_EPOCH_UTC_MS = Date.UTC(2026, 10, 27);
const PENDING_LOCK = 'pending';

/** 1-based UTC day counter since launch (never below 1). */
export function getActiveUtcDay(nowMs: number = Date.now()): number {
  return Math.max(1, Math.floor((nowMs - CLACK_EPOCH_UTC_MS) / MS_PER_DAY) + 1);
}

/** Maps a UTC day counter onto the daily catalogue, cycling once every island has aired. */
export function resolveCatalogueDay(utcDay: number): number {
  const count = ISLANDS.length;
  return (((utcDay - 1) % count) + count) % count + 1;
}

/** Reads the catalogue day bound to the current post, or null when unbound / outside Devvit. */
export async function readBoundPostDay(): Promise<number | null> {
  if (!hasDevvitContext()) return null;
  const { postId } = context;
  if (!postId) return null;
  const raw = await hGet(postMetaKey(postId), 'day');
  const day = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(day) && getIslandByDay(day) ? day : null;
}

export type CreatedPost = { readonly postId: string; readonly day: number };

async function submitPostForDay(day: number): Promise<string> {
  const level = getIslandByDay(day);
  if (!level) throw new RangeError(`Unknown Clack day ${day}`);

  const post = await reddit.submitCustomPost({ title: `CLACK Day ${day} · ${level.name}` });
  return post.id;
}

async function bindPostDay(postId: string, day: number, utcDay: number): Promise<void> {
  await hSet(postMetaKey(postId), {
    day: String(day),
    createdUtcDay: String(utcDay),
  });
}

/** Publishes a custom post for a catalogue day and binds postId -> day in Redis. */
export async function createPostForDay(
  day: number,
  utcDay: number = getActiveUtcDay()
): Promise<CreatedPost> {
  const postId = await submitPostForDay(day);
  await bindPostDay(postId, day, utcDay);
  return { postId, day };
}

/** Publishes the catalogue day that is active for the current UTC day. */
export async function createDailyPost(nowMs: number = Date.now()): Promise<CreatedPost> {
  const utcDay = getActiveUtcDay(nowMs);
  return await createPostForDay(resolveCatalogueDay(utcDay), utcDay);
}

export type ScheduledPostResult = {
  readonly created: boolean;
  readonly postId: string | null;
  readonly day: number;
  readonly utcDay: number;
};

/**
 * Idempotent per-UTC-day daily drop. Duplicate scheduler fires (or an install
 * on the same UTC day) never create a second post; a failed submit releases
 * the lock so a retry can succeed.
 */
export async function ensureScheduledDailyPost(nowMs: number = Date.now()): Promise<ScheduledPostResult> {
  const utcDay = getActiveUtcDay(nowMs);
  const day = resolveCatalogueDay(utcDay);
  const lockKey = schedPostedKey(utcDay);

  if (!(await setIfAbsent(lockKey, PENDING_LOCK))) {
    const existing = await get(lockKey);
    const postId = existing && existing !== PENDING_LOCK ? existing : null;
    if (postId && (await hGet(postMetaKey(postId), 'day')) !== String(day)) {
      await bindPostDay(postId, day, utcDay);
    }
    return { created: false, postId, day, utcDay };
  }

  let postId: string;
  try {
    postId = await submitPostForDay(day);
  } catch (error) {
    await del(lockKey);
    throw error;
  }
  // Once Reddit returns a post ID, retain the lock. Retries can repair the
  // binding after the ID is saved, and a failed ID save must never republish.
  await set(lockKey, postId);
  await bindPostDay(postId, day, utcDay);
  return { created: true, postId, day, utcDay };
}
