import { describe, it, expect } from "vitest";
import { imageClickCoordinates } from "./image-click-coordinates";

function img(natural: { w: number; h: number }, box: { w: number; h: number }, fit?: string) {
  const el = document.createElement("img");
  if (fit) el.style.objectFit = fit;
  Object.defineProperty(el, "naturalWidth", { value: natural.w });
  Object.defineProperty(el, "naturalHeight", { value: natural.h });
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: box.w, height: box.h } as DOMRect);
  return el;
}

const click = (el: HTMLImageElement, x: number, y: number) =>
  imageClickCoordinates({ clientX: x + 10, clientY: y + 20, currentTarget: el });

describe("imageClickCoordinates", () => {
  it("scales a click on a shrunk screenshot back to its own pixels", () => {
    // 1280x800 shown at 320x200: a quarter scale.
    const hit = click(img({ w: 1280, h: 800 }, { w: 320, h: 200 }), 160, 100);
    expect(hit).toEqual({ x: 640, y: 400, display: { x: 160, y: 100 } });
  });

  it("removes the object-contain letterbox before scaling", () => {
    // 1000x500 contained in a 400x400 box: drawn 400x200, 100px bars top and bottom.
    const el = img({ w: 1000, h: 500 }, { w: 400, h: 400 }, "contain");
    expect(click(el, 200, 200)).toMatchObject({ x: 500, y: 250 });
    expect(click(el, 200, 50)).toBeNull(); // on the bar, not the image
  });

  it("falls back to box position when the image has no natural size yet", () => {
    const hit = click(img({ w: 0, h: 0 }, { w: 0, h: 0 }), 12, 34);
    expect(hit).toEqual({ x: 12, y: 34, display: { x: 12, y: 34 } });
  });
});
