import { BadRequestError } from "@server/utils/errors.js";

export type LinkPredictionStatus = "predicted" | "approved" | "rejected";
export type LinkPredictionReviewAction = "approve" | "reject";

export function parseLinkPredictionStatus(value: unknown): LinkPredictionStatus {
    if (value === undefined) return "predicted";
    if (value === "predicted" || value === "approved" || value === "rejected") return value;
    throw new BadRequestError("Status must be 'predicted', 'approved', or 'rejected'");
}

export function parseLinkPredictionReview(
    idValue: string,
    body: unknown,
): { linkId: number; action: LinkPredictionReviewAction } {
    const linkId = Number(idValue);
    if (!Number.isSafeInteger(linkId) || linkId <= 0) {
        throw new BadRequestError("Invalid predicted link id");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new BadRequestError("Review body must be an object");
    }
    const action = (body as Record<string, unknown>).action;
    if (action !== "approve" && action !== "reject") {
        throw new BadRequestError("Action must be 'approve' or 'reject'");
    }
    return { linkId, action };
}
