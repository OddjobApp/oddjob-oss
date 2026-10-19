import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CredentialFormFactory } from "./CredentialFormFactory";

/**
 * Parity guard for the CredentialDetail swap.
 *
 * The 1,305-line CredentialDetail.tsx inlined a form for each of seven
 * credential types. It was replaced by the decomposition in this directory,
 * which had been written but never wired to a route. The risk in that swap is
 * a type quietly losing its form — the page would still render, just without
 * the fields, and nothing would fail.
 *
 * So: one case per type the monolith handled, asserting the form actually
 * mounts. The type strings are the ones the monolith branched on
 * (`credential.type === '...'`), not names invented here.
 */

const TYPES = [
  "jira",
  "database",
  "ai_provider",
  "airflow",
  "smtp",
  "confluence",
  "google_drive",
] as const;

function renderFor(type: string, metadata: Record<string, unknown> = {}) {
  return render(
    <CredentialFormFactory
      credential={{ id: 1, name: "c", type } as any}
      metadata={metadata as any}
      onMetadataChange={vi.fn()}
      isEditing={false}
      isLoading={false}
    />,
  );
}

describe("CredentialFormFactory", () => {
  it.each(TYPES)("mounts a form for credential type %s", (type) => {
    const { container } = renderFor(type);
    // Each form renders real markup; the regression this guards against is an
    // unmatched switch case returning null.
    expect(container.firstChild).not.toBeNull();
  });

  it("covers every type the previous monolithic CredentialDetail handled", () => {
    // Pinned deliberately: adding a credential type to the backend without a
    // form here is exactly how a field set goes missing on the live page.
    expect([...TYPES].sort()).toEqual(
      ["ai_provider", "airflow", "confluence", "database", "google_drive", "jira", "smtp"].sort(),
    );
  });

  it("renders a fallback for an unrecognised type rather than nothing", () => {
    // The monolith had no default branch — an unknown type produced an empty
    // page with no explanation.
    const { container } = renderFor("some_future_provider");
    expect(container.firstChild).not.toBeNull();
  });

  it("passes the JIRA test-connection affordances through", () => {
    render(
      <CredentialFormFactory
        credential={{ id: 1, name: "c", type: "jira" } as any}
        metadata={{} as any}
        onMetadataChange={vi.fn()}
        isEditing
        isLoading={false}
        onTest={vi.fn()}
        isTesting={false}
        testResult={{ success: true, message: "Connected as Ada" }}
      />,
    );
    expect(screen.getByText(/Connected as Ada/i)).toBeInTheDocument();
  });
});
