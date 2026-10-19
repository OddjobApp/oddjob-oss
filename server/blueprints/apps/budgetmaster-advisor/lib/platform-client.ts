/**
 * Minimal platform client for the BudgetMaster Financial Advisor app.
 * Talks to the Oddjob platform through the same-origin /api/oddjob/* proxy.
 */

export const FinanceCollections = {
  budgetContexts: "budget_contexts",
  budgetCategories: "budget_categories",
  financeAccounts: "finance_accounts",
  transactions: "transactions",
  deadMansSwitches: "dead_mans_switches",
  installmentTokens: "installment_tokens",
  subscriptions: "subscriptions",
  purchaseSandboxes: "purchase_sandboxes",
  balanceSnapshots: "balance_snapshots",
  financeRecommendations: "finance_recommendations",
} as const;

export interface FinanceAccount {
  account_id: string;
  name?: string;
  account_type?: string;
  base_currency?: string;
  current_balance?: number;
}

export interface Transaction {
  fitid: string;
  account_id?: string;
  context_id?: string;
  category_id?: string;
  timestamp?: string;
  payee_raw?: string;
  payee_clean?: string;
  amount?: number;
  current_status?: string;
  is_split?: boolean;
  parent_tx_id?: string | null;
}

/**
 * Finance datasets are owned by the BudgetMaster *workbench* app, not the
 * advisor. The advisor's own namespace is empty, so finance reads default to
 * this sibling slug; the platform's GET /datasets resolves it within the same
 * org (read-only). Override per-call via `list(collection, { sourceApp })`.
 */
export const FINANCE_SOURCE_APP = "budgetmaster-workbench";

/**
 * GET /datasets returns a FLAT array of records, each shaped
 * `{ id, ...data, _createdAt, _updatedAt }` — there is no `{ items }` envelope.
 */
interface DatasetRow {
  id: string;
  _createdAt?: string;
  _updatedAt?: string;
  [key: string]: unknown;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/oddjob/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Platform API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const records = {
  async list<T = Record<string, unknown>>(
    collection: string,
    opts?: { sourceApp?: string | null },
  ): Promise<T[]> {
    const sourceApp = opts === undefined ? FINANCE_SOURCE_APP : opts.sourceApp ?? null;
    const qs = new URLSearchParams({ collection });
    if (sourceApp) qs.set("source_app", sourceApp);
    const rows = await api<DatasetRow[]>(`datasets?${qs.toString()}`);
    if (!Array.isArray(rows)) return [];
    // Re-project each flat row back to the record body, dropping envelope keys.
    return rows.map(({ _createdAt, _updatedAt, ...rest }) => rest as unknown as T);
  },
};

export const knowledge = {
  async query(query: string, collection?: string): Promise<unknown[]> {
    const result = await api<{ matches?: unknown[] }>(`knowledge/query`, {
      method: "POST",
      body: JSON.stringify({ query, collection }),
    });
    return result.matches || [];
  },
};

export function fmtCurrency(n: number | undefined | null, currency = "USD"): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}
