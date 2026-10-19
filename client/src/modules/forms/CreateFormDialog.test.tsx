import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn(async () => ({ ok: true, json: async () => [] })) }));

import { CreateFormDialog } from "./CreateFormDialog";

/**
 * In the live check a click beside the "New form from documents" dialog closed it
 * and threw away the name, the chosen document and the instruction.
 */

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreateFormDialog mode="documents" open={open} onOpenChange={setOpen} onCreated={vi.fn()} />
      {!open && <p>closed</p>}
    </QueryClientProvider>
  );
}

describe("CreateFormDialog", () => {
  it("closes on Escape while nothing has been entered", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("{Escape}");
    expect(await screen.findByText("closed")).toBeInTheDocument();
  });

  it("stays open, keeping what was typed, when Escape is pressed after typing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Name"), "Redaction audit review");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("closed")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Redaction audit review");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("closed")).toBeInTheDocument();
  });
});
