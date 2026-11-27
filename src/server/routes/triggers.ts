import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const { postId, day } = await createDailyPost();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Clack Day ${day} post ${postId} created in r/${context.subredditName}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating Clack post on install: ${String(error)}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create Clack post' }, 400);
  }
});
