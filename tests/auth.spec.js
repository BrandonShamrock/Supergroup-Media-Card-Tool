import { test, expect } from '@playwright/test';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'reviewer@example.test', aud: 'authenticated', role: 'authenticated' };
const token = () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, aud: 'authenticated' })}.test-signature`;
};
async function mockAuth(page, { reject = false, invalidSession = false } = {}) {
  await page.route('https://auth.example.test/auth/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) {
      return route.fulfill({ status: reject ? 400 : 200, json: reject ? { error: 'invalid_grant', msg: 'Invalid login credentials' } : { access_token: token(), refresh_token: 'test-refresh-only', expires_in: 3600, token_type: 'bearer', user } });
    }
    if (path.endsWith('/user')) return route.fulfill({ status: invalidSession ? 401 : 200, json: invalidSession ? { msg: 'Invalid token' } : user });
    return route.fulfill({ status: 204, body: '' });
  });
}
async function login(page) {
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('invented-test-password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}
test('requires sign-in, restores a verified session, preserves mock workflow and signs out', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/some/spa/path');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByText('Explore demo workspace')).toHaveCount(0);
  await login(page);
  await expect(page.getByRole('heading', { name: 'Your next campaign starts here.' })).toBeVisible();
  await expect(page.locator('.user-name')).toContainText(user.email);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your next campaign starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Vehicle stock 6', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('checkbox', { name: 'Select Toyota Fortuner 2.8 GD-6', exact: true }).check();
  await page.getByRole('button', { name: 'Preview selection' }).click();
  await expect(page.getByRole('heading', { name: 'Toyota Fortuner 2.8 GD-6' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
test('rejected credentials fail closed with a generic error', async ({ page }) => {
  await mockAuth(page, { reject: true });
  await page.goto('/'); await login(page);
  await expect(page.getByRole('alert')).toContainText('Unable to sign in');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});
test('unverifiable session never mounts dashboard content', async ({ page }) => {
  await mockAuth(page, { invalidSession: true });
  await page.goto('/'); await login(page);
  await expect(page.getByRole('alert')).toContainText('could not verify');
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
test('sign-out in another tab updates the current tab through auth state changes', async ({ page, context }) => {
  await mockAuth(page); await page.goto('/'); await login(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  const other = await context.newPage();
  await mockAuth(other); await other.goto('/');
  await expect(other.locator('.sidebar')).toBeVisible();
  await other.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
test('missing configuration blocks login and dashboard even on a nested path', async ({ page }) => {
  await page.goto('http://localhost:5176/nested/path');
  await expect(page.getByRole('alert')).toContainText('configure the Supabase URL and publishable key');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeDisabled();
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
test('network failure cannot open the dashboard', async ({ page }) => {
  await page.route('https://auth.example.test/**', route => route.abort());
  await page.goto('/'); await login(page);
  await expect(page.getByRole('alert')).toContainText('Unable');
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
test('restored invalid session fails closed after reload', async ({ page }) => {
  await mockAuth(page); await page.goto('/'); await login(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  await mockAuth(page, { invalidSession: true });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('could not verify');
  await expect(page.locator('.sidebar')).toHaveCount(0);
});
test('session verification shows a loading state without dashboard content', async ({ page }) => {
  await mockAuth(page); await page.goto('/'); await login(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/v1/user', async route => { await pending; await route.fulfill({ json: user }); });
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Checking your session…');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  release();
  await expect(page.locator('.sidebar')).toBeVisible();
});
