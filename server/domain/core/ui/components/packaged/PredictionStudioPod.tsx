import React from "react";
import ClientPredictionStudioPod from "@/modules/prediction-studio/PredictionStudioPod";
import type { PredictionStudioPodProps } from "@/modules/prediction-studio/types";

/**
 * Prediction Studio — surrogate models, an inference fan and drift readings.
 *
 * A pass-through: the client component owns the props, including the data props
 * it draws nothing without.
 */
export function PredictionStudioPod(props: PredictionStudioPodProps) {
  return <ClientPredictionStudioPod {...props} />;
}

export default PredictionStudioPod;
