import { type Page } from '@playwright/test';

/**
 * Session authentication helpers for E2E specs.
 *
 * Most specs get their session from the `setup` project (auth.setup.ts), which
 * writes playwright/.auth/user.json and is applied via `storageState`. Use these
 * helpers only when a spec needs to authenticate as a *specific* user, or to
 * re-authenticate mid-test after a logout.
 *
 * `page.request` shares the browser context's cookie jar, so logging in through
 * it also authenticates subsequent `page.goto()` navigations.
 */

export interface LoginOptions {
  /** Attempts before giving up. Covers a server still coming up. Default 5. */
  retries?: number;
  /** Delay between attempts, ms. Default 1000. */
  retryDelayMs?: number;
}

/**
 * Returns true when the current context has an authenticated session.
 *
 * Probes /api/users/current rather than /api/user: the latter deliberately
 * returns 200 for anonymous callers (it issues a CSRF token for pre-auth
 * routes), so its status says nothing about whether we are logged in.
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get('/api/users/current');
    return res.ok();
  } catch {
    return false;
  }
}

/**
 * Log in as `email`, unless the context is already authenticated.
 *
 * Throws with the server's status and body on failure — an E2E run that
 * silently continues unauthenticated produces misleading downstream failures.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  options: LoginOptions = {},
): Promise<void> {
  const { retries = 5, retryDelayMs = 1000 } = options;

  if (await isAuthenticated(page)) return;

  let lastStatus: number | undefined;
  let lastBody = '';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // The login handler expects `username`, which carries the email address.
      const res = await page.request.post('/api/login', {
        data: { username: email, password },
      });

      if (res.ok()) return;

      lastStatus = res.status();
      lastBody = await res.text().catch(() => '');

      // Bad credentials will not fix themselves; only retry transient failures.
      if (res.status() === 401 || res.status() === 403) break;
    } catch (err: any) {
      lastBody = err?.message ?? String(err);
    }

    if (attempt < retries) await page.waitForTimeout(retryDelayMs);
  }

  throw new Error(
    `login(${email}) failed after ${retries} attempt(s): ` +
    `${lastStatus ?? 'no response'} ${lastBody}`.trim(),
  );
}

/** Drop the current session. Safe to call when already logged out. */
export async function logout(page: Page): Promise<void> {
  await page.request.post('/api/logout').catch(() => {});
}
