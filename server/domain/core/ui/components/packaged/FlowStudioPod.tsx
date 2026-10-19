import React from "react";
import ClientFlowStudioPod from "@/modules/flows/FlowStudioPod";
import type { FlowStudioPodProps } from "@/modules/flows/types";

/**
 * Flow Studio — build a flow from the jobs an organization already has, and
 * open one that exists.
 *
 * A pass-through, deliberately. Re-declaring the props here is how a shim drifts
 * from the component it fronts; taking the client's own type means it cannot.
 */
export function FlowStudioPod(props: FlowStudioPodProps) {
  return <ClientFlowStudioPod {...props} />;
}

export default FlowStudioPod;
