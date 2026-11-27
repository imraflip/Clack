import { context, reddit, redis } from '@devvit/web/server';
import { getIslandByDay, ISLANDS } from '../../shared/levels';

const MS_PER_DAY = 86_400_000;
/** UTC midnight of CLACK Day 1. */
const CLACK_EPOCH_UTC_MS = Date.UTC(2026, 10, 27);

export function postMetaKey(postId: string): string {
  return `clack:v2:meta:post:${postId}`;
}

/** 1-based UTC day counter since launch (never below 1). */
export function getActiveUtcDay(nowMs: number = Date.now()): number {
  return Math.max(1, Math.floor((nowMs - CLACK_EPOCH_UTC_MS) / MS_PER_DAY) + 1);
}

/** Maps a UTC day counter onto the daily catalogue, cycling once every island has aired. */
export function resolveCatalogueDay(utcDay: number): number {
  const count = ISLANDS.length;
  return (((utcDay - 1) % count) + count) % count + 1;
}

/** True only while serving a real Devvit request (unit tests and local preview return false). */
export function hasDevvitContext(): boolean {
  try {
    return typeof context.subredditId === 'string';
  } catch {
    return false;
  }
}

/** Reads the catalogue day bound to the current post, or null when unbound / outside Devvit. */
export async function readBoundPostDay(): Promise<number | null> {
  if (!hasDevvitContext()) return null;
  const { postId } = context;
  if (!postId) return null;
  const raw = await redis.hGet(postMetaKey(postId), 'day');
  const day = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(day) && getIslandByDay(day) ? day : null;
}

export async function createDailyPost(): Promise<{ readonly postId: string; readonly day: number }> {
  const utcDay = getActiveUtcDay();
  const day = resolveCatalogueDay(utcDay);
  const level = getIslandByDay(day);
  const title = level ? `CLACK Day ${day} · ${level.name}` : 'CLACK Daily Marble Puzzle';

  const post = await reddit.submitCustomPost({ title });
  await redis.hSet(postMetaKey(post.id), {
    day: String(day),
    createdUtcDay: String(utcDay),
  });
  return { postId: post.id, day };
}
