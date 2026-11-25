import { execSync } from 'child_process';
import path from 'path';
import { expect, test } from '@playwright/test';

/**
 * Review actions (T11): on a fresh seeded workspace whose test already has a
 * winner, pause the weaker version, resume it, then draft, preview and approve
 * a challenger. The seed makes a new workspace every run, so this repeats.
 */
test('Review actions: pause, resume, then approve a challenger as a new test', async ({
  page,
}) => {
  const out = execSync('npm run seed:review-actions -w apps/api --silent', {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
  });
  const seeded = JSON.parse(out.trim().split('\n').pop() as string) as {
    email: string;
    password: string;
    campaign: string;
  };

  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(seeded.email);
  await page.getByPlaceholder('••••••••').fill(seeded.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto('/campaigns');
  await page.getByText(seeded.campaign).first().click();
  await page.getByRole('tab', { name: 'Review' }).click();
  await expect(page.getByText('Winner found')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Apply to next search' })).toHaveAttribute(
    'href',
    '/review/insights',
  );

  // pause the weaker version: the dialog says exactly what changes
  await page.getByRole('button', { name: 'Pause A', exact: true }).click();
  const pause = page.getByRole('dialog', { name: 'Pause version A' });
  await expect(pause).toContainText('stops being used for new companies');
  await expect(pause).toContainText('40 companies already on A keep it');
  await pause.getByLabel(/Why\?/).fill('A is clearly behind B');
  await pause.getByRole('button', { name: 'Pause A', exact: true }).click();

  const history = page.getByRole('list', { name: 'Action history' });
  await expect(history).toContainText('Paused version A');
  await expect(history).toContainText('A is clearly behind B');
  await expect(page.getByRole('button', { name: 'Pause A', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/review-actions-paused.png', fullPage: true });

  // resume it
  await page.getByRole('button', { name: 'Resume A' }).click();
  await page
    .getByRole('dialog', { name: 'Resume version A' })
    .getByRole('button', { name: 'Resume A' })
    .click();
  await expect(history).toContainText('Resumed version A');
  await expect(page.getByRole('button', { name: 'Resume A' })).toHaveCount(0);

  // challenger: draft, pick, preview, approve (the button waits for the preview)
  await page.getByRole('button', { name: 'Review a challenger' }).click();
  const drawer = page.getByRole('dialog', { name: 'Review a challenger' });
  await expect(drawer.getByRole('radio')).toHaveCount(3);
  const approve = drawer.getByRole('button', { name: 'Approve challenger' });
  await expect(approve).toBeDisabled();
  await drawer.getByRole('radio').first().check();
  await expect(drawer.getByTestId('challenger-preview-subject')).toBeVisible();
  await expect(approve).toBeEnabled();
  await page.screenshot({ path: 'test-results/review-actions-challenger.png', fullPage: true });
  await approve.click();

  // the new test is running: its review starts empty, and the history keeps the record
  await expect(page.getByText('A new test is running.')).toBeVisible();
  await expect(history).toContainText('Approved challenger');
  await expect(page.getByText('Keep collecting')).toBeVisible();
  await page.screenshot({ path: 'test-results/review-actions-new-test.png', fullPage: true });
});
