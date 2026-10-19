import { describe, it, expect } from "vitest";
import { classifyOpenReviewStatus } from "./openreview-status.js";

describe("classifyOpenReviewStatus", () => {
  it("reads the decision from the venueid suffix", () => {
    expect(classifyOpenReviewStatus("ICLR.cc/2025/Conference")).toBe("accepted");
    expect(classifyOpenReviewStatus("NeurIPS.cc/2024/Workshop/Audio_Imagination")).toBe("accepted");
    expect(classifyOpenReviewStatus("ICLR.cc/2025/Conference/Rejected_Submission")).toBe("rejected");
    expect(classifyOpenReviewStatus("ICLR.cc/2025/Conference/Desk_Rejected_Submission")).toBe("rejected");
    expect(classifyOpenReviewStatus("ICLR.cc/2026/Conference/Withdrawn_Submission")).toBe("withdrawn");
    expect(classifyOpenReviewStatus("ICLR.cc/2027/Conference/Submission")).toBe("under_review");
    expect(classifyOpenReviewStatus(undefined)).toBe("under_review");
  });

  it("does not call records imported from DBLP or ORCID accepted", () => {
    expect(classifyOpenReviewStatus("dblp.org/journals/CORR/2025", "CoRR 2025")).toBe("preprint");
    expect(classifyOpenReviewStatus("OpenReview.net/Public_Article", "CoRR 2026")).toBe("preprint");
    expect(classifyOpenReviewStatus("OpenReview.net/Public_Article", "Visual Intelligence")).toBe("indexed");
    expect(classifyOpenReviewStatus("dblp.org/conf/cvpr/2024", "CVPR 2024")).toBe("indexed");
    expect(classifyOpenReviewStatus("thecvf.com/CVPR/2026/Conference", "CVPR 2026")).toBe("accepted");
  });
});
