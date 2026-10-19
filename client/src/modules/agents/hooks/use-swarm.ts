/**
 * Swarm System React Hooks
 * 
 * Frontend hooks for interacting with multi-agent swarms.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";

// Types
interface Swarm {
  id: string;
  name: string;
  organizationId: number;
  missionId?: number;
  status: "forming" | "active" | "paused" | "dissolving" | "dissolved";
  goal?: string;
  agents: Array<{
    id: string;
    role: string;
    status: string;
    joinedAt: string;
  }>;
  metrics: {
    totalProposals: number;
    acceptedProposals: number;
    resolvedConflicts: number;
    avgConsensusTimeMs: number;
  };
}

interface Proposal {
  id: string;
  swarmId: string;
  proposerId: string;
  type: string;
  payload: any;
  status: "pending" | "accepted" | "rejected" | "expired" | "disputed";
  algorithm: string;
  votes: Array<[string, { value: string; confidence: number; reasoning?: string }]>;
  result?: {
    accepted: boolean;
    yesVotes: number;
    noVotes: number;
    confidenceScore: number;
  };
  createdAt: string;
}

interface SwarmHealth {
  healthy: boolean;
  issues: string[];
  recommendations: string[];
}

interface SwarmMetrics {
  consensus: {
    totalProposals: number;
    accepted: number;
    rejected: number;
    disputed: number;
    expired: number;
    avgConfidence: number;
  };
  conflicts: {
    totalConflicts: number;
    resolved: number;
    escalated: number;
    failed: number;
  };
  composition: {
    totalAgents: number;
    roleDistribution: Record<string, number>;
    avgConfidence: number;
  };
}

// API Functions
async function fetchSwarms(): Promise<Swarm[]> {
  const res = await fetch("/api/swarms", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch swarms");
  const data = await res.json();
  return data.swarms;
}

async function fetchSwarm(swarmId: string): Promise<Swarm> {
  const res = await fetch(`/api/swarms/${swarmId}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch swarm");
  return res.json();
}

async function createSwarm(data: {
  name: string;
  missionId?: number;
  goal?: string;
}): Promise<Swarm> {
  const res = await fetch("/api/swarms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create swarm");
  return res.json();
}

async function joinSwarm(
  swarmId: string,
  agentId: string,
  role?: string
): Promise<Swarm> {
  const res = await fetch(`/api/swarms/${swarmId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ agentId, role, autoAssignRole: !role }),
  });
  if (!res.ok) throw new Error("Failed to join swarm");
  return res.json();
}

async function fetchProposals(swarmId: string): Promise<Proposal[]> {
  const res = await fetch(`/api/swarms/${swarmId}/proposals`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch proposals");
  const data = await res.json();
  return data.proposals;
}

async function createProposal(
  swarmId: string,
  data: {
    proposerId: string;
    type: string;
    payload: any;
    algorithm?: string;
    timeoutMs?: number;
  }
): Promise<Proposal> {
  const res = await fetch(`/api/swarms/${swarmId}/proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create proposal");
  return res.json();
}

async function submitVote(
  swarmId: string,
  proposalId: string,
  data: {
    agentId: string;
    value: "yes" | "no" | "abstain";
    confidence?: number;
    reasoning?: string;
  }
): Promise<Proposal> {
  const res = await fetch(`/api/swarms/${swarmId}/proposals/${proposalId}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to submit vote");
  return res.json();
}

async function fetchHealth(swarmId: string): Promise<SwarmHealth> {
  const res = await fetch(`/api/swarms/${swarmId}/health`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch health");
  return res.json();
}

async function fetchMetrics(swarmId: string): Promise<SwarmMetrics> {
  const res = await fetch(`/api/swarms/${swarmId}/metrics`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch metrics");
  return res.json();
}

async function readBlackboard(
  swarmId: string,
  namespace: string,
  key: string
): Promise<any> {
  const res = await fetch(
    `/api/swarms/${swarmId}/blackboard/${namespace}/${key}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error("Failed to read blackboard");
  const data = await res.json();
  return data.value;
}

async function writeBlackboard(
  swarmId: string,
  namespace: string,
  data: { agentId: string; key: string; value: any }
): Promise<{ version: number }> {
  const res = await fetch(`/api/swarms/${swarmId}/blackboard/${namespace}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to write to blackboard");
  return res.json();
}

// ============================================================================
// React Hooks
// ============================================================================

export function useSwarms() {
  return useQuery({
    queryKey: ["swarms"],
    queryFn: fetchSwarms,
  });
}

export function useSwarm(swarmId: string) {
  const queryClient = useQueryClient();

  const { data: swarm, isLoading } = useQuery({
    queryKey: ["swarm", swarmId],
    queryFn: () => fetchSwarm(swarmId),
    enabled: !!swarmId,
  });

  const createMutation = useMutation({
    mutationFn: createSwarm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swarms"] });
    },
  });

  const joinMutation = useMutation({
    mutationFn: (data: { agentId: string; role?: string }) =>
      joinSwarm(swarmId, data.agentId, data.role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swarm", swarmId] });
    },
  });

  return {
    swarm,
    isLoading,
    createSwarm: createMutation.mutateAsync,
    joinSwarm: joinMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isJoining: joinMutation.isPending,
  };
}

export function useSwarmProposals(swarmId: string) {
  const queryClient = useQueryClient();

  const { data: proposals, isLoading } = useQuery({
    queryKey: ["swarm", swarmId, "proposals"],
    queryFn: () => fetchProposals(swarmId),
    enabled: !!swarmId,
    refetchInterval: 5000, // Poll every 5s for active proposals
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createProposal>[1]) =>
      createProposal(swarmId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["swarm", swarmId, "proposals"],
      });
    },
  });

  const voteMutation = useMutation({
    mutationFn: (data: {
      proposalId: string;
      agentId: string;
      value: "yes" | "no" | "abstain";
      confidence?: number;
      reasoning?: string;
    }) => submitVote(swarmId, data.proposalId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["swarm", swarmId, "proposals"],
      });
    },
  });

  const activeCount =
    proposals?.filter((p) => p.status === "pending").length ?? 0;

  return {
    proposals,
    isLoading,
    activeCount,
    createProposal: createMutation.mutateAsync,
    vote: voteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isVoting: voteMutation.isPending,
  };
}

export function useSwarmHealth(swarmId: string) {
  return useQuery({
    queryKey: ["swarm", swarmId, "health"],
    queryFn: () => fetchHealth(swarmId),
    enabled: !!swarmId,
    refetchInterval: 30000, // Check health every 30s
  });
}

export function useSwarmMetrics(swarmId: string) {
  return useQuery({
    queryKey: ["swarm", swarmId, "metrics"],
    queryFn: () => fetchMetrics(swarmId),
    enabled: !!swarmId,
    refetchInterval: 60000, // Update metrics every minute
  });
}

export function useBlackboard(
  swarmId: string,
  namespace: string = "shared"
) {
  const queryClient = useQueryClient();
  const [subscriptions, setSubscriptions] = useState<Set<string>>(new Set());

  const read = useCallback(
    async (key: string) => {
      return readBlackboard(swarmId, namespace, key);
    },
    [swarmId, namespace]
  );

  const write = useCallback(
    async (agentId: string, key: string, value: any) => {
      const result = await writeBlackboard(swarmId, namespace, {
        agentId,
        key,
        value,
      });
      queryClient.invalidateQueries({
        queryKey: ["blackboard", swarmId, namespace, key],
      });
      return result;
    },
    [swarmId, namespace, queryClient]
  );

  const useKey = (key: string) => {
    return useQuery({
      queryKey: ["blackboard", swarmId, namespace, key],
      queryFn: () => readBlackboard(swarmId, namespace, key),
      enabled: !!swarmId && !!key,
    });
  };

  // Subscribed keys are refreshed by their individual useQuery refetchInterval settings

  const subscribe = useCallback((key: string) => {
    setSubscriptions((prev) => new Set([...prev, key]));
    return () => {
      setSubscriptions((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };
  }, []);

  return {
    read,
    write,
    useKey,
    subscribe,
  };
}

export function useSwarmDashboard(swarmId: string) {
  const { swarm, isLoading: isLoadingSwarm } = useSwarm(swarmId);
  const { proposals, activeCount, isLoading: isLoadingProposals } =
    useSwarmProposals(swarmId);
  const { data: health } = useSwarmHealth(swarmId);
  const { data: metrics } = useSwarmMetrics(swarmId);

  const consensusRate =
    metrics && metrics.consensus.totalProposals > 0
      ? metrics.consensus.accepted / metrics.consensus.totalProposals
      : 0;

  const conflictRate =
    metrics && metrics.conflicts.totalConflicts > 0
      ? metrics.conflicts.escalated / metrics.conflicts.totalConflicts
      : 0;

  return {
    swarm,
    proposals,
    health,
    metrics,
    stats: {
      consensusRate,
      conflictRate,
      activeProposals: activeCount,
      totalAgents: swarm?.agents.length ?? 0,
      healthy: health?.healthy ?? false,
    },
    isLoading: isLoadingSwarm || isLoadingProposals,
  };
}
