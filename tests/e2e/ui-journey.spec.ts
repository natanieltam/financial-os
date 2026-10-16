import { test, expect, type Page } from '@playwright/test'

/**
 * PRD §71 browser E2E: walks the real UI in headless Chromium — register,
 * land on dashboard, navigate every primary route, open the create flows, and
 * sign out. Financial mutations and their exact server behaviour are asserted
 * authoritatively by the Vitest suite; here we prove the UI renders, hydrates,
 * navigates, and drives those flows end-to-end in a browser.
 */

const stamp = Date.now()

async function expectHeading(page: Page, name: string) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

test('first visit without a session lands on the landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/welcome')
  await expectHeading(page, 'Your money, finally legible.')
  // menu choice: sign in or create account
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible()
  // light/dark toggle applies to <html> and persists across reload
  await expect(page.locator('html')).toHaveClass(/dark/)
  // re-click until the hydrated handler picks it up (SSR button exists before listeners attach)
  await expect(async () => {
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  }).toPass({ timeout: 10000 })
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('register, navigate all sections, open create flows, sign out', async ({ page }) => {
  // --- register (§71: register) ---
  await page.goto('/register')
  await expectHeading(page, 'Financial OS')
  await page.fill('#name', 'E2E User')
  await page.fill('#email', `e2e-${stamp}@example.com`)
  await page.fill('#password', 'e2e-password-123')
  await page.fill('#confirm', 'e2e-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()

  // --- land on dashboard (§71: dashboard) ---
  await expect(page).toHaveURL('/')
  await expectHeading(page, 'Dashboard')

  // --- transactions (§71: income / expense surface) ---
  await page.getByRole('link', { name: 'Transactions' }).click()
  await expect(page).toHaveURL('/transactions')
  await expectHeading(page, 'Transactions')
  // open the create flow (dialog / form appears)
  await page.getByRole('button', { name: 'New transaction' }).click()
  await expect(page.locator('form').getByRole('button', { name: 'Add transaction' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()

  // --- accounts (§71: account) ---
  await page.getByRole('link', { name: 'Accounts' }).click()
  await expect(page).toHaveURL('/accounts')
  await expectHeading(page, 'Accounts')
  await page.getByRole('button', { name: 'Add account' }).first().click()
  await expect(page.locator('form').getByRole('button', { name: 'Create' })).toBeVisible()

  // --- budgets (§71: budget) ---
  await page.getByRole('link', { name: 'Budgets' }).click()
  await expect(page).toHaveURL('/budgets')
  await expectHeading(page, 'Budgets')

  // --- goals (§71: goal) ---
  await page.getByRole('link', { name: 'Goals' }).click()
  await expect(page).toHaveURL('/goals')
  await expectHeading(page, 'Goals')

  // --- AI assistant (§71: AI transaction parsing) ---
  await page.getByRole('link', { name: 'Ask AI' }).click()
  await expect(page).toHaveURL('/ask')
  await expectHeading(page, 'Ask your finances')

  // --- reports + health render ---
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page).toHaveURL('/reports')
  await expectHeading(page, 'Reports')

  await page.getByRole('link', { name: 'Health' }).click()
  await expect(page).toHaveURL('/health')
  await expectHeading(page, 'Financial health')

  // --- sign out (§71: logout) → back to the landing page ---
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/welcome')
  await expectHeading(page, 'Your money, finally legible.')
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
})

test('an existing user can sign back in and reach the dashboard', async ({ page }) => {
  const email = `e2e-login-${Date.now()}@example.com`
  // create the account first (register opens a session server-side)
  await page.goto('/register')
  await page.fill('#name', 'Login User')
  await page.fill('#email', email)
  await page.fill('#password', 'e2e-login-pass-123')
  await page.fill('#confirm', 'e2e-login-pass-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  // sign out → landing page → sign back in with the same credentials
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/welcome')
  await page.getByRole('link', { name: 'Sign in' }).first().click()
  await expect(page).toHaveURL('/login')
  await page.fill('#email', email)
  await page.fill('#password', 'e2e-login-pass-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await expectHeading(page, 'Dashboard')
  // protected navigation still reachable after login
  await page.getByRole('link', { name: 'Transactions' }).click()
  await expectHeading(page, 'Transactions')
})
