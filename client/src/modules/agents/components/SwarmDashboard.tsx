/**
 * Swarm Dashboard
 * 
 * Visualize and manage multi-agent swarms with consensus tracking.
 */

import { useState } from "react";
import { useSwarms, useSwarm, useSwarmProposals } from "../hooks/use-swarm";
import { 
  Users, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Clock,
  Activity,
  Vote,
  MessageSquare
} from "lucide-react";
import { Progress } from "@domain-ui/core/ui/components/ui/progress";

interface SwarmCardProps {
  swarmId: string;
  onClick: () => void;
  isSelected: boolean;
}

const SwarmCard = ({ swarmId, onClick, isSelected }: SwarmCardProps) => {
  const { swarm } = useSwarm(swarmId);
  const { proposals, activeCount } = useSwarmProposals(swarmId);
  
  if (!swarm) return null;

  const statusColors = {
    forming: "bg-yellow-100 text-yellow-700",
    active: "bg-green-100 text-green-700",
    paused: "bg-muted text-foreground",
    dissolving: "bg-red-100 text-red-700",
    dissolved: "bg-muted text-muted-foreground",
  };

  return (
    <div 
      onClick={onClick}
      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-border hover:border-border'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold">{swarm.name}</h3>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[swarm.status]}`}>
          {swarm.status}
        </span>
      </div>
      
      <div className="text-sm text-muted-foreground mb-3">{swarm.goal || "No goal set"}</div>
      
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="w-4 h-4" />
          {swarm.agents.length} agents
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Vote className="w-4 h-4" />
          {activeCount} active proposals
        </div>
      </div>
    </div>
  );
};

interface ProposalCardProps {
  proposal: {
    id: string;
    type: string;
    status: string;
    votes: Array<[string, any]>;
    result?: any;
  };
}

const ProposalCard = ({ proposal }: ProposalCardProps) => {
  const statusIcons = {
    pending: <Clock className="w-5 h-5 text-yellow-500" />,
    accepted: <CheckCircle className="w-5 h-5 text-green-500" />,
    rejected: <XCircle className="w-5 h-5 text-red-500" />,
    disputed: <Activity className="w-5 h-5 text-orange-500" />,
    expired: <Clock className="w-5 h-5 text-muted-foreground" />,
  };

  const yesVotes = proposal.votes.filter(([_, v]) => v.value === "yes").length;
  const noVotes = proposal.votes.filter(([_, v]) => v.value === "no").length;

  return (
    <div className="p-4 bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {statusIcons[proposal.status as keyof typeof statusIcons]}
          <span className="font-medium capitalize">{proposal.type}</span>
        </div>
        <span className="text-xs text-muted-foreground">ID: {proposal.id.slice(0, 8)}</span>
      </div>
      
      <div className="flex items-center gap-4 mt-3">
        <div className="flex-1">
          <Progress 
            value={(yesVotes / (yesVotes + noVotes || 1)) * 100} 
            indicatorClassName="bg-green-500"
            className="h-2 bg-muted"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {yesVotes} Yes / {noVotes} No
        </div>
      </div>
    </div>
  );
};

export function SwarmDashboard() {
  const [selectedSwarmId, setSelectedSwarmId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const { data: swarms, isLoading } = useSwarms();
  const { swarm: selectedSwarm } = useSwarm(selectedSwarmId || "");
  const { proposals } = useSwarmProposals(selectedSwarmId || "");

  const handleCreateSwarm = async () => {
    setShowCreateModal(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Multi-Agent Swarms</h1>
          <p className="text-muted-foreground mt-1">Coordinate agents with consensus-based decision making</p>
        </div>
        <button
          onClick={handleCreateSwarm}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-foreground rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          Create Swarm
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Swarm List */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="font-semibold text-foreground mb-3">Active Swarms ({swarms?.length || 0})</h2>
          {swarms?.map((swarm: any) => (
            <SwarmCard
              key={swarm.id}
              swarmId={swarm.id}
              onClick={() => setSelectedSwarmId(swarm.id)}
              isSelected={selectedSwarmId === swarm.id}
            />
          ))}
          {!swarms?.length && (
            <div className="text-center p-8 text-muted-foreground bg-muted rounded-lg">
              <Users className="w-12 h-12 mx-auto mb-3 text-foreground" />
              <p>No swarms created yet</p>
              <button 
                onClick={handleCreateSwarm}
                className="mt-2 text-blue-600 hover:underline"
              >
                Create your first swarm
              </button>
            </div>
          )}
        </div>

        {/* Swarm Details */}
        <div className="lg:col-span-2">
          {selectedSwarm ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-card p-6 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedSwarm.name}</h2>
                    <p className="text-muted-foreground">{selectedSwarm.goal}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    selectedSwarm.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-foreground'
                  }`}>
                    {selectedSwarm.status}
                  </span>
                </div>

                {/* Agents */}
                <div className="mb-6">
                  <h3 className="font-semibold text-foreground mb-3">Agents ({selectedSwarm.agents.length})</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedSwarm.agents.map((agent: any) => (
                      <div key={agent.id} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                        <div className="w-2 h-2 bg-green-500 rounded-full" />
                        <span className="text-sm font-medium">{agent.role}</span>
                        <span className="text-xs text-muted-foreground">{agent.id.slice(0, 8)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-muted rounded-lg text-center">
                    <div className="text-2xl font-bold">{selectedSwarm.metrics.totalProposals}</div>
                    <div className="text-xs text-muted-foreground">Total Proposals</div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {selectedSwarm.metrics.acceptedProposals}
                    </div>
                    <div className="text-xs text-muted-foreground">Accepted</div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg text-center">
                    <div className="text-2xl font-bold">
                      {(selectedSwarm.metrics.avgConsensusTimeMs / 1000).toFixed(1)}s
                    </div>
                    <div className="text-xs text-muted-foreground">Avg Consensus Time</div>
                  </div>
                </div>
              </div>

              {/* Proposals */}
              <div>
                <h3 className="font-semibold text-foreground mb-3">Proposals ({proposals?.length || 0})</h3>
                <div className="space-y-3">
                  {proposals?.map((proposal: any) => (
                    <ProposalCard key={proposal.id} proposal={proposal} />
                  ))}
                  {!proposals?.length && (
                    <div className="text-center p-8 text-muted-foreground bg-muted rounded-lg">
                      <MessageSquare className="w-12 h-12 mx-auto mb-3 text-foreground" />
                      <p>No proposals yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-96 text-muted-foreground">
              <div className="text-center">
                <Users className="w-16 h-16 mx-auto mb-4" />
                <p className="text-lg">Select a swarm to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
