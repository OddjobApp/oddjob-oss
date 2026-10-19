import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequest, toast } = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { VideoEngineSection } from "./VideoEngineSection";
import { production } from "./fixtures";
import type { ProductionView } from "@shared/media-studio";

const graph = { "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox" } }, "58": { class_type: "SaveVideo", inputs: { video: ["57", 0] } } };

const onComfy = (): ProductionView["video"] => ({
  engine: "comfyui", label: "ComfyUI", configured: true, resolution: "720p", centsPerSecond: 0, available: { fal: true, comfyui: true },
  workflow: {
    name: "Wan i2v", nodeCount: 11, nodeTypes: ["CLIPTextEncode", "SaveVideo", "WanImageToVideo"], fps: 16,
    mapping: {
      prompt: { nodeId: "6", input: "text" }, negativePrompt: { nodeId: "7", input: "text" }, seeds: [{ nodeId: "3", input: "seed" }],
      startImage: { nodeId: "52", input: "image" }, endImage: null, frames: { nodeId: "50", input: "length" },
    },
  },
});

describe("VideoEngineSection", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    toast.mockReset();
  });

  it("imports a pasted ComfyUI export, and says a paste that is not JSON before sending anything", async () => {
    const act = vi.fn(async () => production());
    render(<VideoEngineSection production={production({ video: { ...production().video, available: { fal: true, comfyui: true } } })} act={act} />);
    expect(screen.getByRole("radio", { name: /Seedance on fal\.ai/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /ComfyUI/ })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Or paste the exported JSON"), { target: { value: "{nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Import pasted workflow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not JSON.");
    expect(act).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Or paste the exported JSON"), { target: { value: JSON.stringify(graph) } });
    fireEvent.click(screen.getByRole("button", { name: "Import pasted workflow" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/productions/7/video-engine", { engine: "comfyui", workflow: { name: "Pasted workflow", graph } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Imported "Pasted workflow"', description: "Takes now render on ComfyUI with it." }));
  });

  it("shows what the workflow's takes fill in, asks the server for missing nodes, and switches back to Seedance", async () => {
    const act = vi.fn(async () => production());
    apiRequest.mockResolvedValue({ ok: true, json: async () => ({ engine: "comfyui", configured: true, reachable: true, missingNodes: ["WanImageToVideo"], error: null }) });
    render(<VideoEngineSection production={production({ video: onComfy() })} act={act} />);

    const summary = screen.getByTestId("comfy-workflow-summary");
    expect(summary).toHaveTextContent("Wan i2v · 11 nodes · 16 fps");
    expect(summary).toHaveTextContent("node 52 (image)");
    expect(summary).toHaveTextContent("node 50 (length)");

    fireEvent.click(screen.getByRole("button", { name: "Check with ComfyUI" }));
    expect(await screen.findByTestId("comfy-check")).toHaveTextContent("ComfyUI is missing this node: WanImageToVideo. Install it on the server, or import a workflow exported from it.");
    expect(apiRequest).toHaveBeenCalledWith("GET", "/api/media-studio/productions/7/video-engine/check", undefined);

    fireEvent.click(screen.getByRole("radio", { name: /Seedance on fal\.ai/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/productions/7/video-engine", { engine: "fal" }));
  });

  it("safely handles production records where video or video.available is missing or partial", () => {
    const act = vi.fn();
    const partialProduction = {
      ...production(),
      video: {
        engine: "fal" as const,
        label: "fal.ai",
        configured: false,
        resolution: "720p" as const,
        centsPerSecond: 30.34,
        available: undefined as unknown as any,
        workflow: null,
      },
    };
    expect(() => render(<VideoEngineSection production={partialProduction} act={act} />)).not.toThrow();
    expect(screen.getByRole("radio", { name: /Seedance on fal\.ai/ })).toBeInTheDocument();
  });

  it("lists available models and switches diffusion model when selected", async () => {
    const act = vi.fn(async () => production());
    apiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({
        engine: "comfyui",
        configured: true,
        reachable: true,
        missingNodes: [],
        models: ["wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors", "wan2.1_i2v_480p_14B_fp8_scaled.safetensors"],
        activeModel: "wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors",
        error: null,
      }),
    });
    render(<VideoEngineSection production={production({ video: onComfy() })} act={act} />);

    const select = await screen.findByLabelText("Diffusion model");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors");

    fireEvent.change(select, { target: { value: "wan2.1_i2v_480p_14B_fp8_scaled.safetensors" } });
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/productions/7/video-engine", {
        engine: "comfyui",
        model: "wan2.1_i2v_480p_14B_fp8_scaled.safetensors",
      })
    );
  });
});

