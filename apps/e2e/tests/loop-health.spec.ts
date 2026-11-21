import { execSync } from 'child_process';
import path from 'path';
import { expect, Page, test } from '@playwright/test';

/**
 * Loop health (T13): the strip under the Review tabs says "OK" on a sound
 * workspace and turns red, with a plain sentence, when an action is stuck.
 * Each seed makes a fresh workspace, so this repeats.
 */
const root = path.resolve(__dirname, '../../..');

const seed = (arg = '') => {
  const out = execSync(
    `npm run seed:review-actions -w apps/api --silent -- ${arg}`,
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return JSON.parse(out.trim().split('\n').pop() as string) as {
    email: string;
    password: string;
  };
};

const login = async (page: Page, who: { email: string; password: string }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(who.email);
  await page.getByPlaceholder('••••••••').fill(who.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
};

test('Loop health is OK on a sound workspace', async ({ page }) => {
  await login(page, seed());
  await page.goto('/review/insights');
  const strip = page.getByRole('region', { name: 'Loop health' });
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute('data-status', 'ok');
  await expect(strip).toContainText('Loop health: OK');
  await expect(strip).toContainText('Outcome coverage: 100%');
  await expect(strip).toContainText('Split: as planned');
  await expect(strip).toContainText('Stuck actions: 0');
  await page.screenshot({
    path: 'test-results/loop-health-ok.png',
    fullPage: true,
  });
});

test('Loop health turns red and says what is stuck', async ({ page }) => {
  await login(page, seed('stuck'));
  await page.goto('/review/outcomes'); // the strip is on every Review page
  const strip = page.getByRole('region', { name: 'Loop health' });
  await expect(strip).toHaveAttribute('data-status', 'bad');
  await expect(strip).toContainText('Loop health: needs attention');
  await expect(
    strip.locator('[data-tone="bad"]').filter({ hasText: 'Stuck actions: 1' }),
  ).toBeVisible();
  await expect(
    strip.getByRole('list', { name: 'Loop health problems' }),
  ).toContainText('1 review action is stuck');
  await page.screenshot({
    path: 'test-results/loop-health-bad.png',
    fullPage: true,
  });
});
