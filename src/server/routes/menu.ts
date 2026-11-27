import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { parseDayQuery } from '../../shared/api';
import { getIslandByDay, ISLANDS } from '../../shared/levels';
import { createDailyPost, createPostForDay } from '../core/post';

export const menu = new Hono();

export const SPAWN_DAY_FORM_NAME = 'spawnDayForm';

function postUrl(postId: string): string {
  return `https://reddit.com/r/${context.subredditName}/comments/${postId}`;
}

/** Accepts the select value as `['3']`, `'3'`, or `3` — anything else is rejected. */
function readSubmittedDay(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const nested = Reflect.get(body, 'values');
  const source = typeof nested === 'object' && nested !== null && !Array.isArray(nested) ? nested : body;
  let raw: unknown = Reflect.get(source, 'day');
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return null;
    raw = raw[0];
  }
  let text: string | undefined;
  if (typeof raw === 'string') text = raw;
  else if (typeof raw === 'number' && Number.isSafeInteger(raw)) text = String(raw);
  const day = parseDayQuery(text);
  return day !== null && getIslandByDay(day) ? day : null;
}

menu.post('/post-create', async (c) => {
  try {
    const { postId } = await createDailyPost();
    return c.json<UiResponse>({ navigateTo: postUrl(postId) }, 200);
  } catch (error) {
    console.error(`Error creating Clack post: ${String(error)}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Clack post' }, 400);
  }
});

menu.post('/spawn-day', (c) => {
  return c.json<UiResponse>(
    {
      showForm: {
        name: SPAWN_DAY_FORM_NAME,
        form: {
          title: 'Spawn a Clack day',
          acceptLabel: 'Publish',
          fields: [
            {
              type: 'select',
              name: 'day',
              label: 'Island',
              required: true,
              options: ISLANDS.map((island) => ({
                label: `Day ${island.day} · ${island.name}`,
                value: String(island.day),
              })),
            },
          ],
        },
      },
    },
    200
  );
});

menu.post('/spawn-day-submit', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }
  const day = readSubmittedDay(body);
  if (day === null) {
    return c.json<UiResponse>({ showToast: 'Choose a valid Clack day' }, 400);
  }
  try {
    const { postId } = await createPostForDay(day);
    return c.json<UiResponse>({ navigateTo: postUrl(postId) }, 200);
  } catch (error) {
    console.error(`Error spawning Clack Day ${day}: ${String(error)}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Clack post' }, 400);
  }
});
