import { expect, test } from '@playwright/test';

/**
 * The V1 happy path, driven through the real UI end to end:
 * sign up → onboarding (workspace, AI memory, sender) → CSV import →
 * AI-drafted campaign → enroll → send → reply → classified in the inbox →
 * dashboard reflects it.
 */
test('signup to classified reply, through the UI', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@test.local`;
  const leads = [
    ['ana', 'Ana'],
    ['ben', 'Ben'],
    ['cara', 'Cara'],
  ].map(([u, name]) => ({ email: `${u}-${stamp}@lead.local`, name }));

  // ── sign up ─────────────────────────────────────────────────────────
  await page.goto('/signup');
  await page.getByPlaceholder('Aman').fill('E2E Admin');
  await page.getByPlaceholder('Acme Outreach').fill('E2E Workspace');
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.getByPlaceholder('At least 8 characters').fill('e2e-pass-12345');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // new admins land in the onboarding wizard
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText('Set up your workspace.')).toBeVisible();

  // ── onboarding ──────────────────────────────────────────────────────
  const next = () =>
    page.getByRole('button', { name: 'Continue', exact: true }).click();

  await next(); // workspace (name prefilled)
  await page
    .getByPlaceholder(/We help B2B agencies/)
    .fill('We run AI-assisted outbound for B2B agencies.');
  await next(); // AI memory

  await expect(page.getByText('Connect a sender.')).toBeVisible();
  await page.getByRole('button', { name: 'Add sender' }).click();
  await page.getByPlaceholder('From name').fill('E2E Rep');
  await page.getByPlaceholder('from@domain.com').fill(`rep-${stamp}@sender.local`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`rep-${stamp}@sender.local`)).toBeVisible();
  await next(); // sender
  await expect(page.getByText('Check your domain.')).toBeVisible();
  await next(); // domain

  await expect(page.getByText("You're set up.")).toBeVisible();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText('Start here')).toBeVisible();

  // ── import leads ────────────────────────────────────────────────────
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const csv = ['email,firstName', ...leads.map((l) => `${l.email},${l.name}`)].join('\n');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Imported\s+3/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(leads[0].email)).toBeVisible();

  // ── AI-drafted campaign ─────────────────────────────────────────────
  await page.goto('/campaigns');
  await page.getByRole('button', { name: 'AI draft' }).click();
  await page.getByPlaceholder(/^Goal/).fill('Book intro calls with agency founders');
  await page.getByRole('button', { name: 'Generate' }).click();
  const create = page.getByRole('button', { name: 'Create draft campaign' });
  await expect(create).toBeVisible();
  await page.getByPlaceholder('Campaign name').fill('E2E Campaign');
  await create.click();

  await page.getByRole('button', { name: /Enroll & activate/ }).click();
  await expect(page.getByText(/Enrolled 3 lead/)).toBeVisible();

  // ── send (scheduler is off in e2e; process due sends from the UI) ──
  await page.getByRole('button', { name: 'Run due sends' }).click();
  await expect(page.getByText(/Processed: 3 sent/)).toBeVisible();

  // ── a lead replies ──────────────────────────────────────────────────
  await page.goto('/inbox');
  await page.getByRole('button', { name: 'Test reply' }).click();
  await page.getByPlaceholder('Lead email').fill(leads[0].email);
  await page.getByPlaceholder('Reply text').fill("Sounds great — let's talk Tuesday.");
  await page.getByRole('button', { name: 'Inject reply' }).click();

  // threaded + classified (mock classifier → Interested)
  const row = page.getByText(leads[0].email).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText('Interested').first()).toBeVisible();
  await expect(page.getByText("Sounds great — let's talk Tuesday.").first()).toBeVisible();

  // ── dashboard reflects the run ──────────────────────────────────────
  await page.goto('/dashboard');
  await expect(page.getByText('3 in the last 7 days', { exact: true })).toBeVisible(); // emails sent
  await expect(page.getByText('33.3%')).toBeVisible(); // 1 reply / 3 sent
  await expect(page.getByText(/Ana\s+email replied/)).toBeVisible();
});
