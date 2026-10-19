import { BadRequestError } from "../utils/errors.js";

const MAX_AUDIT_FILTER_LENGTH = 100;

export function normalizeAuditFilter(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new BadRequestError("Audit filter must be a string");
    const filter = value.trim();
    if (!filter) return undefined;
    if (filter.length > MAX_AUDIT_FILTER_LENGTH) {
        throw new BadRequestError(`Audit filter cannot exceed ${MAX_AUDIT_FILTER_LENGTH} characters`);
    }
    return filter;
}

export function parseProposalId(value: string): number {
    const proposalId = Number(value);
    if (!Number.isSafeInteger(proposalId) || proposalId <= 0) {
        throw new BadRequestError("Invalid proposal id");
    }
    return proposalId;
}
