import type { StudioLocation, StudioTab } from "./navigation";

/**
 * A link to a place in Media Studio, to share: the room's own address with the studio
 * open on a tab, production, scene and shot. It carries ids only, so whoever opens it
 * sees the production only if they could already read it.
 */

const TABS: StudioTab[] = ["create", "story", "storyboard", "characters", "shots", "film"];
const PARAMS = ["studio", "tab", "production", "scene", "shot"] as const;

export function studioLinkFor(location: StudioLocation, href: string): string {
  const url = new URL(href);
  for (const name of PARAMS) url.searchParams.delete(name);
  url.searchParams.set("studio", "media");
  url.searchParams.set("tab", location.tab);
  if (location.productionId != null) url.searchParams.set("production", String(location.productionId));
  if (location.sceneId != null) url.searchParams.set("scene", String(location.sceneId));
  if (location.shotId != null) url.searchParams.set("shot", String(location.shotId));
  return url.toString();
}

const idOf = (value: string | null) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : undefined;
};

/** The place a studio link names, or null when the address is not one. */
export function readStudioLink(search: string): StudioLocation | null {
  const params = new URLSearchParams(search);
  if (params.get("studio") !== "media") return null;
  const tab = params.get("tab") as StudioTab | null;
  const productionId = idOf(params.get("production"));
  const sceneId = idOf(params.get("scene"));
  const shotId = idOf(params.get("shot"));
  return {
    tab: tab && TABS.includes(tab) ? tab : "film",
    ...(productionId ? { productionId } : {}),
    ...(sceneId ? { sceneId } : {}),
    ...(shotId ? { shotId } : {}),
  };
}
