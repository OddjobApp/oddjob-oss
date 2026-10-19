import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

vi.mock("@/modules/agents/AgentStudio", () => ({
  AgentStudio: ({ onClose }: any) => <div data-testid="agent-studio-stub"><button onClick={onClose}>Close agent studio</button></div>,
}));

// Stub studios
vi.mock("@/modules/computer-studio/ComputerUseStudio", () => ({
  default: ({ title, onClose }: any) => (
    <div data-testid="computer-studio-stub" data-title={title}>
      <button onClick={() => onClose?.()}>Close computer studio</button>
    </div>
  ),
  ComputerUseStudio: ({ title, onClose }: any) => (
    <div data-testid="computer-studio-stub" data-title={title}>
      <button onClick={() => onClose?.()}>Close computer studio</button>
    </div>
  ),
}));
vi.mock("@/modules/project-studio/ProjectStudio", () => ({
  default: ({ title }: any) => <div data-testid="project-studio-stub" data-title={title} />,
  ProjectStudio: ({ title }: any) => <div data-testid="project-studio-stub" data-title={title} />,
}));
vi.mock("@/modules/forms/FormStudioPod", () => ({ default: () => <div data-testid="form-studio-stub" /> }));
vi.mock("@/modules/apps/AppStudioPod", () => ({ default: () => <div data-testid="app-studio-stub" /> }));
vi.mock("@/modules/scribe/ScribeStudioPod", () => ({ ScribeStudioPod: () => <div data-testid="scribe-studio-stub" /> }));

import { ModularAssemblyPuzzleRail } from "./ModularAssemblyPuzzleRail";

afterEach(cleanup);

const computerMount = (id: number, title = "Desktop Session") => ({
  id,
  artifacts: [
    {
      tool: "mount_computer_studio",
      payload: {
        type: "computer_studio_pod",
        module: "ComputerUseStudioPod",
        title,
      },
    },
  ],
});

const builderPodMount = (id: number) => ({
  id,
  artifacts: [
    {
      tool: "mount_builder_pod",
      payload: {
        type: "assistant_app",
        podComponent: "ComputerUseStudioPod",
        title: "Computer Use Studio",
      },
    },
  ],
});

const projectMount = (id: number, title = "CPM Mission Planner") => ({
  id,
  artifacts: [
    {
      tool: "mount_project_studio",
      payload: {
        type: "project_studio_pod",
        module: "ProjectStudioPod",
        title: "Project Studio",
        projectTitle: title,
      },
    },
  ],
});

function renderRail(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModularAssemblyPuzzleRail turns={[]} {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe("Computer Use Studio in the Assembler", () => {
  it("mounts the studio from a mount_computer_studio artifact", () => {
    renderRail({ turns: [computerMount(1, "Cloud Desktop")] });
    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();
    expect(screen.getByTestId("computer-studio-stub")).toHaveAttribute("data-title", "Cloud Desktop");
  });

  it("mounts the studio from a mount_builder_pod artifact naming ComputerUseStudioPod", () => {
    renderRail({ turns: [builderPodMount(1)] });
    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();
    expect(screen.getByTestId("computer-studio-stub")).toHaveAttribute("data-title", "Computer Use Studio");
  });

  it("handles closing the studio via onClose callback and internal visibility state", () => {
    const onExitComputerStudio = vi.fn();
    renderRail({ turns: [computerMount(1)], onExitComputerStudio });
    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Close computer studio"));
    expect(onExitComputerStudio).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("computer-studio-rail")).not.toBeInTheDocument();
  });

  it("wins arbitration and mounts when Computer Use Studio is mounted after an earlier Project Studio", () => {
    const projectTurn = projectMount(1, "Prior Project");
    const computerTurn = computerMount(2, "Active Desktop");

    renderRail({ turns: [projectTurn, computerTurn], isProjectStudioVisible: true, isComputerStudioVisible: true });

    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("project-studio-stub")).not.toBeInTheDocument();
  });

  it("wins arbitration and mounts when Computer Use Studio is mounted after an earlier Scribe Studio", () => {
    const scribeTurn = {
      id: 1,
      artifacts: [
        {
          tool: "mount_scribe_studio",
          payload: {
            type: "scribe_foundry_pod",
            module: "ScribeStudioPod",
            title: "Product Narrative",
          },
        },
      ],
    };
    const computerTurn = computerMount(2, "Active Desktop");

    renderRail({ turns: [scribeTurn, computerTurn], isScribeVisible: true, isComputerStudioVisible: true });

    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("scribe-studio-stub")).not.toBeInTheDocument();
  });

  it("yields arbitration when Project Studio is mounted after Computer Use Studio", () => {
    const computerTurn = computerMount(1, "Early Desktop");
    const projectTurn = projectMount(2, "Subsequent Project");

    renderRail({ turns: [computerTurn, projectTurn], isComputerStudioVisible: true, isProjectStudioVisible: true });

    expect(screen.getByTestId("project-studio-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("computer-studio-rail")).not.toBeInTheDocument();
  });
});

const agentMount = (id: number) => ({ id, artifacts: [{ tool: "mount_agent_studio", payload: { type: "agent_studio_pod", props: { agentId: 42 } } }] });

describe("Agent Studio arbitration", () => {
  it("opens over an older desktop and passes the close callback", () => {
    const close = vi.fn();
    renderRail({ turns: [computerMount(1), agentMount(2)], onExitAgentStudio: close });
    expect(screen.getByTestId("agent-studio-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("computer-studio-rail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Close agent studio"));
    expect(close).toHaveBeenCalledOnce();
  });
  it("yields to a newer desktop", () => {
    renderRail({ turns: [agentMount(1), computerMount(2)] });
    expect(screen.getByTestId("computer-studio-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-studio-stub")).not.toBeInTheDocument();
  });
  it("does not mount when dismissed", () => {
    renderRail({ turns: [agentMount(1)], isAgentStudioVisible: false });
    expect(screen.queryByTestId("agent-studio-stub")).not.toBeInTheDocument();
  });
});
