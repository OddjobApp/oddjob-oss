import { afterEach, expect, it, vi } from "vitest";
import { optionalRoundContext } from "./optional-round-context";
afterEach(() => vi.useRealTimers());
it("continues without optional context when a read hangs", async () => {
  vi.useFakeTimers();
  const warn = vi.fn();
  const result = optionalRoundContext(new Promise<string>(() => {}), "", warn, 10);
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toBe("");
  expect(warn).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("returns available context and clears its deadline", async () => {
  vi.useFakeTimers();
  const warn = vi.fn();
  expect(await optionalRoundContext(Promise.resolve("context"), "", warn)).toBe("context");
  expect(warn).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("reports a rejected read without failing the round", async () => {
  const warn = vi.fn();
  expect(await optionalRoundContext(Promise.reject(new Error("unavailable")), "", warn)).toBe("");
  expect(warn).toHaveBeenCalledOnce();
});
