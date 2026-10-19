import type { MediaAspectRatio } from "@shared/media-studio";

/** The box a frame of each aspect ratio is drawn in. */
export const ASPECT_BOX: Record<MediaAspectRatio, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16]",
  "2.39:1": "aspect-[2.39/1]",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square",
};
