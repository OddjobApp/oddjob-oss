import React from "react";
import ClientMediaStudioPod from "@/modules/media/MediaStudioPod";
import type { MediaStudioPodProps } from "@/modules/media/types";

/**
 * Media Studio — Film scene, shot generation, ComfyUI DAG pipelines & dailies review pod.
 *
 * Mounted beside a CREW room from the Scaffold rail, or opened on an active film production.
 */
export function MediaStudioPod(props: MediaStudioPodProps) {
  return <ClientMediaStudioPod {...props} />;
}

export const MediaStudioPodAlias = MediaStudioPod;
export default MediaStudioPod;
