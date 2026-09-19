import { test, expect } from '@playwright/test';
import { stubBackend, overflowReport } from './fixtures';

/**
 * Breakpoint sweep.
 *
 * Runs in the desktop `chromium` project and drives its own viewport, so one
 * browser covers the whole 320 → 1440 range. Every route is checked at every
 * required width for horizontal overflow; the second block asserts which
 * layout each breakpoint is supposed to get.
 */

const ROUTES = ['/', '/live', '/forecast', '/impact', '/replay', '/catalogue', '/alerts', '/about'];
const WIDTHS = [320, 375, 390, 768, 1024, 1440];
/** Routes whose first paint mounts Plotly. */
const CHART_ROUTES = ['/live', '/forecast', '/replay'];

test.beforeEach(async ({ page }) => {
  await stubBackend(page);
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 768 ? 640 : 900 } });

    for (const path of ROUTES) {
      test(`${path} does not scroll sideways`, async ({ page }) => {
        await page.goto(path);
        await page.waitForSelector('#main-content');
        if (CHART_ROUTES.includes(path)) {
          await page.waitForSelector('.js-plotly-plot', { timeout: 15_000 });
        }
        // Let Plotly finish its own resize pass and any layout settle.
        await page.waitForTimeout(300);

        const report = await overflowReport(page);
        expect(report.offenders, `${path} @ ${width}px`).toEqual([]);
        expect(report.documentScrollWidth).toBeLessThanOrEqual(report.viewportWidth + 1);
      });
    }
  });
}

test.describe('layout per breakpoint', () => {
  const phone = { width: 320, height: 640 };
  const tablet = { width: 768, height: 1024 };
  const desktop = { width: 1024, height: 900 };

  test('320px is the phone console', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/live');

    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
    await expect(
      page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: 'Live', exact: true }),
    ).toHaveCount(0);
    // The compact transport is what a phone gets; the settings panel (and its
    // full-width date row) is one tap away, and the desktop ids are gone.
    await expect(page.getByRole('button', { name: 'Show replay settings' })).toBeVisible();
    await expect(page.locator('#replay-date')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show replay settings' }).click();
    await expect(page.locator('#replay-date-m')).toBeVisible();
    await expect(page.locator('#replay-scrubber-m')).toBeVisible();

    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('link', { name: /Impact severity/ })).toBeVisible();

    await page.goto('/catalogue');
    await expect(page.getByRole('list', { name: 'Flare catalogue' })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
  });

  test('768px is the tablet console — inline nav, real table, desktop transport', async ({ page }) => {
    await page.setViewportSize(tablet);
    await page.goto('/live');

    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveCount(0);
    await expect(
      page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: 'Live', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#replay-date')).toHaveCount(1);
    await expect(page.locator('#replay-date-m')).toHaveCount(0);
    // The priority strip is a phone affordance; the full gauge covers tablets.
    await expect(page.getByRole('link', { name: /Impact severity/ })).toHaveCount(0);

    await page.goto('/catalogue');
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Flare catalogue' })).toHaveCount(0);
  });

  test('1024px is the desktop console', async ({ page }) => {
    await page.setViewportSize(desktop);
    await page.goto('/live');

    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveCount(0);
    const inlineNav = page.locator('nav[aria-label="Main navigation"]');
    for (const label of ['Home', 'Live', 'Forecast', 'Impact', 'Replay', 'About']) {
      await expect(inlineNav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // Telemetry chrome is staged by width: mode + UTC at 1024, the date and
    // ISRO credit only from 1280, where they fit without squeezing the routes.
    // (A role query, not getByText — display:none must count as absent.)
    await expect(page.locator('#replay-date')).toHaveCount(1);
    await expect(inlineNav.getByRole('link', { name: /Aditya-L1/ })).toHaveCount(0);
  });

  test('1440px restores the full readout in the bar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/live');

    const inlineNav = page.locator('nav[aria-label="Main navigation"]');
    await expect(inlineNav.getByText('Live Data')).toBeVisible();
    await expect(inlineNav.getByRole('link', { name: /Aditya-L1/ })).toBeVisible();
  });

  test('every text input and control stays at least 44px tall on a phone', async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto('/catalogue');
    await expect(page.getByRole('list', { name: 'Flare catalogue' })).toBeVisible();

    const targets = page.locator('.sk-touch');
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);

    const small: string[] = [];
    for (let i = 0; i < count; i++) {
      const el = targets.nth(i);
      if (!(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (box && box.height < 44) {
        small.push(`${(await el.getAttribute('aria-label')) ?? (await el.innerText()).slice(0, 24)} = ${Math.round(box.height)}px`);
      }
    }
    expect(small, 'controls under the 44px touch minimum').toEqual([]);
  });
});

test.describe('heavy visuals are earned, not assumed', () => {
  for (const width of [320, 375, 390, 768]) {
    test(`no WebGL hero at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'SURYAKAVACH' })).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
      // The static backdrop is what the visitor actually gets.
      await expect(page.locator('.sk-space-bg')).toBeVisible();
    });
  }

  test('the WebGL hero still runs on a desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeAttached();
  });

  test('three.js is never fetched on a phone', async ({ page }) => {
    const heavy: string[] = [];
    page.on('request', (r) => {
      if (/three|SolarScene/i.test(r.url())) heavy.push(r.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForTimeout(1200);
    expect(heavy).toEqual([]);
  });
});
