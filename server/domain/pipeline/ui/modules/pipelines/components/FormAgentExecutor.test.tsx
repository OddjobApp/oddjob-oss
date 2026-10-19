import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FormAgentExecutor from "./FormAgentExecutor";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "@/lib/queryClient";

afterEach(cleanup);

function renderExecutor(props: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FormAgentExecutor {...props} />
    </QueryClientProvider>
  );
}

describe("FormAgentExecutor", () => {
  const defaultProps = {
    jobId: 101,
    pipelineExecutionId: "pipe-exec-123",
    timeoutMinutes: 15,
    onComplete: vi.fn(),
    onTimeout: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders a single-step form and handles submission", async () => {
    const mockSubmitResponse = { success: true, executionId: "pipe-exec-123" };
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => mockSubmitResponse,
    } as any);

    const onComplete = vi.fn();
    const formSchema = {
      title: "Applicant Form",
      fields: [
        { key: "username", label: "Username", type: "text" as const, required: true },
      ],
    };

    renderExecutor({
      ...defaultProps,
      formSchema,
      onComplete,
    });

    // Form field and countdown header should render
    expect(screen.getByText("Time Remaining")).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/)).toBeInTheDocument();

    // Fill in field
    fireEvent.change(screen.getByLabelText(/Username/), { target: { value: "testuser" } });

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: /Submit Form/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/form-agents/101/submit",
        expect.objectContaining({
          pipelineExecutionId: "pipe-exec-123",
          formData: expect.objectContaining({ username: "testuser" }),
        })
      );
      expect(onComplete).toHaveBeenCalledWith(mockSubmitResponse);
    });
  });

  it("renders a multi-step form schema and traverses pages to submit", async () => {
    const mockSubmitResponse = { success: true, result: "advanced" };
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => mockSubmitResponse,
    } as any);

    const onComplete = vi.fn();
    const formSchema = {
      steps: [
        {
          id: "step_one",
          title: "First Step",
          fields: [{ key: "f1", label: "Field One", type: "text" as const, defaultValue: "val1" }],
        },
        {
          id: "step_two",
          title: "Second Step",
          fields: [{ key: "f2", label: "Field Two", type: "text" as const, defaultValue: "val2" }],
        },
      ],
    };

    renderExecutor({
      ...defaultProps,
      formSchema,
      onComplete,
    });

    expect(screen.getByText("First Step")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    // Advance to next page
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Second Step")).toBeInTheDocument();

    // Advance to review
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Review your answers")).toBeInTheDocument();

    // Submit from review page
    fireEvent.click(screen.getByRole("button", { name: /Submit Form/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/form-agents/101/submit",
        expect.objectContaining({
          formData: expect.objectContaining({ f1: "val1", f2: "val2" }),
        })
      );
      expect(onComplete).toHaveBeenCalledWith(mockSubmitResponse);
    });
  });

  it("handles cancel execution button click", () => {
    const onCancel = vi.fn();
    renderExecutor({
      ...defaultProps,
      formSchema: { fields: [] },
      onCancel,
    });

    const cancelBtn = screen.getByRole("button", { name: /Cancel Execution/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
