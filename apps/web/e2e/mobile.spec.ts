import { test, expect } from '@playwright/test';
import { stubBackend, overflowReport } from './fixtures';

/**
 * Phone-viewport operator console.
 *
 * Runs in the mobile-pixel5 (393×851) and mobile-320 (320×568) projects only —
 * see playwright.config.ts. Every spec is served by the stubbed API, so these
 * pass with the Python service up or down.
 */

test.beforeEach(async ({ page }) => {
  await stubBackend(page);
});

const MENU = '#sk-mobile-nav';

test.describe('navigation menu', () => {
  test('replaces the inline nav with a hamburger below 768px', async ({ page }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'sk-mobile-nav');

    // display:none takes the desktop links out of the accessibility tree, so a
    // phone user gets exactly one of each route — never a duplicate.
    const inlineNav = page.locator('nav[aria-label="Main navigation"]');
    await expect(inlineNav.getByRole('link', { name: 'Live', exact: true })).toHaveCount(0);
  });

  test('keeps the feed state readable without the drawer', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByRole('img', { name: /Telemetry (connected|disconnected), mode (Live|Replay)/ })).toBeVisible();
  });

  test('opens and closes on route selection', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await trigger.click();

    await expect(page.locator(MENU)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByRole('link', { name: 'Live', exact: true })).toHaveCount(1);

    await page.locator(MENU).getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page).toHaveURL(/\/live$/);
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
  });

  test('closes on Escape and returns focus to the trigger', async ({ page }) => {
    await page.goto('/live');
    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await trigger.click();
    await expect(page.locator(MENU)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('closes on an outside tap', async ({ page }) => {
    await page.goto('/live');
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    await expect(page.locator(MENU)).toBeVisible();

    const vp = page.viewportSize();
    await page.mouse.click(8, (vp?.height ?? 568) - 8);
    await expect(page.locator(MENU)).toHaveCount(0);
  });

  test('gives every route row a 44px-tall target', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const menu = page.locator(MENU);
    await expect(menu).toBeVisible();

    for (const label of ['Home', 'Live', 'Forecast', 'Impact', 'Replay', 'About']) {
      const box = await menu.getByRole('link', { name: label, exact: true }).boundingBox();
      expect(box, `${label} row missing`).not.toBeNull();
      expect(box!.height, `${label} row`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('Live console priority stack', () => {
  test('orders state, severity, latest alert and the live trace top-down', async ({ page }) => {
    await page.goto('/live');

    const banner = page.getByRole('status'); // NowcastBanner
    const severity = page.getByRole('link', { name: /Impact severity/ });
    const alertFeed = page.getByRole('log', { name: 'Alert feed' });
    const chart = page.locator('.js-plotly-plot').first();

    await expect(banner).toBeVisible();
    await expect(severity).toBeVisible();
    await expect(alertFeed).toBeVisible();
    await expect(chart).toBeVisible();

    // (1) nowcast state, (2) main flare class + impact severity, (3) latest
    // alert, (5) the simplified live trace — in that document order.
    const boxes = await Promise.all(
      [banner, severity, alertFeed, chart].map((l) => l.boundingBox()),
    );
    const tops = boxes.map((b) => b!.y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));

    await expect(banner).toContainText('RISING');
    await expect(banner).toContainText('GOES class');
    await expect(banner).toContainText('X6.3');
    await expect(severity).toContainText('R4');
    await expect(alertFeed).toContainText('HF blackout expected');
  });

  test('ships only the newest alert in the stack, with the full feed a tap away', async ({ page }) => {
    await page.goto('/live');
    const alertFeed = page.getByRole('log', { name: 'Alert feed' });
    await expect(alertFeed).toBeVisible();
    await expect(alertFeed.getByText('flare peak')).toBeVisible();
    await expect(alertFeed.getByText('flare onset')).toHaveCount(0);
    await expect(page.getByText('latest 1 of 2')).toBeVisible();
  });

  test('renders the telemetry chart at phone height with no legend', async ({ page }) => {
    await page.goto('/live');
    const chart = page.locator('.js-plotly-plot').first();
    await expect(chart).toBeVisible();

    const box = await chart.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(280);
    expect(box!.height).toBeLessThanOrEqual(340);

    // The chart is too narrow for a legend; an inline series key replaces it.
    await expect(page.locator('.js-plotly-plot .legend')).toHaveCount(0);
    await expect(page.getByText('SoLEXS SXR')).toBeVisible();
    await expect(page.getByText('HEL1OS HXR')).toBeVisible();
  });

  test('pushes forecast and impact detail below the live trace', async ({ page }) => {
    await page.goto('/live');
    const chart = page.locator('.js-plotly-plot').first();
    await expect(chart).toBeVisible();
    const chartTop = (await chart.boundingBox())!.y;

    // Scoped to the phone list and the gauge's own label: the desktop table and
    // the catalogue sheet's "Impact subscores" are elsewhere in the DOM, and a
    // bare text query would resolve to more than one node.
    const horizons = page.getByRole('list', { name: 'Forecast horizons' });
    expect((await horizons.getByText('+40 min').boundingBox())!.y).toBeGreaterThan(chartTop);
    expect((await page.getByText('Fusion subscores').boundingBox())!.y).toBeGreaterThan(chartTop);
  });

  test('does not scroll sideways', async ({ page }) => {
    await page.goto('/live');
    await expect(page.locator('.js-plotly-plot').first()).toBeVisible();
    const report = await overflowReport(page);
    expect(report.offenders).toEqual([]);
  });
});

test.describe('replay controls', () => {
  test('keeps the transport visible with 44px targets and a slim bar', async ({ page }) => {
    await page.goto('/live');
    const bar = page.getByRole('toolbar', { name: 'Replay controls' });
    await expect(bar).toBeVisible();

    const play = bar.getByRole('button', { name: 'Play replay' });
    const box = await play.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Collapsed by default so a short phone screen keeps its telemetry.
    const vp = page.viewportSize()!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.height).toBeLessThan(vp.height * 0.25);
    await expect(page.locator('#replay-mobile-panel')).toHaveCount(0);
  });

  test('opens the settings panel upward with date, speed presets and the scrubber', async ({ page }) => {
    await page.goto('/replay');
    const bar = page.getByRole('toolbar', { name: 'Replay controls' });
    await bar.getByRole('button', { name: 'Show replay settings' }).click();

    await expect(bar.getByRole('button', { name: 'Hide replay settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('#replay-date-m')).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Replay speed 60 times' })).toBeVisible();

    const scrubber = page.locator('#replay-scrubber-m');
    await expect(scrubber).toBeVisible();
    await expect(scrubber).toHaveAttribute('min', '0');
    await expect(scrubber).toHaveAttribute('max', '1439');

    // The panel opens upward and every control stays inside the viewport.
    const vp = page.viewportSize()!;
    const panel = (await page.locator('#replay-mobile-panel').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(-1);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(vp.width + 1);

    const track = (await scrubber.boundingBox())!;
    expect(track.x).toBeGreaterThanOrEqual(-1);
    expect(track.x + track.width).toBeLessThanOrEqual(vp.width + 1);
  });

  test('the speed chip cycles presets through the API', async ({ page }) => {
    await page.goto('/live');
    const bar = page.getByRole('toolbar', { name: 'Replay controls' });
    const chip = bar.getByRole('button', { name: /Replay speed \d+ times — tap to change/ });
    await expect(chip).toHaveText('20×');

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/replay/control') && (r.postData() ?? '').includes('"speed"')),
      chip.click(),
    ]);
    expect(JSON.parse(request.postData() ?? '{}')).toEqual({ action: 'speed', speed: 60 });
    // The response is authoritative, so the chip follows the server.
    await expect(chip).toHaveText('60×');
  });

  test('commits a scrub once, on release', async ({ page }) => {
    await page.goto('/replay');
    const bar = page.getByRole('toolbar', { name: 'Replay controls' });
    await bar.getByRole('button', { name: 'Show replay settings' }).click();
    const scrubber = page.locator('#replay-scrubber-m');
    await expect(scrubber).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/replay/control') && (r.postData() ?? '').includes('"seek"')),
      (async () => {
        await scrubber.fill('720');
        await scrubber.evaluate((el) => (el as HTMLInputElement).blur());
      })(),
    ]);
    expect(JSON.parse(request.postData() ?? '{}')).toEqual({ action: 'seek', cursor: 720 });
    // The collapsed transport reads the store, not the drag position, so a
    // 12:00 there means the server cursor actually moved. (A tolerance for the
    // separator's whitespace; the panel's own clock matches too.)
    await expect(bar).toContainText(/12:00\s*\/\s*23:59/);
  });
});

test.describe('flare catalogue', () => {
  test('shows one card per event instead of the nine-column table', async ({ page }) => {
    await page.goto('/catalogue');

    const list = page.getByRole('list', { name: 'Flare catalogue' });
    await expect(list).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);

    const card = list.getByRole('link', { name: /FLR-001/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText('X6.3');
    await expect(card).toContainText('6.42');

    const box = (await card.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test('keeps every class filter and the CSV export reachable', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('list', { name: 'Flare catalogue' })).toBeVisible();

    for (const filter of ['ALL', 'X-CLASS', 'M-CLASS', 'C-CLASS', 'B-CLASS']) {
      await expect(page.getByRole('link', { name: filter })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Export catalogue as CSV' })).toBeVisible();
  });

  test('opens the detail as a bottom sheet and returns to the filtered list', async ({ page }) => {
    await page.goto('/catalogue?class=M');
    const card = page.getByRole('list', { name: 'Flare catalogue' }).getByRole('link', { name: /FLR-001/ });
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(/\/catalogue\/FLR-001\?class=M$/);
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(sheet).toContainText('Changepoint posterior');
    await expect(sheet).toContainText('Impact subscores');

    // The detail chart keeps the same mobile treatment as the console chart.
    const chart = sheet.locator('.js-plotly-plot');
    await expect(chart).toBeVisible();
    const chartBox = (await chart.boundingBox())!;
    expect(chartBox.height).toBeGreaterThan(200);
    expect(chartBox.height).toBeLessThan(300);
    expect(await overflowReport(page)).toMatchObject({ offenders: [] });

    await sheet.getByRole('button', { name: 'Close flare detail' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/catalogue\?class=M$/);
  });

  test('deep-links straight into the sheet', async ({ page }) => {
    await page.goto('/catalogue/FLR-001');
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('X6.3');
    await expect(sheet).toContainText('FLR-001');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/catalogue$/);
  });
});

test.describe('landing hero cost', () => {
  test('serves the CSS backdrop instead of WebGL on a phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'SURYAKAVACH' })).toBeVisible();
    // No canvas at all: three.js is never fetched, let alone rendered.
    await expect(page.locator('canvas')).toHaveCount(0);
    const report = await overflowReport(page);
    expect(report.offenders).toEqual([]);
  });
});
