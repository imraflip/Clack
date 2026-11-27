import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const { postId } = await createDailyPost();
    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${postId}`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating Clack post: ${String(error)}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Clack post' }, 400);
  }
});
