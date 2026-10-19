import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn(async () => ({})) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ApprovalDetailDialog } from "./ApprovalDetailDialog";

/**
 * The context shape is copied from the producer —
 * server/domain/agents/core/selenium-agent.service.ts, the `createApprovalRequest`
 * call in its `pause_for_captcha` branch — not invented here. The relay reads
 * `modifiedOutput.solution` and nothing else, so that field is what these
 * assertions pin.
 */
const SCREENSHOT = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function buildCaptchaApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 5120,
    pipelineName: "MISSION",
    stepName: "browser-navigation",
    createdAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    pipelineExecutionId: 41,
    contextSnapshot: {
      type: "captcha_solution",
      goal: "Collect pricing from the vendor portal",
      screenshot: SCREENSHOT,
    },
    ...overrides,
  } as any;
}

function renderDialog(approval: any) {
  const onDecision = vi.fn();
  render(
    <ApprovalDetailDialog approval={approval} open onOpenChange={vi.fn()} onDecision={onDecision} />,
  );
  return onDecision;
}

describe("ApprovalDetailDialog CAPTCHA relay", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the captured challenge and the mission goal", () => {
    renderDialog(buildCaptchaApproval());

    expect(screen.getByText(/Solve the challenge/i)).toBeInTheDocument();
    expect(screen.getByText(/Collect pricing from the vendor portal/i)).toBeInTheDocument();

    const img = screen.getByAltText(/CAPTCHA challenge/i) as HTMLImageElement;
    expect(img.src).toBe(SCREENSHOT);
  });

  it("sends the typed answer as modifiedOutput.solution", async () => {
    renderDialog(buildCaptchaApproval());

    fireEvent.change(screen.getByTestId("captcha-solution-input"), {
      target: { value: "7GXQ2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, url, payload] = apiRequest.mock.calls[0] as any[];
    expect(url).toBe("/api/approvals/5120/decision");
    expect(payload.decision).toBe("approved");
    expect(payload.modifiedOutput.solution).toBe("7GXQ2");
    // The rest of the snapshot survives for the audit trail.
    expect(payload.modifiedOutput.goal).toBe("Collect pricing from the vendor portal");
  });

  it("trims surrounding whitespace, which the agent would otherwise type", async () => {
    renderDialog(buildCaptchaApproval());

    fireEvent.change(screen.getByTestId("captcha-solution-input"), {
      target: { value: "  7GXQ2 " },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, , payload] = apiRequest.mock.calls[0] as any[];
    expect(payload.modifiedOutput.solution).toBe("7GXQ2");
  });

  it("refuses to approve an empty answer instead of burning the relay attempt", async () => {
    renderDialog(buildCaptchaApproval());

    fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("still allows rejection, which aborts the mission immediately", async () => {
    renderDialog(buildCaptchaApproval());

    fireEvent.click(screen.getByRole("button", { name: /abort mission/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, , payload] = apiRequest.mock.calls[0] as any[];
    expect(payload.decision).toBe("rejected");
  });

  it("warns rather than showing a blank frame when no screenshot was attached", () => {
    renderDialog(
      buildCaptchaApproval({
        contextSnapshot: { type: "captcha_solution", goal: "Collect pricing" },
      }),
    );

    expect(screen.getByText(/No screenshot was attached/i)).toBeInTheDocument();
  });

  it("detects the nested context shape as well as the flat one", () => {
    renderDialog(
      buildCaptchaApproval({
        contextSnapshot: {
          context: { type: "captcha_solution", goal: "Nested goal", screenshot: SCREENSHOT },
        },
      }),
    );

    expect(screen.getByText(/Solve the challenge/i)).toBeInTheDocument();
    expect(screen.getByText(/Nested goal/i)).toBeInTheDocument();
  });

  it("does not hijack an unrelated approval", () => {
    renderDialog(
      buildCaptchaApproval({ contextSnapshot: { type: "input_request", message: "Pick one" } }),
    );

    expect(screen.queryByTestId("captcha-solution-input")).not.toBeInTheDocument();
  });

  it("supports zoom toggle and clicking target coordinates on the challenge image", async () => {
    renderDialog(buildCaptchaApproval());

    // Toggle zoom
    const zoomBtn = screen.getByTestId("captcha-zoom-toggle");
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    fireEvent.click(zoomBtn);
    expect(screen.getByText("Fit")).toBeInTheDocument();

    // Click on screenshot to mark coordinates
    const img = screen.getByTestId("captcha-screenshot-image");
    fireEvent.click(img, { clientX: 200, clientY: 150 });
    expect(screen.getByText(/Target Position:/i)).toBeInTheDocument();

    // Submit answer with coordinates
    fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, , payload] = apiRequest.mock.calls[0] as any[];
    expect(payload.decision).toBe("approved");
    expect(payload.modifiedOutput.coordinates).toEqual(expect.any(Object));
  });

  it("handles 2FA and security verification challenges", () => {
    renderDialog(
      buildCaptchaApproval({
        contextSnapshot: {
          type: "two_factor_auth",
          goal: "Confirm login code",
          screenshot: SCREENSHOT,
        },
      }),
    );

    expect(screen.getByText(/Solve the challenge/i)).toBeInTheDocument();
    expect(screen.getByTestId("captcha-solution-input")).toBeInTheDocument();
  });
});
