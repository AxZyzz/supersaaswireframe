import { execSync } from 'child_process';
import path from 'path';
import { expect, test } from '@playwright/test';

/**
 * Insights (T06): open the page on the seeded demo, see sentences with counts
 * and ranges that call themselves exploratory, switch to plain replies and see
 * the Pune example with its confounding hint, and look at the send-time grid.
 * The seed is idempotent and writes straight to the local database.
 */
test.beforeAll(() => {
  execSync('npm run seed:experiment -w apps/api', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
  });
});

test('Insights: plain sentences, honest wording, confounding hint, send-time grid', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill('review-demo@supersaas.local');
  await page.getByPlaceholder('••••••••').fill('review-demo-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // the sidebar's Review opens Insights, with the second tab beside it
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page).toHaveURL(/\/review\/insights/);
  await expect(page.getByRole('link', { name: 'Replies to confirm' })).toBeVisible();

  // look at the 400-company demo campaign
  await page.getByLabel('Campaign').selectOption({ label: 'Insights demo: clinic outreach' });
  // wait for the filtered numbers: 394 of the 400 demo companies were reached
  await expect(page.getByText(/394/).first()).toBeVisible();
  const headlines = page.getByRole('region', { name: 'Headline insights' });
  await expect(headlines).toContainText('companies), range');
  await expect(headlines).toContainText('Observed among contacted companies');
  await expect(headlines).toContainText('Test it before acting');
  await expect(headlines.getByRole('button', { name: 'Test next batch' }).first()).toBeDisabled();

  // the fit-score warning (stars are random in the demo)
  await expect(page.getByText("Our fit score isn't predicting replies")).toBeVisible();

  // the Pune example: a big reply effect, mostly because Pune companies were hiring
  await page.getByRole('button', { name: 'Replies', exact: true }).click();
  await expect(headlines).toContainText('Most replies come from Pune');
  await expect(headlines).toContainText('Most of these were also hiring');
  await expect(headlines).toContainText('Compare within trigger before deciding.');

  // sections: unknown stays visible; a factor with no leader says so
  await expect(page.getByRole('button', { name: /City/ })).toBeVisible();
  await expect(page.getByText('Not enough data yet').first()).toBeVisible();

  // send time: varied sends, so the day x hour grid is shown, in recipient time
  const sendTime = page.getByRole('region', { name: 'Best time to send' });
  await expect(sendTime).toContainText('Reply rate by day and time of day');
  await expect(sendTime).toContainText("each company's timezone");
  await expect(sendTime.locator('tbody tr')).toHaveCount(7);
  await sendTime.screenshot({ path: 'test-results/insights-sendtime.png' });
  await page
    .getByRole('button', { name: /City/ })
    .locator('xpath=ancestor::section')
    .screenshot({ path: 'test-results/insights-city.png' });
  await page.screenshot({ path: 'test-results/insights.png', fullPage: true });
});
