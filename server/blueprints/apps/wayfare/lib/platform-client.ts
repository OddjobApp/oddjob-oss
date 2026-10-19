import type { WayfareTrip } from "./workflow";
export function commandKey() {
  return `wayfare:${location.pathname}:${new URLSearchParams(location.search).get("orgId")}:${new URLSearchParams(location.search).get("crewRoom")}`;
}
export async function tripsRequest<T>(body?: unknown, path = ""): Promise<T> {
  const room = new URLSearchParams(location.search).get("crewRoom");
  if (!room)
    throw new Error("Open Wayfare from App Studio inside a CREW room.");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    ["/route", "/chargers", "/accommodations"].includes(path) ? 90000 : 20000,
  );
  try {
    const response = await fetch(
      `/api/oddjob/wayfare/trips${path}${path.includes("?") ? "&" : "?"}crewRoom=${encodeURIComponent(room)}`,
      {
        method: body ? "POST" : "GET",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : typeof data.error?.message === "string"
            ? data.error.message
            : typeof data.message === "string"
              ? data.message
              : `Request failed (${response.status})`,
      );
    return data;
  } finally {
    clearTimeout(timer);
  }
}
export type { WayfareTrip };
