import React from "react";
import {
  CrewDecisionMatrixRail as ClientRail,
  type DecisionMatrixPayload,
  type DecisionCandidate,
  type DecisionCriterion,
  type PersonaStance,
} from "@/components/agent-chat/rails/CrewDecisionMatrixRail.js";
import DecisionMatrixPod, { type DecisionMatrixPodProps } from "./DecisionMatrixPod.js";

export type { DecisionMatrixPayload, DecisionCandidate, DecisionCriterion, PersonaStance };

export interface PackagedCrewDecisionMatrixRailProps extends Partial<DecisionMatrixPodProps> {
  data?: DecisionMatrixPayload;
  onAdoptRecommendation?: (candidate: DecisionCandidate) => void;
  onDiscussInChat?: (context: string) => void;
  className?: string;
  [key: string]: any;
}

/**
 * Packaged bridge for CrewDecisionMatrixRail.
 *
 * Ensures the component is resolvable through the packaged component registry
 * and InstantAppRenderer without "Component isn't available to render" errors.
 * Accepts both rail payload (`data`) and direct pod props (`candidates`, `criteria`, etc.).
 */
export function CrewDecisionMatrixRail(props: PackagedCrewDecisionMatrixRailProps) {
  // If structured data payload is supplied, render the client rail directly
  if (props.data) {
    return (
      <ClientRail
        data={props.data}
        onAdoptRecommendation={props.onAdoptRecommendation}
        onDiscussInChat={props.onDiscussInChat}
        className={props.className}
      />
    );
  }

  // If props are passed directly with candidates and criteria (e.g. from InstantAppRenderer)
  if (props.candidates && props.candidates.length > 0) {
    const payload: DecisionMatrixPayload = {
      topic: props.topic || "Decision Deliberation",
      candidates: props.candidates,
      criteria: props.criteria || [],
      personaStances: props.personaStances,
      recommendedCandidateId: props.recommendedCandidateId,
      consensusPercentage: props.consensusPercentage,
    };

    return (
      <ClientRail
        data={payload}
        onAdoptRecommendation={props.onAdoptRecommendation}
        onDiscussInChat={props.onDiscussInChat}
        className={props.className}
      />
    );
  }

  // Fallback to interactive DecisionMatrixPod when props are empty or require studio interaction
  return <DecisionMatrixPod {...(props as DecisionMatrixPodProps)} />;
}

export default CrewDecisionMatrixRail;
