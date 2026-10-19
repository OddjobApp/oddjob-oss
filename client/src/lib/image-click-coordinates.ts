/**
 * Where a click on a rendered screenshot falls in the screenshot's own pixels.
 *
 * Challenge screenshots are shown scaled (max-height caps, zoom) and, with
 * `object-contain`, letterboxed. Reading `clientX - rect.left` gives a position
 * in the on-screen box, which a desktop click replayed from it would miss by the
 * scale factor plus the letterbox margin.
 *
 * `display` is where to draw the pin inside the box. Returns null for a click on
 * the letterbox margin. When the image has not loaded (naturalWidth 0, e.g. in
 * jsdom) the box position is the best available and is returned as-is.
 */
export interface ImageClick {
  x: number;
  y: number;
  display: { x: number; y: number };
}

export function imageClickCoordinates(
  event: { clientX: number; clientY: number; currentTarget: HTMLImageElement },
): ImageClick | null {
  const img = event.currentTarget;
  const rect = img.getBoundingClientRect();
  const boxX = event.clientX - rect.left;
  const boxY = event.clientY - rect.top;
  const display = { x: Math.round(boxX), y: Math.round(boxY) };

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || !rect.width || !rect.height) return { ...display, display };

  const contain = getComputedStyle(img).objectFit === "contain";
  const scaleX = contain ? Math.min(rect.width / nw, rect.height / nh) : rect.width / nw;
  const scaleY = contain ? scaleX : rect.height / nh;
  const offsetX = contain ? (rect.width - nw * scaleX) / 2 : 0;
  const offsetY = contain ? (rect.height - nh * scaleY) / 2 : 0;

  const x = (boxX - offsetX) / scaleX;
  const y = (boxY - offsetY) / scaleY;
  if (x < 0 || y < 0 || x > nw || y > nh) return null;
  return { x: Math.round(x), y: Math.round(y), display };
}
