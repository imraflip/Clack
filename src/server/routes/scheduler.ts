import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { ensureScheduledDailyPost } from '../core/post';

export const scheduler = new Hono();

scheduler.post('/daily-post', async (c) => {
  try {
    const result = await ensureScheduledDailyPost();
    console.log(
      result.created
        ? `Clack UTC day ${result.utcDay}: created Day ${result.day} post ${result.postId ?? ''}`
        : `Clack UTC day ${result.utcDay}: daily post already scheduled`
    );
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    console.error(`Error creating scheduled Clack post: ${String(error)}`);
    return c.json<TaskResponse>({}, 500);
  }
});
