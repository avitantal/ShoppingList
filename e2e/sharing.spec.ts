import { test, expect } from '@playwright/test';
import { admin, ensureUser, purgeListsForUser } from './helpers/supabaseAdmin';

const A = { email: process.env.E2E_USER_A_EMAIL!, password: process.env.E2E_USER_A_PASSWORD! };
const B = { email: process.env.E2E_USER_B_EMAIL!, password: process.env.E2E_USER_B_PASSWORD! };

test.describe.serial('sharing + realtime', () => {
  let aId: string; let bId: string;

  test.beforeAll(async () => {
    aId = await ensureUser(A.email, A.password);
    bId = await ensureUser(B.email, B.password);
    await purgeListsForUser(aId);
    await purgeListsForUser(bId);
    // Seed A's default list directly. service_role has no auth.uid(),
    // so create_list (security definer, requires auth) can't be used here.
    await admin.from('shopping_lists').insert({ owner_id: aId, name: 'הרשימה שלי', is_default: true }).throwOnError();
  });

  test('A creates a list, shares with B, B sees it and edits in realtime', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // A signs in
    await pageA.goto('/');
    await pageA.getByText('e2e sign-in').click();
    await pageA.locator('input[name=email]').fill(A.email);
    await pageA.locator('input[name=password]').fill(A.password);
    await pageA.getByRole('button', { name: /Sign in \(e2e\)/ }).click();
    await expect(pageA.getByText('הרשימה שלי')).toBeVisible();

    // A adds an item
    await pageA.locator('input[placeholder="הוסף פריט..."]').fill('חלב 3%');
    await pageA.locator('input[placeholder="הוסף פריט..."]').press('Enter');
    await expect(pageA.getByText('חלב 3%')).toBeVisible();

    // A shares with B
    await pageA.getByRole('button', { name: 'שתף' }).click();
    await pageA.locator('input[type=email]').fill(B.email);
    await pageA.getByRole('button', { name: 'הזמן' }).click();
    await expect(pageA.getByText(B.email)).toBeVisible();
    await pageA.getByRole('button', { name: 'סגור' }).click();

    // B signs in — should see the shared list
    await pageB.goto('/');
    await pageB.getByText('e2e sign-in').click();
    await pageB.locator('input[name=email]').fill(B.email);
    await pageB.locator('input[name=password]').fill(B.password);
    await pageB.getByRole('button', { name: /Sign in \(e2e\)/ }).click();
    await pageB.getByRole('button', { name: 'פתח תפריט' }).click();
    await expect(pageB.getByText('ששותפו איתי')).toBeVisible();
    // B's own list reads "הרשימה שלי (ברירת מחדל)"; the shared one is just
    // "הרשימה שלי". exact:true disambiguates without relying on nth().
    await pageB.getByRole('button', { name: 'הרשימה שלי', exact: true }).click();

    await expect(pageB.getByText('חלב 3%')).toBeVisible();

    // B checks the item — A sees the change in real time
    await pageB.locator('input[type=checkbox]').first().check();
    await expect(pageA.locator('input[type=checkbox]').first()).toBeChecked({ timeout: 5_000 });
  });
});
