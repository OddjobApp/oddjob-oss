# ComfyUI Architecture & Media Studio in CREW: Research & Integration Strategy

## Executive Summary

Oddjob's **Media Studio** currently operates on a monolithic, one-shot paradigm: Scribe script prompts are compiled into flat text strings and dispatched to a remote third-party API (fal.ai Seedance 2.0), followed by sequential FFmpeg concatenation. While this enables rapid prototyping of cinematic sequences, it suffers from the classic limitations of monolithic video generation: **character drift**, **uncontrollable camera motion**, **opaque rendering queues**, and **expensive full-cost re-rolls**.

**ComfyUI** has emerged as the definitive open architecture for advanced generative AI. By decoupling the generation pipeline into a **Directed Acyclic Graph (DAG)** of modular nodes with **deterministic execution caching**, ComfyUI enables fine-grained control, multi-model conditioning (IP-Adapter, ControlNet, LoRAs, CameraCtrl, Audio Lip-Sync), sub-second iterative re-runs, and real-time step-by-step WebSocket telemetry.

This document researches how ComfyUI's architectural tenets, execution model, and headless API can be integrated into Oddjob to revolutionize the **Media Studio experience in CREW**.

---

## 1. ComfyUI Architectural Analysis

ComfyUI is fundamentally an extensible, graph-based execution runtime for generative diffusion models. Its design differs markedly from black-box APIs:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               COMFYUI CORE ARCHITECTURE                                │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Graph Specification (Client / Agent)                                                │
│    • Workflow JSON (Visual layout, canvas coords, UI connections)                      │
│    • API Prompt JSON (Execution DAG: node IDs, class_types, input linkages)            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. Deterministic Graph Execution Engine (Server)                                       │
│    • Topological sort into executable task sequence                                    │
│    • Node-level SHA256 input hashing: skips unchanged nodes, caches VRAM tensors       │
│    • Multi-tenant execution queue with priority scheduling                             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. WebSocket Real-Time Telemetry & Previews                                            │
│    • execution_start -> executing (node ID) -> progress (step/total) -> executed       │
│    • Real-time latent stream: TAESD decoder delivers low-res frame previews on-the-fly │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. Modular Conditioning Ecosystem                                                      │
│    • Identity & Style: IP-Adapter, InstantID, FaceID, LoRA stacking                    │
│    • Spatial & Pose: ControlNet (Depth, OpenPose, Canny, LineArt)                      │
│    • Temporal & Motion: AnimateDiff, SVD, Wan2.1, HunyuanVideo, CogVideoX, CameraCtrl  │
│    • Post-Processing: RIFE/FILM frame interpolation, Real-ESRGAN/CCSR upscalers, TTS    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Advantages of ComfyUI

| Dimension | Monolithic Seedance / fal.ai | ComfyUI Architecture |
|---|---|---|
| **Pipeline Structure** | Black-box single endpoint call (`prompt` + `image_url` -> `video_url`) | Explicit DAG of modular nodes (Encoders, Conditioning, Samplers, Latents, VAE, Post) |
| **Re-roll Cost & Latency** | Modifying one word re-executes 100% of the pipeline, burning full credit costs | **Node-level caching**: changing prompt or motion only re-runs downstream samplers, saving 60–80% time and computation |
| **Character Continuity** | Text prompt + single starting frame (high probability of facial morphing) | **IP-Adapter / InstantID embeddings** + character LoRAs chained across all shots |
| **Camera & Motion Control** | Text descriptions (e.g. "push-in", "orbit") that models often ignore | **CameraCtrl / MotionCtrl / ControlNet Depth**: deterministic camera trajectories |
| **Execution Observability** | Opaque `queued` -> `rendering` spinner | **Step-level WebSocket telemetry**: node-by-node execution highlights & live latent frame streaming |
| **Dialogue & Lip-Sync** | Generic synthetic speech or silent video | **Chained audio stems**: Wav2Lip, LivePortrait, or EchoMimic synced to Scribe TTS tracks |

---

## 2. Current State of Media Studio in Oddjob

Oddjob's current Media Studio provides a clean high-level interface:
- **`MediaStudioPod.tsx`**: Mounted in the CREW chat Assembler (`ModularAssemblyPuzzleRail`), offering:
  1. `MediaStageCanvas`: Video playback with aspect ratio letterboxing, scrubber, and A/B take comparison (`compareTakeFor`).
  2. `MediaDailiesInspector`: Take list, defect tagging (`character_drift`, `unnatural_motion`, etc.), and director actions (`Approve`, `Re-roll`, `Discuss`).
  3. `MediaTimelineSequencer`: Multi-shot horizontal sequence timeline with transitions and audio stems.
- **Backend & Provider (`server/domain/media-studio/`)**:
  - `video-provider.ts`: Implements `FalVideoProvider` for fal.ai Seedance 2.0.
  - `gemini-image.ts`: Ingests Scribe storyboard beats to generate initial keyframes.
  - `ffmpeg.ts`: Assembles approved takes into sequence reels.
- **Agent Squad (`oddjob-film-production` skill)**:
  - Assistant Director (AD) Agent, Line Producer Agent, Post-Production Agent.

### Core Pain Points Identified
1. **No Fine-Grained Remediation on Takes**: When a director tags a take with `character_drift` or `lighting_mismatch`, the only current action is a blind re-roll with an updated prompt string.
2. **Missing Live Visual Feedback**: While a take is rendering (which can take 45–120 seconds), the director sees only a holding clock or progress percentage without any preview of what the model is drawing.
3. **No Character Identity Asset Store**: Characters in Scribe manuscripts cannot easily lock an embedding or weight checkpoint to ensure they look identical across all scenes.

---

## 3. How ComfyUI Transforms the Media Studio Experience in CREW

Integrating ComfyUI principles into Media Studio creates a generational leap in creative control and agentic collaboration.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                   COMFYUI-ENHANCED MEDIA STUDIO IN CREW CHATROOM                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   ┌────────────────────────────────────────┐  ┌────────────────────────────────────┐   │
│   │ CREW Chat & Agent Collaboration       │  │ Media Studio Pod (Assembler)        │   │
│   │                                        │  │                                    │   │
│   │ [Director]: "Elena's face drifted in   │  │  ┌──────────────────────────────┐  │   │
│   │  Take 2, and the camera is too fast."  │  │  │ [Stage Canvas] / [Graph View]│  │   │
│   │                                        │  │  │ Live Latent Previews (TAESD) │  │   │
│   │ [AD Agent]: Analyzed take #2 DAG.      │  │  └──────────────────────────────┘  │   │
│   │ -> Injected Elena FaceID (weight 0.85) │  │  ┌──────────────────────────────┐  │   │
│   │ -> Adjusted CameraCtrl pan speed: 0.6x │  │  │ Dailies Inspector & Defect   │  │   │
│   │ -> Reusing cached initial keyframe     │  │  │ Diagnostics                  │  │   │
│   │                                        │  │  └──────────────────────────────┘  │   │
│   │ [Diff Card]: Ready to re-render take 3 │  │  ┌──────────────────────────────┐  │   │
│   │ Estimated cost: $0.12 (65% cached)     │  │  │ Multi-Shot Timeline Sequence │  │   │
│   │ [Accept Proposal]                      │  │  └──────────────────────────────┘  │   │
│   └────────────────────────────────────────┘  └────────────────────────────────────┘   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Strategic Improvement 1: Dual-Mode Studio Pod ("Director's Deck" vs "Pipeline Graph")
Media Studio can offer two complementary views in `MediaStudioPod.tsx`:
1. **Director Mode (Current View)**: Polished cinematic view for high-level reviewing—Stage Canvas, Dailies Inspector, and Timeline Sequencer.
2. **Graph / Node Mode (Comfy View)**: A visual node flow representation of the take's generation pipeline. Directors and technical artists can inspect:
   - Input node (Scribe beat prompt + seed)
   - Style/Character conditioning node (Reference FaceID, Character LoRA)
   - Motion guidance node (CameraCtrl trajectory or ControlNet Depth)
   - Video diffusion sampler (model checkpoint, sampler steps, CFG)
   - Frame post-processor (RIFE frame doubler, face enhancer)

### Strategic Improvement 2: Headless ComfyUI Execution & Real-Time Streaming Canvas
Instead of relying solely on closed endpoints, Media Studio can run workflows against a ComfyUI execution server (either local GPU, dedicated cloud worker on Modal/RunPod, or managed ComfyUI instances on fal.ai):
- **WebSocket Streaming**: As ComfyUI executes, the WebSocket pushes `progress` and decoded latent frames (via TAESD).
- **Live Canvas Feedback**: The `MediaStageCanvas` renders the evolving video frames in real time as the sampling occurs, dramatically improving user engagement and allowing early cancellation of bad takes before incurring full rendering compute.

### Strategic Improvement 3: Character Identity Anchoring via IP-Adapter & LoRAs
In `shared/media-studio.ts`, characters currently have names, descriptions, and avatars. With ComfyUI:
- **Character Keyframe Training / Face Embedding**: When a character is created in Scribe, Media Studio generates or ingests a 3-angle character turnaround plate.
- An **IP-Adapter FaceID embedding** or lightweight LoRA is computed and stored as a `MediaAsset`.
- When shots featuring this character are dispatched, the AD Agent automatically wires the character's FaceID node into the generation graph, guaranteeing visual continuity across scenes and takes.

### Strategic Improvement 4: Surgical CREW Directives & Graph Patching
Currently, agent changes in CREW use `proposeMediaChange` to alter text fields on shots. With ComfyUI, CREW agents can perform **Graph-Level Surgical Edits**:
- Director: *"Make the shot moodier and push in slower on Maya."*
- CREW Agent parses this into exact node adjustments:
  - Node `Prompt_Positive`: Appends `"chiaroscuro, deep shadows, moody atmospheric lighting"`.
  - Node `CameraCtrl_Motion`: Changes motion preset from `"Fast Zoom"` to `"Slow Linear Dolly"`.
  - Node `Face_Conditioning`: Leaves untouched (cached).
- **Deterministic Cache Reuse**: When re-rendering, ComfyUI reuses the cached prompt CLIP embeddings and model weights, generating the new take in seconds.

### Strategic Improvement 5: Production Recipes for Tiered Workflows
Media Studio can introduce **Production Recipes** (packaged, parameterized ComfyUI JSON templates):
1. **Fast Animatics / Previz Recipe**: Low-cost distilled model (e.g. Wan2.1-distilled or AnimateDiff LCM) generating 480p animatics for scene blocking and timing.
2. **Cinematic Hero Shot Recipe**: High-fidelity pipeline using FLUX.1 + Wan2.1 / Seedance 2.0 + ControlNet Depth + RIFE 60fps interpolation.
3. **Dialogue & Performance Recipe**: Synchronizes take video with TTS dialogue stems using Wav2Lip / LivePortrait.
4. **VFX Plate Inpainting Recipe**: Replaces or extends backgrounds using depth-guided inpainting.

---

## 4. Proposed Architecture & Integration Plan

### Component Architecture

```
Oddjob Server (Node/TypeScript)
  ├── media-studio.service.ts
  │     ├── video-provider.ts (Abstract VideoProvider interface)
  │     │     ├── FalVideoProvider (existing Seedance 2.0)
  │     │     └── ComfyUIVideoProvider (new ComfyUI WebSocket/REST client)
  │     ├── comfy-workflow-compiler.ts (Compiles Scribe/Shot into ComfyUI API JSON)
  │     └── comfy-telemetry-relay.ts (Relays WebSocket progress & latent frames to CREW room)
  │
Oddjob Client (React/TypeScript)
  ├── MediaStudioPod.tsx
  │     ├── MediaStageCanvas.tsx (Supports live latent preview streaming)
  │     ├── MediaDailiesInspector.tsx (Node-level parameter tuning & defect remedies)
  │     ├── MediaTimelineSequencer.tsx (Multi-take audio/video conforming)
  │     └── MediaGraphViewer.tsx (New optional tab: interactive ComfyUI DAG visualizer)
```

### Proposed Data Model Extension (`shared/media-studio.ts`)

```typescript
export interface ComfyWorkflowTemplate {
  id: string;
  name: string;
  category: "previz" | "cinematic" | "dialogue" | "vfx";
  description: string;
  costTier: "draft" | "standard" | "ultra";
  /** The parameterized ComfyUI API prompt JSON */
  graphJson: Record<string, any>;
  /** Exposed parameter mappings for CREW agents */
  parameters: {
    promptNodeId: string;
    negativePromptNodeId?: string;
    seedNodeId: string;
    imageInputNodeId?: string;
    characterEmbeddingNodeId?: string;
    cameraMotionNodeId?: string;
    durationNodeId?: string;
  };
}

export interface TakeWorkflowSnapshot {
  templateId: string;
  resolvedGraphJson: Record<string, any>;
  cachedNodes: string[];
  executionTimeMs?: number;
}
```

---

## 5. Phased Implementation Roadmap

| Phase | Deliverable | Impact |
|---|---|---|
| **Phase 1: ComfyUI Headless Engine & Adapter** | Implement `ComfyUIVideoProvider` adhering to `VideoProvider`, supporting local ComfyUI or hosted fal.ai/Modal Comfy instances via `/prompt` and WebSocket events. | Enables Oddjob to run arbitrary ComfyUI node graphs headlessly without touching frontend. |
| **Phase 2: Workflow Recipe Compiler** | Build `comfy-workflow-compiler.ts` to map Scribe script beats, seeds, and character IDs into standard ComfyUI DAGs (FLUX + Wan2.1 / Seedance + IP-Adapter). | Solves character facial drift and provides reliable multi-shot visual continuity. |
| **Phase 3: Real-Time Latent Previews in CREW** | Hook ComfyUI's TAESD streaming into `MediaStageCanvas` and CREW message stream via WebSockets. | Directors see intermediate frame samples in real-time, drastically improving perceived speed and UX. |
| **Phase 4: Agentic Node Patching & Defect Remediation** | Extend `media-studio-change-tools.ts` with `proposeMediaGraphPatch` allowing agents to adjust specific graph nodes (e.g. camera speed, lighting weight) based on director feedback. | Unlocks sub-second re-rolls and precise artistic adjustments without prompt hallucination. |
| **Phase 5: Canvas Graph Visualizer in Pod** | Add a lightweight read-only / interactive DAG inspector tab inside `MediaStudioPod` showing the active take's node graph. | Gives creators full visibility into the AI film pipeline, bridging scriptwriting, generation, and post-production. |

---

## 6. Recommendations & Next Steps

1. **Deploy Headless ComfyUI Worker**: Configure a cloud ComfyUI worker endpoint (e.g. on fal.ai or Modal) with Wan2.1/Seedance, FLUX, and IP-Adapter pre-loaded.
2. **Implement `ComfyUIVideoProvider`**: Add the ComfyUI client to `server/domain/media-studio/core/video-provider.ts` as a pluggable alternative to `FalVideoProvider`.
3. **Formalize Character Style Anchors**: Update character models in `shared/media-studio.ts` to carry reference embedding assets that can be automatically wired into generation graphs.
4. **Prototype WebSocket Telemetry**: Stream step progress and low-res latent frame previews into CREW chat turns and `MediaStageCanvas`.
