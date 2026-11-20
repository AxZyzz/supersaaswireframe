import { execSync } from 'child_process';
import path from 'path';
import { expect, test } from '@playwright/test';

/**
 * Review (T05): open the Review tab of a seeded running experiment, see the
 * numbers and checks, run a simulation and see the unmistakable banner.
 * The seed is idempotent and writes straight to the local database.
 */
test.beforeAll(() => {
  execSync('npm run seed:experiment -w apps/api', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
  });
});

test('Review tab: real results, then a labelled simulation', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill('review-demo@supersaas.local');
  await page.getByPlaceholder('••••••••').fill('review-demo-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  // wait for the login to finish before navigating away from it
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/campaigns');
  await page.getByText('Review demo: clinic follow-up').first().click();
  await page.getByRole('tab', { name: 'Review' }).click();

  // goal strip + variant table with real numbers
  await expect(page.getByText(/Goal: confirmed qualified replies within 14 days/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Confirmed qualified' })).toBeVisible();
  await expect(page.locator('tr', { hasText: '(control)' })).toBeVisible();
  // one row per version
  await expect(
    page.getByRole('heading', { name: 'Versions' }).locator('..').locator('tbody tr'),
  ).toHaveCount(2);

  // the checks list and the exploratory slices are there, and the buttons wait for T11/T12
  await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible();
  await expect(page.getByText('Exploratory: not a decision')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply to next search' })).toBeDisabled();
  await expect(page.getByText('SIMULATED DATA, not your results')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/review-real.png', fullPage: true });

  // simulation: banner, then back to real results
  await page.getByLabel('Try simulation').selectOption({ label: 'A clear winner' });
  const banner = page.getByRole('alert').filter({ hasText: 'SIMULATED DATA, not your results' });
  await expect(banner).toBeVisible();
  await expect(page.getByText('Winner found')).toBeVisible();
  await page.screenshot({ path: 'test-results/review-simulated.png', fullPage: true });

  await page.getByRole('button', { name: 'Back to real results' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText(/Revision \d+ · computed/)).toBeVisible();
});
