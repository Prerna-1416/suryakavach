import { test, expect } from '@playwright/test';

/* The 3D hero is a lazily-fetched chunk on purpose — it is ~900KB of
   three.js/R3F that phones must never pay for (see src/lib/responsive.ts and
   the mobile specs). So this assertion now waits on a network-delivered
   module graph, and on a cold dev server shared with the parallel mobile
   projects that can take longer than the suite's 5s default. The wait is
   raised here rather than globally so every other assertion keeps its teeth. */
const SCENE_CHUNK_TIMEOUT = 15_000;

test.describe('SURYAKAVACH Operator Console', () => {
  test('loads the WebGL landing hero with all nav links visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeAttached({ timeout: SCENE_CHUNK_TIMEOUT });
    await expect(page.getByRole('heading', { level: 1, name: 'SURYAKAVACH' })).toBeVisible();
    for (const item of ['Home', 'Live', 'Forecast', 'Impact', 'Replay', 'About']) {
      await expect(page.getByRole('link', { name: item, exact: true })).toBeVisible();
    }
  });

  test('hero renders the 3D scene canvas with the scroll cue overlay', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: SCENE_CHUNK_TIMEOUT });
    await expect(page.getByText('Scroll to Explore')).toBeVisible();
  });

  test('navigate to Live console', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await expect(page).toHaveURL(/\/live/);
    await expect(page.getByRole('link', { name: 'Flare Catalogue →' })).toBeVisible();
  });

  test('navigate to Forecast screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Forecast', exact: true }).click();
    await expect(page).toHaveURL(/\/forecast/);
    await expect(page.getByRole('heading', { name: '5 · 10 · 20 · 40 minute outlook' })).toBeVisible();
  });

  test('navigate to Impact screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Impact', exact: true }).click();
    await expect(page).toHaveURL(/\/impact/);
    await expect(page.getByRole('heading', { name: 'Radiation impact index' })).toBeVisible();
  });

  test('navigate to About screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about/);
    await expect(page.getByRole('heading', { level: 1, name: 'About SURYAKAVACH' })).toBeVisible();
  });

  test('navigate to Catalogue screen', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByRole('link', { name: 'Flare Catalogue →' }).click();
    await expect(page).toHaveURL(/\/catalogue/);
    await expect(page.getByRole('heading', { name: 'Event classification' })).toBeVisible();
  });

  test('deep links: catalogue route loads directly', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Event classification' })).toBeVisible();
  });

  test('deep links: catalogue class filter is in the URL', async ({ page }) => {
    await page.goto('/catalogue?class=M');
    await expect(page.getByRole('heading', { name: 'Event classification' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'M-CLASS' })).toHaveAttribute('aria-current', 'true');
  });

  test('back and forward move between screens', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByRole('link', { name: 'Impact', exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(/\/live/);
    await page.goForward();
    await expect(page).toHaveURL(/\/impact/);
  });

  test('skip-to-content link works', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeVisible();
  });

  test('ReplayBar is visible on console screens', async ({ page }) => {
    await page.goto('/live');
    await expect(page.getByRole('toolbar', { name: 'Replay controls' })).toBeVisible();
    await page.goto('/catalogue');
    await expect(page.getByRole('toolbar', { name: 'Replay controls' })).toBeVisible();
  });

  test('export CSV button is present in Catalogue', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('button', { name: 'Export catalogue as CSV' })).toBeVisible();
  });
});