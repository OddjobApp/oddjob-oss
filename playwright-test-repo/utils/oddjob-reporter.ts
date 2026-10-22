import { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Load parent .env file to get SESSION_SECRET and other configs
try {
  // Since we execute in the directory of playwright-test-repo, parent is ../.env
  const envPath = path.resolve(process.cwd(), '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        // Strip comments if present
        const commentIdx = value.indexOf('#');
        if (commentIdx !== -1) {
          value = value.substring(0, commentIdx).trim();
        }
        // Strip quotes
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = value.trim();
        }
      }
    });
    console.log('[OddjobReporter] Loaded environment from parent .env file.');
  }
} catch (e: any) {
  console.warn('[OddjobReporter] Failed to load parent .env file:', e.message);
}

class OddjobReporter implements Reporter {
  private apiBaseUrl: string;
  private datasetId: number;
  private apiToken: string;
  private internalToken: string;
  private failedTestsCount: number = 0;
  /** Signed-in session of the reporting account, created on first write. */
  private session: Promise<Record<string, string>> | null = null;

  constructor() {
    this.apiBaseUrl = process.env.ODDJOB_API_URL || 'http://localhost:5000/api';
    this.datasetId = parseInt(process.env.ODDJOB_BUG_DATASET_ID || '71'); // Fallback to 71 (Identified Bugs)
    this.apiToken = process.env.ODDJOB_API_TOKEN || '';
    // Dedicated internal-service token for local/dev reporting only. Do NOT reuse
    // SESSION_SECRET here — that is the session-signing secret and must never be handed
    // to a test tool. Prefer ODDJOB_API_TOKEN (a scoped credential) in real environments.
    this.internalToken = process.env.INTERNAL_API_SECRET || '';
  }

  /**
   * Sign in as the reporting account (ODDJOB_REPORTER_EMAIL / ODDJOB_REPORTER_PASSWORD,
   * else the TEST_USER_* the suite signs in with) and reuse its session cookie and CSRF
   * token. This is how production is reported to: the account belongs to the
   * organization that owns the incident dataset, so it can write there and nowhere else.
   */
  private async sessionHeaders(): Promise<Record<string, string> | null> {
    const email = process.env.ODDJOB_REPORTER_EMAIL || process.env.TEST_USER_EMAIL;
    const password = process.env.ODDJOB_REPORTER_PASSWORD || process.env.TEST_USER_PASSWORD;
    if (!email || !password || this.apiToken) return null;
    if (!this.session) {
      this.session = (async () => {
        const cookies = new Map<string, string>();
        const keep = (setCookie?: string[]) => (setCookie || []).forEach((c) => {
          const [pair] = c.split(';');
          const i = pair.indexOf('=');
          cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1));
        });
        const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        const csrf = async () => {
          const r = await axios.get(`${this.apiBaseUrl}/user`, { headers: { Cookie: cookieHeader() }, validateStatus: () => true });
          keep(r.headers['set-cookie']);
          return r.data?.csrfToken as string;
        };
        const login = await axios.post(`${this.apiBaseUrl}/login`, { email, password },
          { headers: { Cookie: cookieHeader(), 'x-csrf-token': await csrf(), 'Content-Type': 'application/json' }, validateStatus: () => true });
        if (login.status >= 300) throw new Error(`reporter sign-in failed (HTTP ${login.status})`);
        keep(login.headers['set-cookie']);
        const token = await csrf();
        return { 'Content-Type': 'application/json', Cookie: cookieHeader(), 'x-csrf-token': token };
      })();
    }
    return this.session;
  }

  private async headersFor(): Promise<Record<string, string>> {
    return (await this.sessionHeaders()) ?? this.authHeaders();
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Prefer the scoped API token (least privilege); fall back to a dedicated internal
    // token only for local/dev where no API token is configured.
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    } else if (this.internalToken) {
      headers['x-internal-token'] = this.internalToken;
    }
    return headers;
  }

  async onTestEnd(test: TestCase, result: TestResult) {
    // A passing test closes any incidents it previously opened. Without this the reporter
    // is insert-only and old failures stay "open" forever even after the test goes green.
    if (result.status === 'passed') {
      try {
        const { data } = await axios.post(
          `${this.apiBaseUrl}/health/e2e-tests/resolve`,
          { testName: test.title },
          { headers: await this.headersFor() }
        );
        if (data?.resolved > 0) {
          console.log(`[OddjobReporter] Resolved ${data.resolved} prior incident(s) for passing test "${test.title}".`);
        }
      } catch (err: any) {
        console.error(`[OddjobReporter] Failed to resolve incidents for "${test.title}": ${err.message}`, err.response?.data || '');
      }
      return;
    }

    if (result.status !== 'passed' && result.status !== 'skipped') {
      this.failedTestsCount++;
      const errorMsg = result.error?.message || 'Unknown error';
      const stackTrace = result.error?.stack || '';
      
      const screenshotAttachment = result.attachments.find(a => a.name === 'screenshot');
      const screenshotPath = screenshotAttachment?.path || '';

      const bugData = {
        defectId: `BUG-E2E-${Date.now()}`,
        bug_summary: `[Playwright E2E Fail] ${test.title}`,
        description: `E2E Test "${test.title}" failed in ${test.location.file}.\n\nError details:\n${errorMsg}`,
        reproduction_steps: `Run the playwright command:\nnpx playwright test ${test.location.file}:${test.location.line}`,
        environment: process.env.TEST_ENV || 'Development',
        browser_or_device: test.parent.project()?.name || 'Chromium',
        error_logs: stackTrace,
        severity_suggestion: 'P2 - High',
        metadata: {
          source: 'playwright-reporter',
          outcome: 'failed',
          testName: test.title,
          testFile: test.location.file,
          errorMessage: errorMsg,
          stackTrace,
          durationMs: result.duration,
          projectName: test.parent.project()?.name || 'Chromium',
          screenshotPath,
          videoPath: result.attachments.find(a => a.name === 'video')?.path || ''
        }
      };

      console.log(`[OddjobReporter] Reporting failure: "${test.title}"...`);

      const headers = await this.headersFor();

      try {
        const response = await axios.post(
          `${this.apiBaseUrl}/datasets/${this.datasetId}/items`,
          { items: [bugData] },
          { headers }
        );
        console.log(`[OddjobReporter] Successfully logged failure to Oddjob dataset ID ${this.datasetId}. Inserted count: ${response.data.inserted}`);
      } catch (err: any) {
        console.error(`[OddjobReporter] Failed to report bug: ${err.message}`, err.response?.data || '');
      }
    }
  }

  async onEnd(result: FullResult) {
    console.log(`[OddjobReporter] Test suite finished. Status: ${result.status}. Failed: ${this.failedTestsCount}`);
  }
}

export default OddjobReporter;
