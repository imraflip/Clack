import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const screenshots = '.internal/qa-screenshots';
const primary = '#primary-btn';
const hint = '#hint-banner';
const toast = '#toast-banner';
const victory = '#victory-overlay';
const help = '#help-overlay';

const viewports = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];

const gameTest = test.extend({
  page: async ({ page, baseURL }, use) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(message.text());
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.origin !== baseURL) {
        failures.push(`External request ${url.href}`);
      }
    });
    await use(page);
    expect(failures).toEqual([]);
  },
});

async function openGame(page: Page): Promise<void> {
  // Drive the real animation callback in 50 ms increments (six sim ticks per frame).
  // The marble never advances while Playwright is waiting on input or screenshots.
  await page.addInitScript(() => {
    let now = 1000;
    let nextId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    performance.now = () => now;
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    };
    window.cancelAnimationFrame = (id) => { callbacks.delete(id); };

    const advance = (count: number, until?: string): void => {
      for (let i = 0; i < count && !(until && document.querySelector(until)); i++) {
        now += 50;
        const frame = [...callbacks.values()];
        callbacks.clear();
        for (const callback of frame) callback(now);
      }
    };
    Object.defineProperty(window, 'advanceClackFrames', { value: advance });
  });
  await page.goto('/game.html');
  await expect(page.locator('#canvas-wrap canvas')).toBeVisible();
}

async function advance(page: Page, frames: number, until?: string): Promise<void> {
  await page.evaluate(({ frames, until }) => {
    const advanceFrames: unknown = Reflect.get(window, 'advanceClackFrames');
    if (typeof advanceFrames !== 'function') throw new Error('Frame clock unavailable');
    const canvas = document.querySelector('#canvas-wrap canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing WebGL canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL context unavailable');
    // Batch simulation between assertions without rasterizing intermediate SwiftShader frames.
    // renderedFrame() takes an unmodified frame from the same renderer for each observed state.
    gl.enable(gl.RASTERIZER_DISCARD);
    try {
      advanceFrames(frames, until);
    } finally {
      gl.disable(gl.RASTERIZER_DISCARD);
    }
  }, { frames, until });
}

async function renderedFrame(page: Page): Promise<string[]> {
  const colors = await page.locator('#canvas-wrap canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing WebGL canvas');
    const advanceFrames: unknown = Reflect.get(window, 'advanceClackFrames');
    if (typeof advanceFrames !== 'function') throw new Error('Frame clock unavailable');
    advanceFrames(1);

    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) throw new Error('WebGL context unavailable');
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const samples: string[] = [];
    for (let row = 1; row < 12; row++) {
      for (let col = 1; col < 12; col++) {
        const offset = (Math.floor(row * height / 12) * width + Math.floor(col * width / 12)) * 4;
        samples.push(pixels.subarray(offset, offset + 4).join(','));
      }
    }
    return samples;
  });
  expect(new Set(colors).size).toBeGreaterThan(20);
  return colors;
}

async function screenshot(page: Page, state: string): Promise<void> {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: `${screenshots}/phase2-${state}.png` });
}

async function expectViewportFit(page: Page, viewport: { width: number; height: number }): Promise<void> {
  const layout = await page.evaluate(() => {
    const visible = (element: Element): boolean => element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible' && Number(getComputedStyle(element).opacity) > 0;
    const groups = [...document.querySelectorAll('.hud-left, .hud-right, #hint-banner, #primary-btn')]
      .filter((el) => !el.closest('[inert]') && visible(el));
    const overlaps: string[] = [];
    groups.forEach((group, index) => {
      const a = group.getBoundingClientRect();
      for (const other of groups.slice(index + 1)) {
        const b = other.getBoundingClientRect();
        if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) {
          overlaps.push(`${group.id || group.className} / ${other.id || other.className}`);
        }
      }
    });
    const buttons = [...document.querySelectorAll('button')]
      .filter((el) => !el.closest('[inert]') && visible(el))
      .map((el) => {
        const biomeStrip = el.closest('#biome-bar');
        const initialScroll = biomeStrip?.scrollLeft ?? 0;
        // The prototype's biome strip scrolls horizontally on phones.
        // Check each target after scrolling it into view, then restore the strip for the capture.
        if (biomeStrip) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const { left, top, right, bottom, width, height } = el.getBoundingClientRect();
        const clip = biomeStrip?.getBoundingClientRect();
        if (biomeStrip) biomeStrip.scrollLeft = initialScroll;
        return { id: el.id || el.textContent, width, height, left, top, right, bottom, clip };
      });
    return {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      overlaps,
      buttons,
    };
  });

  expect({ width: layout.width, height: layout.height }).toEqual(viewport);
  expect(layout.overlaps).toEqual([]);
  expect(layout.buttons.length).toBeGreaterThan(0);
  for (const button of layout.buttons) {
    expect(button.width, button.id).toBeGreaterThanOrEqual(44);
    expect(button.height, button.id).toBeGreaterThanOrEqual(44);
    expect(button.left, button.id).toBeGreaterThanOrEqual(Math.max(0, button.clip?.left ?? 0));
    expect(button.right, button.id).toBeLessThanOrEqual(Math.min(viewport.width, button.clip?.right ?? viewport.width));
    expect(button.top, button.id).toBeGreaterThanOrEqual(0);
    expect(button.bottom, button.id).toBeLessThanOrEqual(viewport.height);
  }
}

async function expectHelpFit(page: Page, viewport: { width: number; height: number }): Promise<void> {
  const card = await page.locator('.help-card').evaluate((el) => {
    const { left, top, right, bottom } = el.getBoundingClientRect();
    return {
      left, top, right, bottom,
      overflowY: el.scrollHeight - el.clientHeight,
      overflowX: el.scrollWidth - el.clientWidth,
      clipped: [...el.querySelectorAll('*')].filter((child) => {
        const r = child.getBoundingClientRect();
        return r.width > 0 && (r.left < left - 0.5 || r.right > right + 0.5 || r.top < top - 0.5 || r.bottom > bottom + 0.5);
      }).length,
    };
  });
  expect(card.left).toBeGreaterThanOrEqual(0);
  expect(card.top).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(viewport.width);
  expect(card.bottom).toBeLessThanOrEqual(viewport.height);
  expect(card.overflowY).toBeLessThanOrEqual(0);
  expect(card.overflowX).toBeLessThanOrEqual(0);
  expect(card.clipped).toBe(0);
}

async function expectHelpClosed(page: Page): Promise<void> {
  await expect(page.locator(help)).not.toHaveClass(/open/);
  await expect(page.locator(help)).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator(help)).toHaveAttribute('inert');
  await expect(page.locator('#hud')).not.toHaveAttribute('inert');
  await expect(page.locator('#hud')).not.toHaveAttribute('aria-hidden');
  await expect(page.locator('#btn-help')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#btn-help')).toBeFocused();
}

async function openHelp(page: Page): Promise<void> {
  await page.locator('#btn-help').click();
  const dialog = page.getByRole('dialog', { name: 'How to play' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#hud')).toHaveAttribute('inert');
  await expect(page.locator('#hud')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#btn-help')).toHaveAttribute('aria-expanded', 'true');
}

for (const viewport of viewports) {
  gameTest(`plays Cedar to the bell with fitted controls at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page);
    const desktopCapture = viewport.width === 1280;
    const mobileCapture = viewport.width === 375;
    const button = page.locator(primary);
    const banner = page.locator(hint);
    const hudLeft = page.locator('.hud-left');

    await renderedFrame(page);
    await expectViewportFit(page, viewport);
    if (desktopCapture) await screenshot(page, 'desktop-ready');
    if (mobileCapture) await screenshot(page, 'mobile-ready');

    // Idle: the help button sits in the Restart slot, Restart stays hidden until rolling.
    const helpBtn = page.locator('#btn-help');
    await expect(helpBtn).toBeVisible();
    await expect(page.locator('#btn-restart')).toBeHidden();
    const helpBox = await helpBtn.boundingBox();
    expect(helpBox?.width).toBeGreaterThanOrEqual(44);
    expect(helpBox?.height).toBeGreaterThanOrEqual(44);

    // Opt-in guide: modal isolation, Tab trap, three ways to close, focus back on #btn-help.
    await openHelp(page);
    await expect(page.locator('.help-card')).toBeFocused();
    await expectHelpFit(page, viewport);
    await expectViewportFit(page, viewport);
    await renderedFrame(page);
    if (desktopCapture) await screenshot(page, 'desktop-help');
    if (mobileCapture) await screenshot(page, 'mobile-help');
    const close = page.locator('#btn-help-close');
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      await expect(close).toBeFocused();
    }
    // Gameplay keys are swallowed behind the guide.
    await page.locator('.help-card').focus();
    for (const key of ['Space', 'Enter', 'r', '2']) await page.keyboard.press(key);
    await expect(page.locator(help)).toHaveClass(/open/);
    // #hud is inert + aria-hidden here, so read the label directly rather than the a11y tree.
    await expect(button).toHaveAttribute('aria-label', 'Launch marble');
    await expect(page.locator('body')).not.toHaveClass(/is-rolling/);
    await expect(page.locator('#hud-day')).toHaveText('DAY 1');
    await close.click();
    await expectHelpClosed(page);

    await openHelp(page);
    await page.keyboard.press('Escape');
    await expectHelpClosed(page);

    await openHelp(page);
    await page.mouse.click(4, viewport.height - 4);
    await expectHelpClosed(page);
    await expect(button).toHaveAccessibleName('Launch marble');
    await expect(page.locator('body')).not.toHaveClass(/is-rolling/);

    await page.getByRole('tab', { name: '1 Cedar' }).focus();
    // A trusted pointerdown launches before release; release must not also clack.
    await button.hover();
    await page.mouse.down();
    await expect(page.locator('body')).toHaveClass(/is-rolling/);
    await page.mouse.up();
    await expect(page.locator('#hud-clacks')).toHaveText('0');
    await expect(hudLeft).toHaveAttribute('inert');
    await expect(hudLeft).toHaveAttribute('aria-hidden', 'true');
    await expect(hudLeft).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#biome-bar')).toHaveAttribute('inert');
    await expect(page.locator('#btn-restart')).toBeVisible();
    // Rolling swaps Restart into the exact Help slot: no layout jump, no overlap.
    await expect(helpBtn).toBeHidden();
    expect(await page.locator('#btn-restart').boundingBox()).toEqual(helpBox);

    await advance(page, 48);
    await renderedFrame(page);
    await expect(banner).toHaveClass(/visible/);
    await expect(banner).toHaveText('Tap or press Space to flip every gate');
    // The hint is a live region. Keeping it visible must not rewrite it each sim tick.
    await banner.evaluate((el) => {
      new MutationObserver(() => { el.setAttribute('data-live-region-churn', 'true'); })
        .observe(el, { childList: true, characterData: true, subtree: true });
    });
    await renderedFrame(page);
    await expect(banner).not.toHaveAttribute('data-live-region-churn', 'true');
    await expect(banner).toHaveCSS('opacity', '1');
    await expectViewportFit(page, viewport);
    if (desktopCapture) await screenshot(page, 'desktop-rolling-hint');
    if (mobileCapture) await screenshot(page, 'mobile-rolling');

    await expect(button).toHaveAccessibleName(/position A/);
    await button.evaluate((el) => {
      window.addEventListener('keydown', () => {
        el.setAttribute('data-pressed-on-keydown', String(el.classList.contains('pressed')));
      }, { once: true });
    });
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('data-pressed-on-keydown', 'true');
    await expect(button).toHaveAccessibleName(/position B/);
    await expect(banner).not.toHaveClass(/visible/);
    await expect(page.locator('#hud-clacks')).toHaveText('1');
    await advance(page, 137);
    await button.click();
    await expect(button).toHaveAccessibleName(/position A/);
    await expect(page.locator('#hud-clacks')).toHaveText('2');

    const submit = page.waitForResponse((response) =>
      response.url().endsWith('/api/run') && response.request().method() === 'POST'
    );
    await advance(page, 170, 'body:not(.is-rolling)');
    const response = await submit;
    expect(response.status()).toBe(200);
    const payload: unknown = response.request().postDataJSON();
    expect(payload).toEqual({ day: 1, clackTicks: [300, 1122], endTick: expect.any(Number) });
    await expect(page.locator('.key-slot.collected')).toHaveCount(3);
    const dialog = page.getByRole('dialog', { name: 'Bell Rung' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#victory-rating')).toHaveText('Clean Clack');
    await expect(dialog.locator('#v-clacks-label')).toHaveText('Clacks');
    await expect(dialog.locator('#v-clacks')).toHaveText('2');
    await expect(dialog.locator('#v-par-label')).toHaveText('Par');
    await expect(dialog.locator('#v-par')).toHaveText('2');
    await expect(page.locator('#hud')).toHaveAttribute('inert');
    await expect(page.locator('#hud')).toHaveAttribute('aria-hidden', 'true');
    await expect(dialog.locator('.victory-card')).toBeFocused();
    await renderedFrame(page);
    await expect(dialog).toHaveCSS('opacity', '1');
    await expectViewportFit(page, viewport);
    if (desktopCapture) await screenshot(page, 'desktop-victory');

    if (desktopCapture) {
      await page.evaluate(() => {
        let requests = 0;
        const denied = new DOMException('Denied', 'NotAllowedError');
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: () => {
              requests += 1;
              document.body.dataset.copyRequests = String(requests);
              if (requests === 1) return Promise.reject(denied);
              return new Promise<void>((_resolve, reject) => {
                window.addEventListener('deny-test-clipboard', () => reject(denied), { once: true });
              });
            },
          },
        });
      });
      await page.keyboard.press('Tab');
      const copy = page.locator('#btn-copy-result');
      await expect(copy).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog.getByRole('status')).toHaveText('Could not access clipboard');
      await expect(copy).toBeFocused();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#btn-next')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(copy).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('body')).toHaveAttribute('data-copy-requests', '2');
      await page.keyboard.press('Tab');
      await expect(page.locator('#btn-replay')).toBeFocused();
      await page.keyboard.press('Space');
      await expect(dialog).toBeHidden();
      await expect(page.locator('#hud')).not.toHaveAttribute('inert');
      await expect(page.locator('#hud-day')).toHaveText('DAY 1');
      await expect(button).toHaveAccessibleName('Launch marble');
      await expect(button).toBeFocused();
      await page.evaluate(() => window.dispatchEvent(new Event('deny-test-clipboard')));
      await expect(page.locator(toast)).not.toHaveClass(/visible/);
    }
  });
}

gameTest('separates drag, captured pointer release, tap and focused keyboard shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  const button = page.locator(primary);
  const mute = page.locator('#btn-mute');
  await mute.focus();
  const initialMute = await mute.getAttribute('aria-pressed');
  await page.keyboard.press('Space');
  await expect(mute).toHaveAttribute('aria-pressed', initialMute === 'true' ? 'false' : 'true');
  await page.keyboard.press('Enter');
  await expect(mute).toHaveAttribute('aria-pressed', initialMute ?? 'false');
  await expect(button).toHaveAccessibleName('Launch marble');

  const centered = await renderedFrame(page);
  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(410, 250);
  await page.mouse.up();
  await expect(button).toHaveAccessibleName('Launch marble');
  expect(await renderedFrame(page)).not.toEqual(centered);
  await page.keyboard.press('c');
  expect(await renderedFrame(page)).toEqual(centered);

  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(290, 280);
  await page.mouse.up();
  expect(await renderedFrame(page)).not.toEqual(centered);
  await page.keyboard.press('0');
  expect(await renderedFrame(page)).toEqual(centered);

  const canvas = page.locator('#canvas-wrap');
  const pointer = { pointerId: 41, pointerType: 'touch', clientX: 320, clientY: 240, bubbles: true };
  await canvas.dispatchEvent('pointerdown', pointer);
  await canvas.dispatchEvent('pointerup', { ...pointer, clientX: 332 });
  await expect(button).toHaveAccessibleName('Launch marble');

  await page.mouse.move(320, 240);
  await page.mouse.down();
  await page.mouse.move(328, 240);
  await page.mouse.up();
  await expect(button).toHaveAccessibleName(/position A/);
  await page.mouse.click(320, 240);
  await expect(page.locator('#hud-clacks')).toHaveText('1');

  const canceled = await page.evaluate(() => [
    { key: 'r', ctrlKey: true },
    { key: 'r', metaKey: true },
    { key: 'c', ctrlKey: true },
  ].map((chord) => !window.dispatchEvent(new KeyboardEvent('keydown', { ...chord, cancelable: true }))));
  expect(canceled).toEqual([false, false, false]);
  await expect(page.locator('#hud-clacks')).toHaveText('1');
  await page.locator('#btn-restart').focus();
  await page.keyboard.press('r');
  await expect(button).toHaveAccessibleName('Launch marble');
  await expect(page.locator('#btn-restart')).not.toBeFocused();
  await renderedFrame(page);
});

async function failOnDay4Trapdoor(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await advance(page, 2);
  await page.keyboard.press('Space');
  await expect(page.locator('#hud-clacks')).toHaveText('1');
  await advance(page, 230, '#primary-btn.is-retry');
}

// RESET_DELAY_TICKS is 120 (1.0s). Hold well past it, in both sim time and wall-clock toast time.
async function expectHeldOnRetry(page: Page): Promise<void> {
  const button = page.locator(primary);
  await expect(button).toHaveClass(/is-retry/);
  await advance(page, 40); // 240 ticks = 2.0s of sim time
  await page.waitForTimeout(2000); // past every auto-dismiss toast duration
  await advance(page, 1);
  await expect(button).toHaveClass(/is-retry/);
  await expect(button).toHaveText('Tap to Retry');
  await expect(button).toHaveAccessibleName('Retry island immediately');
  await expect(page.locator(toast)).toHaveClass(/visible/);
  await expect(page.locator(toast)).toHaveText('Fell into the trapdoor');
  await expect(page.locator('#hud-clacks')).toHaveText('1');
  await expect(page.locator('#btn-help')).toBeVisible();
}

async function expectFreshLaunch(page: Page): Promise<void> {
  await expect(page.locator(primary)).toHaveAccessibleName('Launch marble');
  await expect(page.locator(primary)).not.toHaveClass(/is-retry/);
  await expect(page.locator(toast)).not.toHaveClass(/visible/);
  await expect(page.locator('#hud-clacks')).toHaveText('0');
  await expect(page.locator('body')).not.toHaveClass(/is-rolling/);
  // The retry press must not also launch: the run waits in Launch for the next deliberate press.
  await advance(page, 10);
  await expect(page.locator(primary)).toHaveAccessibleName('Launch marble');
}

gameTest('holds a trapdoor fall on Tap to Retry until Space or R', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await openGame(page);
  await page.keyboard.press('4');
  await expect(page.locator('#hud-day')).toHaveText('DAY 4');

  await failOnDay4Trapdoor(page);
  await expectHeldOnRetry(page);
  await page.keyboard.press('Space');
  await expectFreshLaunch(page);

  await failOnDay4Trapdoor(page);
  await expectHeldOnRetry(page);
  await page.keyboard.press('r');
  await expectFreshLaunch(page);
  await renderedFrame(page);
});

for (const reducedMotion of ['no-preference', 'reduce'] satisfies Array<'no-preference' | 'reduce'>) {
  gameTest(`can immediately retry a trapdoor fall with motion set to ${reducedMotion}`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await page.emulateMedia({ reducedMotion });
    await openGame(page);
    const button = page.locator(primary);
    await page.keyboard.press('4');
    await expect(page.locator('#hud-day')).toHaveText('DAY 4');
    await renderedFrame(page);

    await page.keyboard.press('Enter');
    await advance(page, 2);
    await page.keyboard.press('Space');
    await expect(page.locator('#hud-clacks')).toHaveText('1');
    if (reducedMotion === 'reduce') {
      for (const selector of [primary, '.hud-left', toast, victory]) {
        const duration = await page.locator(selector).evaluate((element) =>
          Math.max(...getComputedStyle(element).transitionDuration.split(',').map((value) => parseFloat(value)))
        );
        expect(duration, selector).toBeLessThan(0.01);
      }
    }

    await advance(page, 230, '#primary-btn.is-retry');
    await expectHeldOnRetry(page);
    await renderedFrame(page);
    await button.click();
    await expect(button).toHaveAccessibleName('Launch marble');
    await expect(page.locator(toast)).not.toHaveClass(/visible/);
    await expect(page.locator('#hud-clacks')).toHaveText('0');
    await expect(page.locator('.key-slot.collected')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/is-rolling/);
    await renderedFrame(page);
  });
}
