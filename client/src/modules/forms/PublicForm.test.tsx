import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicForm } from "./PublicForm";

const token = "a".repeat(48);
const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("PublicForm on a members-only link", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the form is for the project's members, and does not say whether a code was sent", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { status: "otp_required", name: "Board pulse", membersOnly: true }));
    render(<PublicForm token={token} />);
    expect(await screen.findByText("This form is for members of its project. Confirm your email address to open it.")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(reply(200, { status: "sent", membersOnly: true }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "someone@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send code/ }));
    expect(await screen.findByText("If someone@example.com belongs to a member of this project, we sent it a 6-digit code. It works for 10 minutes.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/form-studio/public/${token}/code`, expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "someone@example.com" }) }));
  });

  it("keeps the plain wording on a link that only asks for a code", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, { status: "otp_required", name: "Pulse", membersOnly: false }));
    render(<PublicForm token={token} />);
    expect(await screen.findByText("Confirm your email address to open this form.")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(reply(200, { status: "sent", membersOnly: false }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "someone@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send code/ }));
    expect(await screen.findByText("We sent a 6-digit code to someone@example.com. It works for 10 minutes.")).toBeInTheDocument();
  });

  it("turns away a confirmed email that is not a member, and forgets its session", async () => {
    window.sessionStorage.setItem(`form-session:${token}`, "old-session");
    fetchMock.mockResolvedValueOnce(reply(403, { status: "members_only", message: "This form is only for members of Board." }));
    render(<PublicForm token={token} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This form is only for members of Board."));
    expect(window.sessionStorage.getItem(`form-session:${token}`)).toBeNull();
  });
});
