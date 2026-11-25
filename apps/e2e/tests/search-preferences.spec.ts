import { execSync } from 'child_process';
import path from 'path';
import { expect, test } from '@playwright/test';

/**
 * Search preferences (T12): from Insights, "Test next batch" -> preview ->
 * approve; Discover then shows the preference with its countdown and a run
 * that used it; withdrawing is instant. Works on the Review demo workspace.
 */
const root = path.resolve(__dirname, '../../..');
const run = (script: string) =>
  execSync(script, { cwd: root, stdio: 'inherit' });

test.beforeAll(() => {
  run('npm run seed:experiment -w apps/api');
  run('npm run seed:preference-demo -w apps/api -- reset');
});
test.afterAll(() => {
  run('npm run seed:preference-demo -w apps/api -- reset');
});

test('Insights -> approve a search preference -> Discover shows it -> withdraw', async ({
  page,
}) => {
  await page.goto('/login');
  await page
    .getByPlaceholder('you@company.com')
    .fill('review-demo@supersaas.local');
  await page.getByPlaceholder('••••••••').fill('review-demo-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // the demo offer has the clear Pune / hiring story
  await page.goto('/review/insights');
  // a preference belongs to one offer: choose the demo offer first
  await page
    .locator('select')
    .first()
    .selectOption({ label: 'Missed-call follow-up for clinics' });
  const headlines = page.getByRole('region', { name: 'Headline insights' });
  await expect(headlines).toBeVisible();
  const button = headlines
    .getByRole('button', { name: 'Test next batch' })
    .first();
  await expect(button).toBeVisible();
  await button.click();

  const dialog = page.getByRole('dialog', { name: 'Test next batch' });
  await expect(dialog.getByText('What changes')).toBeVisible();
  await expect(dialog).toContainText('up to 20%');
  await expect(dialog).toContainText('(14 days)');
  await expect(dialog).toContainText('What stays the same');
  await expect(dialog.getByTestId('preference-label')).toBeVisible();
  await page.screenshot({
    path: 'test-results/preference-preview.png',
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Approve preference' }).click();

  // Discover: the preference, its countdown, and the withdraw button
  await expect(page).toHaveURL(/\/discover/);
  const panel = page.getByRole('region', { name: 'Search profile' });
  await expect(panel).toContainText('Preference active');
  await expect(panel.getByTestId('preference-countdown')).toContainText(
    /13 days|14 days/,
  );
  await expect(
    panel.getByRole('list', { name: 'Preference history' }),
  ).toContainText('Approved');

  // a finished demo run that used it: the allocation line and the chip
  run('npm run seed:preference-demo -w apps/api -- run');
  await page.reload();
  await expect(page.getByTestId('allocation-line')).toContainText(
    '20% reserved for',
  );
  await expect(page.getByTestId('allocation-line')).toContainText(
    'found 1 of 2',
  );
  await expect(page.getByText('From preference').first()).toBeVisible();
  await page.screenshot({
    path: 'test-results/preference-discover.png',
    fullPage: true,
  });

  // withdraw: instant, history kept, back to the normal search
  await page
    .getByRole('region', { name: 'Search profile' })
    .getByRole('button', { name: 'Withdraw', exact: true })
    .click();
  await page.getByPlaceholder('Reason (optional)').fill('browser test');
  await page.getByRole('button', { name: 'Withdraw preference' }).click();
  await expect(
    page.getByRole('region', { name: 'Search profile' }),
  ).toContainText('Preference withdrawn');
  await expect(
    page.getByRole('list', { name: 'Preference history' }),
  ).toContainText('Withdrawn');
  await page.screenshot({
    path: 'test-results/preference-withdrawn.png',
    fullPage: true,
  });
});
