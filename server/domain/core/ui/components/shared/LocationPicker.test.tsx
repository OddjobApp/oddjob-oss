import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FormRenderer, { type FormSchema } from "./FormRenderer.js";
import { LocationPicker } from "./LocationPicker.js";

// Mock react-map-gl
vi.mock("react-map-gl", () => {
  return {
    default: function MockMap({ children, onClick }: any) {
      return (
        <div data-testid="mock-mapbox-map" onClick={() => onClick && onClick({ lngLat: { lat: 34.0522, lng: -118.2437 } })}>
          {children}
        </div>
      );
    },
    Marker: function MockMarker({ children, latitude, longitude }: any) {
      return (
        <div data-testid="mock-map-marker" data-lat={latitude} data-lng={longitude}>
          {children}
        </div>
      );
    },
    NavigationControl: function MockNavigationControl() {
      return <div data-testid="mock-nav-control" />;
    },
  };
});

// Mock fetch
const globalFetch = global.fetch;

describe("HIL Location Search and Mapping Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders LocationPicker with search bar, GPS button, and interactive map", async () => {
    const onChange = vi.fn();
    render(<LocationPicker onChange={onChange} placeholder="Search destination..." />);

    expect(screen.getByPlaceholderText("Search destination...")).toBeDefined();
    expect(screen.getByText("Locate Me")).toBeDefined();
    expect(screen.getByTestId("mock-mapbox-map")).toBeDefined();
  });

  it("renders location field inside FormRenderer schema and handles submission", async () => {
    const onSubmit = vi.fn();
    const schema: FormSchema = {
      fields: [
        {
          key: "pickupLocation",
          type: "location",
          label: "Pickup Location",
          required: true,
          placeholder: "Enter pickup address",
        },
        {
          key: "guestCount",
          type: "number",
          label: "Guests",
          defaultValue: "2",
        },
      ],
    };

    render(<FormRenderer schema={schema} onSubmit={onSubmit} submitLabel="Submit Request" />);

    expect(screen.getByText("Pickup Location")).toBeDefined();
    // FormRenderer lazy-loads the picker (and mapbox-gl), so wait for it to mount.
    expect(await screen.findByPlaceholderText("Enter pickup address")).toBeDefined();
    expect(screen.getByTestId("mock-mapbox-map")).toBeDefined();

    // Click map to drop pin
    const map = screen.getByTestId("mock-mapbox-map");
    fireEvent.click(map);

    // Submit form
    const submitBtn = screen.getByRole("button", { name: "Submit Request" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const submittedData = onSubmit.mock.calls[0][0];
    expect(submittedData.guestCount).toBe("2");
    expect(submittedData.pickupLocation).toBeDefined();
  });
});
