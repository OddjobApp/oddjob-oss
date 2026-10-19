import { describe, it, expect } from "vitest";
import { isComputerUseStudioRequest, isAppStudioRequest } from "../../server/domain/crew/core/crew-round-context.js";

describe("isComputerUseStudioRequest Intent Resolver", () => {
  it("matches 'Open Computer' and related natural shorthands", () => {
    expect(isComputerUseStudioRequest("Open Computer")).toBe(true);
    expect(isComputerUseStudioRequest("open computer")).toBe(true);
    expect(isComputerUseStudioRequest("Open the computer")).toBe(true);
    expect(isComputerUseStudioRequest("Launch Computer")).toBe(true);
    expect(isComputerUseStudioRequest("Start computer")).toBe(true);
    expect(isComputerUseStudioRequest("mount computer")).toBe(true);
    expect(isComputerUseStudioRequest("view computer")).toBe(true);
  });

  it("matches full studio names and phrases", () => {
    expect(isComputerUseStudioRequest("Open Computer Studio")).toBe(true);
    expect(isComputerUseStudioRequest("Computer Studio")).toBe(true);
    expect(isComputerUseStudioRequest("open desktop studio")).toBe(true);
    expect(isComputerUseStudioRequest("launch computer use")).toBe(true);
    expect(isComputerUseStudioRequest("show the computer use studio")).toBe(true);
  });

  it("does not get hijacked by isAppStudioRequest", () => {
    expect(isAppStudioRequest("Open Computer")).toBe(false);
    expect(isAppStudioRequest("Open Computer Studio")).toBe(false);
  });

  it("rejects unrelated queries", () => {
    expect(isComputerUseStudioRequest("What is a computer?")).toBe(false);
    expect(isComputerUseStudioRequest("search the web for computer chips")).toBe(false);
  });
});
