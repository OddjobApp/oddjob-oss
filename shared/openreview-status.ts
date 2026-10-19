/**
 * Review outcome of an OpenReview search result.
 *
 * Shared by the research-ingestion collector and the agent `google_search`
 * tool, so the two never disagree on what counts as a published paper.
 */

export type OpenReviewStatus = "accepted" | "under_review" | "rejected" | "withdrawn" | "preprint" | "indexed";

/**
 * Search returns every submission, not just the proceedings: a rejected paper
 * comes back with venue "Submitted to ICLR 2025". The decision lives in the
 * suffix of `venueid`, so it is surfaced rather than letting a rejected or
 * withdrawn paper read as published.
 *
 * Search also returns records imported from DBLP and ORCID, which OpenReview
 * never reviewed. "CoRR" is DBLP's name for arXiv, so those are preprints;
 * the rest are `indexed` — published per the importing index, unverified here.
 */
export function classifyOpenReviewStatus(venueId: string | undefined, venue?: string): OpenReviewStatus {
  const id = venueId ?? "";
  if (/^CoRR\b/i.test(venue ?? "") || /^dblp\.org\/journals\/CORR\b/i.test(id)) return "preprint";
  if (/^(?:dblp\.org\/|OpenReview\.net\/Public_Article\b)/i.test(id)) return "indexed";
  if (/\/Withdrawn_Submission$/.test(id)) return "withdrawn";
  if (/\/(?:Desk_)?Rejected_Submission$/.test(id)) return "rejected";
  if (!id || /\/Submission$/.test(id)) return "under_review";
  return "accepted";
}
