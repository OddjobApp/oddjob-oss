import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProjectStudio from "./ProjectStudio";
import type { WavePlanItem } from "./types";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// The plan commit goes through apiRequest (CSRF + org headers); the old raw
// fetch carried neither. Mocked here so each test decides the server's answer.
const mockApiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiRequest: mockApiRequest,
}));

const savedCycle = (overrides: Record<string, unknown> = {}) => ({
  json: async () => ({
    cycleId: 77,
    name: "Plan",
    status: "pending_approval",
    projectId: 12,
    blueprintCount: 2,
    replayed: false,
    cycleUrl: "/operations/cycles/77",
    ...overrides,
  }),
});

const httpError = (statusCode: number, message: string, details?: unknown) =>
  Object.assign(new Error(message), { statusCode, details });

const mockWaves: WavePlanItem[] = [
  {
    id: "wave-1",
    name: "Discovery & Arch Ingestion",
    waveNumber: 1,
    objective: "Index existing APIs and schemas",
    isCriticalPath: true,
    estimatedDurationHours: 12,
    optimisticHours: 8,
    realisticHours: 12,
    pessimisticHours: 16,
    deliverableBlueprint: "AST Schema Blueprint",
    acceptanceCriteria: ["API endpoints validated"],
    tasks: [{ id: "task-1", title: "Index specs", isComplete: true, estimatedHours: 4 }],
    assignee: {
      type: "agent",
      name: "Architecture Sentinel",
      role: "System Analyst",
      estimatedCostUsd: 1.5,
    },
    governance: {
      riskTier: "low",
      requiresDualSignOff: false,
      smtInvariants: ["Read-only telemetry"],
    },
  },
  {
    id: "wave-2",
    name: "Synthesis & Remediation",
    waveNumber: 2,
    objective: "Author technical specs in Scribe",
    isCriticalPath: false,
    estimatedDurationHours: 20,
    optimisticHours: 14,
    realisticHours: 20,
    pessimisticHours: 28,
    dependencies: ["wave-1"],
    deliverableBlueprint: "Scribe PRD",
    acceptanceCriteria: ["All critic lenses pass"],
    tasks: [{ id: "task-2", title: "Draft specs", isComplete: false, estimatedHours: 10 }],
    assignee: {
      type: "hybrid",
      name: "Lead Architect + Critic",
      role: "Lead Engineer / AI Pair",
      estimatedCostUsd: 3.5,
    },
    governance: {
      riskTier: "medium",
      requiresDualSignOff: true,
      smtInvariants: ["Dual approval"],
    },
  },
];

describe("ProjectStudio Module Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
  });

  it("renders Project Studio header, titles, and in-pod copilot bar", () => {
    render(
      <ProjectStudio
        title="Project Studio"
        projectTitle="SOC2 Automated Enforcement"
        waves={mockWaves}
      />
    );

    expect(screen.getByText("Project Studio")).toBeInTheDocument();
    expect(screen.getByText("SOC2 Automated Enforcement")).toBeInTheDocument();
    expect(screen.getByTestId("project-in-pod-copilot-bar")).toBeInTheDocument();
    expect(screen.getByText(/Project Copilot/i)).toBeInTheDocument();
  });

  it("renders dedicated Exit button and triggers onClose callback", () => {
    const onClose = vi.fn();
    render(
      <ProjectStudio
        title="Project Studio"
        waves={mockWaves}
        onClose={onClose}
      />
    );

    const exitBtn = screen.getByTestId("project-studio-exit-btn");
    expect(exitBtn).toBeInTheDocument();
    fireEvent.click(exitBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders Focus Studio toggle and triggers onToggleFocusMode callback", () => {
    const onToggleFocusMode = vi.fn();
    render(
      <ProjectStudio
        title="Project Studio"
        waves={mockWaves}
        isFocusMode={false}
        onToggleFocusMode={onToggleFocusMode}
      />
    );

    const focusBtn = screen.getByTitle("Expand Studio (Collapse Chat)");
    expect(focusBtn).toBeInTheDocument();
    fireEvent.click(focusBtn);
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
  });

  it("renders the Left Rail Sequence Spine with stations and critical path badge", () => {
    render(
      <ProjectStudio
        waves={mockWaves}
      />
    );

    const spine = screen.getByTestId("wave-sequence-spine");
    expect(spine).toBeInTheDocument();
    expect(screen.getAllByText("Discovery & Arch Ingestion").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Synthesis & Remediation").length).toBeGreaterThan(0);
    // Critical path flame badge on Wave 1
    expect(screen.getAllByText(/CP/i).length).toBeGreaterThan(0);
  });

  it("switches between all 3 Canvas tabs: Gantt, DAG, and Wave Living Canvas", () => {
    render(
      <ProjectStudio
        waves={mockWaves}
      />
    );

    // Default is Gantt
    expect(screen.getByTestId("horizon-gantt-timeline")).toBeInTheDocument();

    // Switch to Topological DAG
    const dagTab = screen.getByTestId("canvas-tab-dag");
    fireEvent.click(dagTab);
    expect(screen.getByTestId("topological-dag-view")).toBeInTheDocument();

    // Switch to Wave Living Canvas
    const wavesTab = screen.getByTestId("canvas-tab-waves");
    fireEvent.click(wavesTab);
    expect(screen.getByTestId("wave-living-canvas")).toBeInTheDocument();
  });

  it("switches between Right Rail Companion tabs: Inspector, Squad, and Governance", () => {
    render(
      <ProjectStudio
        waves={mockWaves}
      />
    );

    expect(screen.getByTestId("project-companion-dock")).toBeInTheDocument();
    // Default tab is Inspector
    expect(screen.getByTestId("inspector-panel")).toBeInTheDocument();

    // Switch to Squad tab
    const squadTab = screen.getByTestId("tab-squad");
    fireEvent.click(squadTab);
    expect(screen.getByTestId("squad-panel")).toBeInTheDocument();

    // Switch to Governance tab
    const govTab = screen.getByTestId("tab-governance");
    fireEvent.click(govTab);
    expect(screen.getByTestId("governance-panel")).toBeInTheDocument();
  });

  it("saves the plan for approval and reports success only with the server's cycle id", async () => {
    const onStageComplete = vi.fn();
    mockApiRequest.mockResolvedValueOnce(savedCycle());

    render(
      <ProjectStudio
        waves={mockWaves}
        onStageComplete={onStageComplete}
        defaultBudgetLimitUsd={500}
        sessionId="room-key-1"
      />
    );

    expect(screen.getByTestId("cycle-execution-dock")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));

    await waitFor(() => expect(onStageComplete).toHaveBeenCalled());

    const [method, url, body] = mockApiRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/cycles/plan-commit");
    // The old request sent cycleName/waves to /launch, which read name/blueprints.
    expect(body).toMatchObject({ projectTitle: expect.any(String), sessionKey: "room-key-1", budgetLimitUsd: 500 });
    expect(body.idempotencyKey).toMatch(/^plan-/);
    expect(body.waves[1].dependencies).toEqual(["wave-1"]);
    expect(body.waves[0].acceptanceCriteria).toEqual(["API endpoints validated"]);

    const payload = onStageComplete.mock.calls[0][0];
    expect(payload.cycle).toMatchObject({ cycleId: 77, status: "pending_approval" });
    expect(payload.waves.length).toBe(2);
    expect(payload._trace?.traceparent).toBeDefined();

    const notice = screen.getByTestId("plan-commit-notice");
    expect(notice).toHaveAttribute("data-kind", "saved");
    expect(notice).toHaveTextContent("awaiting approval");
    expect(screen.getByTestId("plan-commit-cycle-link")).toHaveAttribute("href", "/operations/cycles/77");
  });

  it("sends the rail's numeric room id as crewSessionId, not as a room key", async () => {
    mockApiRequest.mockResolvedValueOnce(savedCycle());
    render(<ProjectStudio waves={mockWaves} sessionId="42" />);
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    const body = mockApiRequest.mock.calls[0][2];
    expect(body.crewSessionId).toBe(42);
    expect(body).not.toHaveProperty("sessionKey");
  });

  it("prefers the room key over the numeric id, for both the save and Sync Crew Outline", async () => {
    mockApiRequest.mockResolvedValueOnce(savedCycle());
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ session: null }) });
    render(<ProjectStudio waves={mockWaves} sessionId="42" roomKey="crew-abc" />);

    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(mockApiRequest.mock.calls[0][2]).toMatchObject({ sessionKey: "crew-abc" });
    expect(mockApiRequest.mock.calls[0][2]).not.toHaveProperty("crewSessionId");

    fireEvent.click(screen.getByTestId("project-sync-crew-button"));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/crew/crew-abc"));
  });

  it("keeps unsaved edits across a remount of the same mount", () => {
    sessionStorage.clear();
    const first = render(<ProjectStudio waves={mockWaves} draftKey="room-a:project:3" />);
    fireEvent.click(screen.getByTestId("spine-add-wave-btn"));
    expect(screen.getByText(/3 waves/)).toBeInTheDocument();
    first.unmount();

    render(<ProjectStudio waves={mockWaves} draftKey="room-a:project:3" />);
    expect(screen.getByText(/3 waves/)).toBeInTheDocument();
  });

  it("reopens the plan a saved cycle came from instead of the example plan", async () => {
    sessionStorage.clear();
    mockApiRequest.mockResolvedValueOnce({
      json: async () => ({
        cycle: {
          id: 12, name: "Vendor Onboarding", objective: "Onboard a vendor", status: "pending_approval",
          budgetLimitUsd: "50.00", tokenLimit: 1000, executionPolicy: { maxParallelMissions: 1 },
          metadata: { targetSlaDays: 3, blueprints: [
            { name: "Collect documents", objective: "Gather W-9", type: "mission", dependencies: [],
              config: { waveId: "w-a", waveNumber: 1, assignee: { type: "agent", name: "A", role: "R" }, acceptanceCriteria: ["on file"] } },
            { name: "Sign-off", objective: "Approve", type: "milestone", dependencies: [{ blueprintName: "Collect documents", type: "finish_to_start" }],
              config: { waveId: "w-b", waveNumber: 2, assignee: { type: "human", name: "Lead", role: "Approver" } } },
          ] },
        },
      }),
    });
    render(<ProjectStudio cycleId={12} defaultWaves={[]} />);
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/cycles/12"));
    expect(await screen.findByText("Vendor Onboarding")).toBeInTheDocument();
    expect(screen.getByText(/2 waves/)).toBeInTheDocument();
  });

  it("says so, and shows no plan, for a cycle that was not saved from a wave plan", async () => {
    sessionStorage.clear();
    mockApiRequest.mockResolvedValueOnce({ json: async () => ({ cycle: { id: 13, name: "Legacy", status: "active", metadata: {} } }) });
    render(<ProjectStudio cycleId={13} defaultWaves={[]} />);
    expect(await screen.findByTestId("loaded-cycle-notice")).toHaveTextContent("not saved from a wave plan");
    expect(screen.getByText(/0 waves/)).toBeInTheDocument();
  });

  it("does not announce a save the server refused, and keeps the draft", async () => {
    const onStageComplete = vi.fn();
    mockApiRequest.mockRejectedValueOnce(httpError(403, "This action requires the 'editor' role on project 'ops'."));

    render(<ProjectStudio waves={mockWaves} onStageComplete={onStageComplete} />);
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));

    const notice = await screen.findByTestId("plan-commit-notice");
    expect(notice).toHaveAttribute("data-kind", "error");
    expect(notice).toHaveTextContent("Not saved: This action requires the 'editor' role");
    expect(onStageComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId("commit-launch-cycle-btn")).not.toBeDisabled();
  });

  it("retries an unconfirmed save with the same key, so the server can return the same cycle", async () => {
    const onStageComplete = vi.fn();
    mockApiRequest
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(savedCycle({ replayed: true }));

    render(<ProjectStudio waves={mockWaves} onStageComplete={onStageComplete} />);
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));

    expect(await screen.findByTestId("plan-commit-notice")).toHaveTextContent("retrying is safe");
    expect(onStageComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await waitFor(() => expect(onStageComplete).toHaveBeenCalledTimes(1));

    expect(mockApiRequest.mock.calls[1][2].idempotencyKey).toBe(mockApiRequest.mock.calls[0][2].idempotencyKey);
    expect(screen.getByTestId("plan-commit-notice")).toHaveTextContent("Already saved as cycle #77");
  });

  it("starts a new key when the plan is edited after a save", async () => {
    mockApiRequest.mockResolvedValueOnce(savedCycle()).mockResolvedValueOnce(savedCycle({ cycleId: 78 }));

    render(<ProjectStudio waves={mockWaves} />);
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await screen.findByTestId("plan-commit-notice");

    fireEvent.click(screen.getByTestId("spine-add-wave-btn"));
    await waitFor(() => expect(screen.queryByTestId("plan-commit-notice")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2));
    expect(mockApiRequest.mock.calls[1][2].idempotencyKey).not.toBe(mockApiRequest.mock.calls[0][2].idempotencyKey);
  });

  it("synchronizes blackboard outline into waves when clicking Sync Crew Outline", async () => {
    const roomContext = {
      plans: [
        {
          id: 101,
          title: "Scribe Technical Spec Writing",
          description: "Author complete PRD and architecture specification.",
          steps: [
            { text: "Draft problem statement", hours: 4, done: true },
            { text: "Compile OpenAPI contract", hours: 8, done: false },
          ],
        },
        {
          id: 102,
          title: "Canary Testing Deployment",
          description: "Deploy and probe canary runtime containers.",
          steps: [
            { text: "Run automated E2E tests", hours: 6, done: false },
          ],
        },
      ],
      decisions: [
        { id: 1, statement: "Use W3C distributed traceparent standard", status: "accepted" },
      ],
    };

    render(
      <ProjectStudio
        waves={mockWaves}
        roomContext={roomContext}
      />
    );

    const syncBtn = screen.getByTestId("project-sync-crew-button");
    expect(syncBtn).toBeInTheDocument();
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByTestId("sync-notice")).toBeInTheDocument();
    });

    expect(screen.getByText(/Synced 2 waves and 3 tasks from Crew Blackboard/i)).toBeInTheDocument();
    expect(screen.getAllByText("Scribe Technical Spec Writing").length).toBeGreaterThan(0);
  });

  it("navigates to studio when clicking Open in Studio button on WaveLivingCanvas", () => {
    const onNavigateStudio = vi.fn();
    const wavesWithStudio: WavePlanItem[] = [
      {
        ...mockWaves[0],
        studioTarget: "scribe",
      },
    ];

    render(
      <ProjectStudio
        waves={wavesWithStudio}
        onNavigateStudio={onNavigateStudio}
      />
    );

    // Switch to waves canvas
    const wavesTab = screen.getByTestId("canvas-tab-waves");
    fireEvent.click(wavesTab);

    const studioBtn = screen.getByTestId("open-studio-target-btn");
    expect(studioBtn).toBeInTheDocument();
    fireEvent.click(studioBtn);

    expect(onNavigateStudio).toHaveBeenCalledWith("scribe", {
      waveId: wavesWithStudio[0].id,
      title: wavesWithStudio[0].name,
    });
  });

  it("configures hybrid squad pairing with reviewer and sentinel in squad panel", async () => {
    render(
      <ProjectStudio
        waves={mockWaves}
      />
    );

    // Switch to squad tab
    const squadTab = screen.getByTestId("tab-squad");
    fireEvent.click(squadTab);

    // Select Reviewer agent
    const reviewerSelect = screen.getByTestId("reviewer-agent-select");
    expect(reviewerSelect).toBeInTheDocument();
    fireEvent.change(reviewerSelect, { target: { value: "agent-critic" } });

    // Select Sentinel agent
    const sentinelSelect = screen.getByTestId("sentinel-agent-select");
    expect(sentinelSelect).toBeInTheDocument();
    fireEvent.change(sentinelSelect, { target: { value: "agent-qa" } });

    // Switch to WaveLivingCanvas and verify critic & sentinel chips appear
    const wavesTab = screen.getByTestId("canvas-tab-waves");
    fireEvent.click(wavesTab);

    expect(screen.getByText(/Critic: Scribe Critic & Synthesis Lead/i)).toBeInTheDocument();
    expect(screen.getByText(/Sentinel: Canary Testing Supervisor/i)).toBeInTheDocument();
  });

  it("detects circular dependencies and displays cycle warning in execution dock", () => {
    const cyclicWaves: WavePlanItem[] = [
      {
        ...mockWaves[0],
        id: "wave-a",
        dependencies: ["wave-b"],
      },
      {
        ...mockWaves[1],
        id: "wave-b",
        dependencies: ["wave-a"],
      },
    ];

    render(
      <ProjectStudio
        waves={cyclicWaves}
      />
    );

    const warning = screen.getByTestId("cycle-detection-warning");
    expect(warning).toBeInTheDocument();
    expect(screen.getByText("Cycle Detected")).toBeInTheDocument();

    // Commit button should be disabled
    const commitBtn = screen.getByTestId("commit-launch-cycle-btn");
    expect(commitBtn).toBeDisabled();
  });

  it("approves and launches the fleet directly from Project Studio after saving", async () => {
    mockApiRequest
      .mockResolvedValueOnce(savedCycle({ cycleId: 77, status: "pending_approval" }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          cycle: { id: 77, status: "active" },
          blueprints: [{ name: mockWaves[0].name, status: "running" }],
        }),
      });

    render(<ProjectStudio waves={mockWaves} />);

    // 1. Save the plan
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    await screen.findByTestId("plan-commit-notice");

    // 2. Approve button should now appear in the dock
    const approveBtn = await screen.findByTestId("approve-launch-fleet-btn");
    expect(approveBtn).toBeInTheDocument();

    // 3. Click Approve & Launch
    fireEvent.click(approveBtn);
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/cycles/77/approve");
    });

    // 4. Verify Active status badge appears
    await screen.findByTestId("fleet-active-badge");
    expect(screen.getByTestId("fleet-active-badge")).toHaveTextContent("Fleet Active");
    expect(screen.getByTestId("pause-cycle-btn")).toBeInTheDocument();
  });

  it("supports pausing and resuming the running fleet in Project Studio", async () => {
    mockApiRequest
      .mockResolvedValueOnce(savedCycle({ cycleId: 77, status: "pending_approval" }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // approve
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // pause
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }); // resume

    render(<ProjectStudio waves={mockWaves} />);

    // Save and Approve
    fireEvent.click(screen.getByTestId("commit-launch-cycle-btn"));
    const approveBtn = await screen.findByTestId("approve-launch-fleet-btn");
    fireEvent.click(approveBtn);

    // Wait for Pause button
    const pauseBtn = await screen.findByTestId("pause-cycle-btn");
    fireEvent.click(pauseBtn);
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/cycles/77/pause");
    });

    // Paused badge & Resume button
    await screen.findByTestId("fleet-paused-badge");
    const resumeBtn = screen.getByTestId("resume-cycle-btn");
    fireEvent.click(resumeBtn);
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/cycles/77/resume");
    });
  });

  it("renders live wave runtime status badges in the DAG and Gantt views", () => {
    const runningWaves: WavePlanItem[] = [
      { ...mockWaves[0], runtimeStatus: "running" },
      { ...mockWaves[1], runtimeStatus: "completed" },
    ];

    render(<ProjectStudio waves={runningWaves} />);

    // Gantt view renders badges
    expect(screen.getByTestId(`gantt-runtime-${runningWaves[0].id}`)).toHaveTextContent("Running");
    expect(screen.getByTestId(`gantt-runtime-${runningWaves[1].id}`)).toHaveTextContent("Done");

    // Switch to DAG view
    fireEvent.click(screen.getByTestId("canvas-tab-dag"));
    expect(screen.getByTestId(`wave-runtime-${runningWaves[0].id}`)).toHaveTextContent("Running");
    expect(screen.getByTestId(`wave-runtime-${runningWaves[1].id}`)).toHaveTextContent("Done");
  });
});

