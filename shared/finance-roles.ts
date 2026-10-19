/**
 * Finance roles: who may do what with a project's QuickBooks books.
 *
 * A project owner gives each member one or more finance roles; a member's
 * QuickBooks access is the union of their roles, and a member with none has
 * no QuickBooks access at all, whatever their project or org role. The matrix
 * is segregation of duties:
 *
 *  - AR owns the receivables side and AP the payables side. Each reads the
 *    other's counterparty only where it helps (AP reads customers, invoices
 *    and payments), so nobody can create a vendor and then pay it.
 *  - Audit reads everything and changes nothing, which keeps it independent.
 *  - Executive reads everything, creates nothing, and is the second approver
 *    for voids, refunds and money going out (EXECUTIVE_APPROVAL).
 *  - Nobody writes the ledger (accounts, items, journal entries, transfers)
 *    through agents.
 *
 * "Create" means an agent may propose the record and a person holding the same
 * permission approves it into QuickBooks. "Delete" is a void: QuickBooks keeps
 * voided records for audit.
 *
 * The entity names are QuickBooks' own; the server's QUICKBOOKS_ENTITIES must
 * stay covered by QUICKBOOKS_PERMISSIONS (a test holds them together).
 */

export const FINANCE_ROLES = ['ar', 'ap', 'audit', 'executive'] as const;
export type FinanceRole = typeof FINANCE_ROLES[number];

export const FINANCE_ROLE_LABELS: Record<FinanceRole, string> = {
    ar: 'Accounts receivable',
    ap: 'Accounts payable',
    audit: 'Audit',
    executive: 'Executive',
};

export const FINANCE_OPS = ['create', 'read', 'update', 'delete'] as const;
export type FinanceOp = typeof FINANCE_OPS[number];

const OP_LETTER: Record<FinanceOp, string> = { create: 'C', read: 'R', update: 'U', delete: 'D' };

/** Entity → role → granted operations as C/R/U/D letters. A missing role means no access. */
export const QUICKBOOKS_PERMISSIONS: Record<string, Partial<Record<FinanceRole, string>>> = {
    // Receivables
    Customer: { ar: 'CRU', ap: 'R', audit: 'R', executive: 'R' },
    Invoice: { ar: 'CRUD', ap: 'R', audit: 'R', executive: 'R' },
    Estimate: { ar: 'CRUD', audit: 'R', executive: 'R' },
    Payment: { ar: 'CRUD', ap: 'R', audit: 'R', executive: 'R' },
    SalesReceipt: { ar: 'CRU', audit: 'R', executive: 'R' },
    CreditMemo: { ar: 'CRD', audit: 'R', executive: 'R' },
    RefundReceipt: { ar: 'CR', audit: 'R', executive: 'R' },
    Deposit: { ar: 'CR', audit: 'R', executive: 'R' },
    // Payables
    Vendor: { ap: 'CRU', audit: 'R', executive: 'R' },
    Bill: { ap: 'CRUD', audit: 'R', executive: 'R' },
    BillPayment: { ap: 'CR', audit: 'R', executive: 'R' },
    Purchase: { ap: 'CRU', audit: 'R', executive: 'R' },
    PurchaseOrder: { ap: 'CRUD', audit: 'R', executive: 'R' },
    VendorCredit: { ap: 'CR', audit: 'R', executive: 'R' },
    // Ledger
    Account: { ar: 'R', ap: 'R', audit: 'R', executive: 'R' },
    Item: { ar: 'R', ap: 'R', audit: 'R', executive: 'R' },
    JournalEntry: { audit: 'R', executive: 'R' },
    Transfer: { audit: 'R', executive: 'R' },
};

/**
 * Writes that need an Executive's approval on top of the proposer's own
 * permission: voids, refunds and money going out. The Executive must be a
 * different person from the one who asked for it.
 */
export const EXECUTIVE_APPROVAL: ReadonlySet<string> = new Set([
    'Invoice:delete', 'Payment:delete', 'CreditMemo:delete', 'Bill:delete',
    'RefundReceipt:create', 'BillPayment:create',
]);

export const QUICKBOOKS_REPORT_ACCESS: Record<string, FinanceRole[]> = {
    AgedReceivables: ['ar', 'audit', 'executive'],
    AgedPayables: ['ap', 'audit', 'executive'],
    ProfitAndLoss: ['audit', 'executive'],
    BalanceSheet: ['audit', 'executive'],
    CashFlow: ['audit', 'executive'],
};

export function isFinanceRole(value: unknown): value is FinanceRole {
    return typeof value === 'string' && (FINANCE_ROLES as readonly string[]).includes(value);
}

/** Whether a single role grants `op` on `entity`. Unknown entities grant nothing. */
export function roleGrants(role: FinanceRole, entity: string, op: FinanceOp): boolean {
    return QUICKBOOKS_PERMISSIONS[entity]?.[role]?.includes(OP_LETTER[op]) ?? false;
}

export function requiresExecutiveApproval(entity: string, op: FinanceOp): boolean {
    return EXECUTIVE_APPROVAL.has(`${entity}:${op}`);
}

export interface FinanceAccess {
    roles: FinanceRole[];
    /** Holds at least one finance role, the floor for any QuickBooks access. */
    any: boolean;
    can(entity: string, op: FinanceOp): boolean;
    canReport(report: string): boolean;
}

/** A member's QuickBooks access: the union of their roles. */
export function financeAccess(roles: readonly FinanceRole[]): FinanceAccess {
    const held = [...new Set(roles.filter(isFinanceRole))];
    return {
        roles: held,
        any: held.length > 0,
        can: (entity, op) => held.some(role => roleGrants(role, entity, op)),
        canReport: report => held.some(role => QUICKBOOKS_REPORT_ACCESS[report]?.includes(role) ?? false),
    };
}

/** The matrix cell for display, e.g. "CRU" with "D†" where an Executive must also approve. */
export function permissionCell(role: FinanceRole, entity: string): string {
    return FINANCE_OPS.filter(op => roleGrants(role, entity, op))
        .map(op => OP_LETTER[op] + (requiresExecutiveApproval(entity, op) ? '†' : ''))
        .join('');
}
