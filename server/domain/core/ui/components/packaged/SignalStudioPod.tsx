import React from "react";
import ClientSignalStudioPod from "@/modules/signal-studio/SignalStudioPod";
import type { SignalStudioPodProps } from "@/modules/signal-studio/types";

/**
 * Signal Studio — signals, spatial rules, sources and industry packs, mounted
 * beside a CREW room.
 *
 * A pass-through: the client component owns the props.
 */
export function SignalStudioPod(props: SignalStudioPodProps) {
  return <ClientSignalStudioPod {...props} />;
}

export default SignalStudioPod;
