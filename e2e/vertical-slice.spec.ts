import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function observePage(page: Page): string[] {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:5174') {
      failures.push(`External request ${url.href}`);
    }
  });
  return failures;
}

async function frameColors(page: Page): Promise<number> {
  return page.locator('#canvas-wrap canvas').evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) return 0;
    const gl = element.getContext('webgl2');
    if (!gl || gl.isContextLost()) return 0;

    // Read the rendered board in the same frame, before Chromium clears the drawing buffer.
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => {
        const colors = new Set<string>();
        const width = gl.drawingBufferWidth;
        const height = gl.drawingBufferHeight;
        const frame = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        for (let row = 1; row < 12; row++) {
          for (let col = 1; col < 12; col++) {
            const x = Math.floor(width * col / 12);
            const y = Math.floor(height * row / 12);
            const offset = (y * width + x) * 4;
            if (frame[offset + 3] === 255) colors.add(frame.subarray(offset, offset + 3).join(','));
          }
        }
        resolve(colors.size);
      });
    });
  });
}

test('renders a lightweight splash and a live WebGL board and captures both', async ({ page }) => {
  const failures = observePage(page);
  const screenshots = '.internal/qa-screenshots';
  await mkdir(screenshots, { recursive: true });

  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    const webglRequests: string[] = [];
    Object.defineProperty(window, 'webglRequests', { value: webglRequests });
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind.includes('webgl')) webglRequests.push(kind);
      return Reflect.apply(getContext, this, [kind, ...args]);
    };
  });

  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/day') && response.ok()),
    page.goto('/splash.html'),
  ]);
  await expect(page.locator('#splash-subtitle')).not.toBeEmpty();
  await expect.poll(() =>
    page.locator('img').evaluate((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth)
  ).toBe(720);
  expect(await page.evaluate(() => Reflect.get(window, 'webglRequests'))).toEqual([]);
  await page.screenshot({ path: `${screenshots}/phase1-splash.png` });

  await page.getByRole('button', { name: 'Play Today' }).click();
  await expect(page).toHaveURL(/\/game\.html$/);
  await expect(page.locator('#canvas-wrap canvas')).toBeVisible();
  await expect.poll(() => frameColors(page), { timeout: 40_000 }).toBeGreaterThan(20);
  await page.screenshot({ path: `${screenshots}/phase1-board.png` });
  expect(failures).toEqual([]);
});

test('the embedded splash leaves wheel and touch input uncanceled and requests expansion on a trusted click', async ({ page }) => {
  const failures = observePage(page);
  await page.addInitScript(() => {
    if (window === parent) return;
    // Verify the effect is sent while the trusted click is still being dispatched.
    const messages: unknown[] = [];
    Object.defineProperty(window, 'effectsDuringClick', { value: messages });
    Object.defineProperty(window, 'devvit', {
      value: { entrypoints: { game: new URL('/game.html', document.URL).href } },
    });
    parent.postMessage = (data: unknown) => {
      if (window.event?.type === 'click' && window.event.isTrusted) messages.push(data);
    };
  });
  await page.route('**/test-feed', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><iframe title="Clack" src="/splash.html" style="display:block;width:100%;height:520px;border:0"></iframe><div style="height:1800px"></div>',
  }));
  await page.goto('/test-feed');
  const frame = page.frameLocator('iframe');
  const play = frame.getByRole('button', { name: 'Play Today' });
  await expect(frame.locator('#splash-subtitle')).not.toBeEmpty();

  const title = frame.locator('.splash-title');
  await title.evaluate((element) => {
    const record = (event: Event): void => queueMicrotask(() => {
      element.setAttribute(`data-${event.type}-prevented`, String(event.defaultPrevented));
    });
    window.addEventListener('wheel', record, { once: true });
    window.addEventListener('touchmove', record, { once: true });
  });
  await title.hover();
  await page.mouse.wheel(0, 180);
  await expect(title).toHaveAttribute('data-wheel-prevented', 'false');
  await title.dispatchEvent('touchmove', { bubbles: true, cancelable: true });
  await expect(title).toHaveAttribute('data-touchmove-prevented', 'false');
  await expect(title).toHaveCSS('touch-action', 'auto');

  await page.mouse.move(30, 650);
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await play.dispatchEvent('click');
  expect(await play.evaluate(() => Reflect.get(window, 'effectsDuringClick'))).toEqual([]);
  await play.click();
  expect(await play.evaluate(() => Reflect.get(window, 'effectsDuringClick'))).toEqual(
    expect.arrayContaining([expect.objectContaining({
      immersiveMode: expect.objectContaining({ entryUrl: 'http://127.0.0.1:5174/game.html' }),
    })])
  );
  expect(failures).toEqual([]);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  test(`fits both views at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const failures = observePage(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Keep the simulation and renderer idle while measuring control layout.
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });

    for (const [path, control] of [
      ['splash.html', '#splash-play-btn'],
      ['game.html', '#primary-btn'],
    ]) {
      await page.goto(`/${path}`);
      if (!control) throw new Error('Missing control selector');
      const button = page.locator(control);
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }))).toEqual(viewport);
    }
    await expect(page.locator('#canvas-wrap canvas')).toBeVisible();
    await page.locator('#primary-btn').press('Enter');
    await expect(page.locator('body')).toHaveClass(/is-rolling/);
    await expect(page.locator('#biome-bar')).toHaveAttribute('inert');
    expect(await page.locator('.hud-left').evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration)
    )).toBeLessThan(0.01);
    expect(failures).toEqual([]);
  });
}

test('keeps keyboard activation on the focused victory control', async ({ page }) => {
  const failures = observePage(page);
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await page.goto('/game.html');
  await expect(page.locator('#canvas-wrap canvas')).toBeVisible();

  const overlay = page.locator('#victory-overlay');
  await overlay.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Missing victory overlay');
    element.inert = false;
    element.setAttribute('aria-hidden', 'false');
    element.classList.add('open');
  });
  await page.locator('#btn-copy-result').press('Enter');
  await expect(overlay).toHaveClass(/open/);
  await page.locator('#btn-replay').press('Space');
  await expect(overlay).not.toHaveClass(/open/);
  expect(failures).toEqual([]);
});

test('keeps internal files out of the local Vite preview', async ({ request }) => {
  const url = `/@fs${resolve('.internal/CURRENT_BRIEF.md')}`;
  const response = await request.get(url);
  expect(response.status()).toBe(403);
});

test('recovers from WebGL context restoration and cleans up on final page hide', async ({ page }) => {
  const failures = observePage(page);
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto('/game.html');
  await expect.poll(() => frameColors(page), { timeout: 40_000 }).toBeGreaterThan(20);
  const canvas = page.locator('#canvas-wrap canvas');
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Missing WebGL canvas');
    const extension = element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Missing WEBGL_lose_context');
    element.addEventListener('webglcontextlost', () => {
      element.dataset.contextLost = 'true';
      setTimeout(() => extension.restoreContext(), 0);
    }, { once: true });
    extension.loseContext();
  });
  await expect(canvas).toHaveAttribute('data-context-lost', 'true');
  await expect.poll(() => frameColors(page), { timeout: 40_000 }).toBeGreaterThan(20);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(canvas).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(canvas).toHaveCount(0);
  await page.locator('#primary-btn').click();
  await expect(page.locator('body')).not.toHaveClass(/is-rolling/);
  expect(failures).toEqual([]);
});

test('returns real renderer allocation counts to baseline across 20 consecutive island swaps', async ({ page }) => {
  const failures = observePage(page);
  await page.setViewportSize({ width: 480, height: 360 });
  await page.goto('/splash.html');
  const levelsModule = `/@fs${resolve('src/shared/levels/index.ts')}`;
  const memory = await page.evaluate(async (levelsModule) => {
    const sceneModule = '/scene/index.ts';
    const { createStage, createCameraController, buildIslandDiorama }: typeof import('../src/client/scene') =
      await import(sceneModule);
    const { ISLANDS }: typeof import('../src/shared/levels') = await import(levelsModule);
    const stage = createStage(document.body);
    const camera = createCameraController(480, 360).camera;
    for (let i = 0; i < 40; i++) stage.recordFrameMs(35);
    const sample = () => ({ ...stage.renderer.info.memory });
    const render = () => stage.renderer.render(stage.scene, camera);
    try {
      const swapIsland = (level: (typeof ISLANDS)[number]) => {
        const island = buildIslandDiorama(stage.scene, level);
        stage.applyBiomePalette(level.palette);
        island.pieces.triggerBellRing(false);
        render();
        const active = sample();
        island.dispose();
        render();
        return { active, after: sample() };
      };

      // Let Three.js allocate its renderer-owned lighting lookup and transmission target.
      for (const level of ISLANDS) swapIsland(level);
      const baseline = sample();
      const swaps = [];
      for (let i = 0; i < 20; i++) {
        const level = ISLANDS[i % ISLANDS.length];
        if (!level) throw new Error('Missing island');
        swaps.push(swapIsland(level));
      }
      return { baseline, swaps };
    } finally {
      stage.dispose();
    }
  }, levelsModule);
  for (const [index, { active, after }] of memory.swaps.entries()) {
    expect(active.geometries).toBeGreaterThan(memory.baseline.geometries);
    expect(active.textures).toBeGreaterThan(memory.baseline.textures);
    expect(active).toEqual(memory.swaps[index % 5]?.active);
    expect(after).toEqual(memory.baseline);
  }
  expect(failures).toEqual([]);
});
