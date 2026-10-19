import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, resolveActiveOrgId } from "@/lib/queryClient";
import type { ProductionSummary, ProductionView } from "@shared/media-studio";

/** Appends active orgId to asset URLs so direct browser <img> and <video> elements load properly across tenant boundaries. */
export function withAssetOrg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/api/media-studio/assets/")) return url;
  if (url.includes("orgId=")) return url;
  const activeOrg = resolveActiveOrgId();
  if (!activeOrg) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}orgId=${activeOrg}`;
}

/** Media Studio's reads, and the one way it changes a production. */

export const productionsKey = (crewSessionId?: number) => ["/api/media-studio/productions", "list", crewSessionId ?? null] as const;
export const productionKey = (id: number) => ["/api/media-studio/productions", id] as const;

export async function readJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  return (await apiRequest(method, url, body)).json();
}

/** A keyframe or a take is still rendering, or a reel being cut, somewhere in the production. */
export const isRendering = (production?: ProductionView) =>
  Boolean(production?.scenes.some((scene) =>
    scene.plotPoints.some((plotPoint) => plotPoint.keyframes.some((k) => k.status === "rendering"))
    || scene.shots.some((shot) => shot.takes.some((take) => take.status === "queued" || take.status === "rendering"))
    || scene.assembly?.status === "assembling"))
  || Boolean(production?.references?.some((reference) => reference.status === "rendering"));

/** How often to read a production again: quickly while something renders, slowly while a take waits for approval. */
export function pollInterval(production?: ProductionView): number | false {
  if (isRendering(production)) return 4000;
  const waiting = production?.scenes.some((scene) =>
    scene.plotPoints.some((point) => point.keyframes.some((frame) => frame.status === "pending_approval"))
    || scene.shots.some((shot) => shot.takes.some((take) => take.status === "pending_approval")));
  return waiting ? 15000 : false;
}

/** The productions of a room, or of the organization outside one. */
export function useProductions(crewSessionId?: number) {
  return useQuery<ProductionSummary[]>({
    queryKey: productionsKey(crewSessionId),
    queryFn: async () => {
      const body = await readJson<unknown>("GET", crewSessionId ? `/api/media-studio/productions?crewSessionId=${crewSessionId}` : "/api/media-studio/productions");
      return Array.isArray(body) ? (body as ProductionSummary[]) : [];
    },
  });
}

/** A production, polled while a keyframe renders so its image appears without a reload. */
export function useProduction(id: number | null) {
  return useQuery<ProductionView>({
    queryKey: productionKey(id ?? 0),
    enabled: id != null,
    queryFn: () => readJson<ProductionView>("GET", `/api/media-studio/productions/${id}`),
    refetchInterval: (query) => pollInterval(query.state.data),
  });
}

export type ProductionAct = (method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) => Promise<ProductionView>;

/** Sends a change; the server answers with the whole production, which replaces the cached one. */
export function useProductionAct(id: number | null): ProductionAct {
  const queryClient = useQueryClient();
  return async (method, url, body) => {
    const view = await readJson<ProductionView>(method, url, body ?? {});
    queryClient.setQueryData(productionKey(view.id ?? id ?? 0), view);
    return view;
  };
}

export const projectStyleBibleKey = (projectId: number) => ["/api/media-studio/projects", projectId, "style-bible"] as const;

export function useProjectStyleBible(projectId: number | null | undefined) {
  return useQuery<any>({
    queryKey: projectStyleBibleKey(projectId ?? 0),
    enabled: projectId != null,
    queryFn: () => readJson<any>("GET", `/api/media-studio/projects/${projectId}/style-bible`),
  });
}

export async function promoteToProjectStyleBible(productionId: number): Promise<any> {
  return readJson<any>("POST", `/api/media-studio/productions/${productionId}/promote-to-project-bible`);
}

export async function updateProjectStyleBible(projectId: number, bible: unknown): Promise<any> {
  return readJson<any>("PUT", `/api/media-studio/projects/${projectId}/style-bible`, bible);
}

export async function orchestrateShot(shotId: number, options?: unknown): Promise<ProductionView> {
  return readJson<ProductionView>("POST", `/api/media-studio/shots/${shotId}/orchestrate`, options);
}

export function useCinematicCatalog() {
  return useQuery<any>({
    queryKey: ["/api/media-studio/cinematic-catalog"],
    queryFn: () => readJson<any>("GET", "/api/media-studio/cinematic-catalog"),
    staleTime: Infinity,
  });
}

export async function verifyCharacterDrift(payload: unknown): Promise<any> {
  return readJson<any>("POST", "/api/media-studio/characters/verify-drift", payload);
}

export async function addCoveragePackage(sceneId: number, template: "dialogue" | "atmospheric" | "action"): Promise<ProductionView> {
  return readJson<ProductionView>("POST", `/api/media-studio/scenes/${sceneId}/coverage`, { template });
}

export async function queueSceneTakes(sceneId: number): Promise<ProductionView> {
  return readJson<ProductionView>("POST", `/api/media-studio/scenes/${sceneId}/batch-takes`, {});
}

