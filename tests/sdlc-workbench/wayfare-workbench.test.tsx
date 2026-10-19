import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  select: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../server/blueprints/apps/wayfare/lib/platform-client", () => ({
  tripsRequest: mocks.request,
  commandKey: () => "wayfare-test-retry",
}));
vi.mock("../../server/blueprints/apps/wayfare/lib/crew-sdk", () => ({
  setSelectedRecord: mocks.select,
  notifyView: mocks.notify,
  crewRoomKey: () => "test-room",
}));
import Wayfare from "../../server/blueprints/apps/wayfare/pages/index";
const trip = {
  id: "00000000-0000-4000-8000-000000000001",
  version: 1,
  plan: {
    name: "Test journey",
    origin: "A",
    destination: "B",
    maxDriveHours: 6,
    corridorMiles: 25,
    stops: [],
  },
};
function fillTrip() {
  fireEvent.change(screen.getByLabelText("Trip name"), {
    target: { value: "Test journey" },
  });
  fireEvent.change(screen.getByLabelText("Origin"), { target: { value: "A" } });
  fireEvent.change(screen.getByLabelText("Destination"), {
    target: { value: "B" },
  });
}
describe("Wayfare real trip surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (_body, path) =>
      path ? { credentials: [] } : { items: [], limitReached: false },
    );
  });
  it("opens without seeded routes, collaborators or calculated distances", async () => {
    render(<Wayfare />);
    expect(
      await screen.findByText("No trips yet. Create your first trip."),
    ).toBeTruthy();
    expect(screen.queryByText("Sarah Miller")).toBeNull();
    expect(screen.queryByText("790 mi")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Export GPX waypoints",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("saves and grounds the actual saved record", async () => {
    mocks.request.mockImplementation(async (body, path) =>
      path ? { credentials: [] } : body ? { trip, replayed: false } : { items: [] },
    );
    render(<Wayfare />);
    await screen.findByText("No trips yet. Create your first trip.");
    fillTrip();
    fireEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(await screen.findByText("Saved revision 1.")).toBeTruthy();
    expect(mocks.select).toHaveBeenCalledWith({
      collection: "wayfare_trips",
      recordId: trip.id,
    });
    expect(localStorage.getItem("wayfare-test-retry")).toBeNull();
  });
  it("keeps an unknown save request for an identical retry", async () => {
    const commands: any[] = [];
    mocks.request.mockImplementation(async (body, path) => {
      if (path) return { credentials: [] };
      if (body) {
        commands.push(body);
        throw new Error("Disconnected");
      }
      return { items: [] };
    });
    render(<Wayfare />);
    await screen.findByText("No trips yet. Create your first trip.");
    fillTrip();
    fireEvent.click(screen.getByRole("button", { name: "Save trip" }));
    const retry = await screen.findByRole("button", {
      name: "Retry saved request",
    });
    await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
    fireEvent.click(retry);
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[0]).toEqual(commands[1]);
    expect(
      (screen.getByLabelText("Trip name") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      screen.getByLabelText("Trip name").closest("fieldset")?.disabled,
    ).toBe(true);
  });
  it("pins the origin from a Mapbox suggestion via one permanent lookup", async () => {
    const geocodes: any[] = [];
    mocks.request.mockImplementation(async (body, path) => {
      if (path === "/mapbox") return { credentials: [{ id: 307, name: "Mapbox" }] };
      if (path === "/geocode") {
        geocodes.push(body);
        return body.mode === "suggest"
          ? { items: [{ name: "Denver, Colorado", context: "Colorado, United States", latitude: 39.7, longitude: -105 }] }
          : { items: [{ name: "Denver, Colorado", latitude: 39.73915, longitude: -104.9847 }] };
      }
      if (path) return { credentials: [] };
      return { items: [] };
    });
    render(<Wayfare />);
    await screen.findByText("No trips yet. Create your first trip.");
    const origin = screen.getByLabelText("Origin");
    await waitFor(() =>
      expect((origin as HTMLInputElement).placeholder).toContain("Search"),
    );
    fireEvent.change(origin, { target: { value: "Denv" } });
    fireEvent.click(await screen.findByRole("option", { name: /Denver, Colorado/ }));
    expect(await screen.findByText(/Pinned 39\.73915, -104\.98470/)).toBeTruthy();
    expect(geocodes.map((g) => g.mode ?? "permanent")).toEqual(["suggest", "permanent"]);
    expect(geocodes[1]).toMatchObject({ credentialId: 307, query: "Denver, Colorado" });
    expect((origin as HTMLInputElement).value).toBe("Denver, Colorado");
  });
  it("says what is missing before a journey can be calculated", async () => {
    render(<Wayfare />);
    await screen.findByText("No trips yet. Create your first trip.");
    expect(await screen.findByText("To draw the journey:")).toBeTruthy();
    for (const missing of [
      "Pick the origin from the Trip details search suggestions.",
      "Configure an EV or a commercial truck profile.",
      "Select an organization Mapbox credential.",
      "Save the trip.",
    ])
      expect(screen.getByText(missing)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Calculate journey" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it("explains a trip that fails validation beside the Save button", async () => {
    render(<Wayfare />);
    await screen.findByText("No trips yet. Create your first trip.");
    fireEvent.change(screen.getByLabelText("Origin"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Configure EV" }));
    fireEvent.click(screen.getByRole("button", { name: "Save trip" }));
    expect(await screen.findByText("The trip was not saved. Fix these first:")).toBeTruthy();
    for (const issue of [
      "Trip name is required.",
      "Destination is required.",
      "EV name is required.",
      "EV usable battery capacity must be greater than 0.",
    ])
      expect(screen.getByText(issue)).toBeTruthy();
    expect(mocks.request.mock.calls.some(([body, path]) => body && !path)).toBe(false);
  });
  it("reports failed reads and offers refresh without enabling writes", async () => {
    mocks.request.mockRejectedValue(new Error("Room unavailable"));
    render(<Wayfare />);
    expect(
      (await screen.findAllByRole("alert")).some((el) =>
        el.textContent?.includes("Room unavailable"),
      ),
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Save trip" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Refresh saved trips" }),
    ).toBeEnabled();
  });
});
