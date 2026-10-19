import { Redis } from 'ioredis';
import { MoltProducer } from './molt-producer.js';
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { GovernancePolicyService } from './governance-policy.service.js';

interface Vote {
    agent: string;
    confidence: number;
    reasoning: string;
    timestamp: number;
}

interface ProposalState {
    proposalId: string;
    command: string;
    startTime: number;
    votes: Record<string, Vote>; // Record instead of Map for JSON serialization
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    traceContext?: TraceContext;
    missionId?: number;
}

export class SynthesisNode {
    private redis: Redis;
    private sessionId: string;
    private streamKey: string;
    private moltProducer: MoltProducer;
    private readonly PROPOSAL_TTL = 86400; // 24 hours

    constructor(sessionId: string, moltProducer: MoltProducer, redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
        this.sessionId = sessionId;
        this.moltProducer = moltProducer;
        this.redis = new Redis(redisUrl);
        this.streamKey = `molt:events`; // Unified with MoltProducer.streamKey
    }

    private getProposalKey(proposalId: string): string {
        return `oddjob:governor:proposal:${proposalId}`;
    }

    private async saveProposal(proposal: ProposalState) {
        await this.redis.set(
            this.getProposalKey(proposal.proposalId), 
            JSON.stringify(proposal), 
            'EX', this.PROPOSAL_TTL
        );
    }

    private async getProposal(proposalId: string): Promise<ProposalState | null> {
        const data = await this.redis.get(this.getProposalKey(proposalId));
        return data ? JSON.parse(data) : null;
    }

    async start() {
        console.log(`[SynthesisNode] Starting for session ${this.sessionId}`);

        let lastId = '0'; // Start from beginning to recover missed events on restart
        
        // Find the last processed ID for this session/node if we want to be more efficient
        // For now, starting from 0 and skipping non-pending works for durable recoverability

        while (true) {
            try {
                const response = await this.redis.xread('BLOCK', 2000, 'STREAMS', this.streamKey, lastId);

                if (response) {
                    const [streamName, messages] = response[0];
                    for (const [id, fields] of messages) {
                        lastId = id;
                        await this.processMessage(id, fields);
                    }
                }

                this.checkTimeouts();

            } catch (error) {
                console.error("[SynthesisNode] Error reading stream:", error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    private async processMessage(id: string, fields: string[]) {
        const fieldMap = new Map<string, string>();
        for (let i = 0; i < fields.length; i += 2) {
            fieldMap.set(fields[i], fields[i + 1]);
        }

        const type = fieldMap.get('type');
        const payloadStr = fieldMap.get('payload');
        const signature = fieldMap.get('signature');
        const timestamp = fieldMap.get('timestamp');
        const msgSessionId = fieldMap.get('sessionId');
        const traceparent = fieldMap.get('traceparent');
        const tracestate = fieldMap.get('tracestate');

        // Only process messages for our session
        if (msgSessionId !== this.sessionId) return;
        if (!payloadStr || !type || !timestamp) return;

        const payload = JSON.parse(payloadStr);

        // Security Check: Enforce Signature
        if (!signature || !this.moltProducer.verify(type, payload, timestamp, signature)) {
            console.warn(`[SynthesisNode] REJECTED: Invalid or missing signature for message ${id}.`);
            return;
        }

        if (type === 'PROPOSAL') {
            const existing = await this.getProposal(id);
            if (!existing) {
                console.log(`[SynthesisNode] Registered Proposal: ${id} - ${payload.command}`);
                
                let traceContext: TraceContext | undefined;
                if (traceparent) {
                    traceContext = {
                        traceId: traceparent,
                        spanId: tracestate || '',
                        parentSpanId: '',
                        traceFlags: '01',
                        depth: 0
                    };
                }

                await this.saveProposal({
                    proposalId: id,
                    command: payload.command,
                    startTime: Date.now(),
                    votes: {},
                    status: 'PENDING',
                    traceContext,
                    missionId: payload.context?.missionId || this.moltProducer.getMissionId()
                });
            }
        }
        else if (type === 'VOTE') {
            const { proposalId, agent, confidence, reasoning } = payload;
            const proposal = await this.getProposal(proposalId);

            if (proposal && proposal.status === 'PENDING') {
                proposal.votes[agent] = {
                    agent, confidence, reasoning, timestamp: Date.now()
                };
                console.log(`[SynthesisNode] Vote recorded for ${proposalId} from ${agent}: ${confidence}`);
                await this.saveProposal(proposal);

                await this.evaluateConsensus(proposal);
            }
        }
    }

    private async evaluateConsensus(proposal: ProposalState) {
        // Resolve mission context and policy
        const missionId = proposal.missionId;
        const tier = missionId ? await GovernancePolicyService.resolveTierForRun(missionId) : 'standard';
        const policy = GovernancePolicyService.getPolicy(tier);

        // 1. Check for Immediate Veto (Critic W-2)
        const criticVote = proposal.votes['W-2'];
        if (criticVote && criticVote.confidence < policy.vetoThreshold) {
            console.warn(`[SynthesisNode] VETO TRIGGERED by Critic for ${proposal.proposalId} (${policy.tier})`);
            await this.finalizeDecision(proposal, false, `Vetoed by Critic: ${criticVote.reasoning}`);
            return;
        }

        // 2. Check if we have all votes
        const requiredAgents = Object.keys(policy.weights);
        const receivedAgents = Object.keys(proposal.votes);
        const missingAgents = requiredAgents.filter(a => !receivedAgents.includes(a));

        if (missingAgents.length === 0) {
            // All votes in. Calculate weighted score.
            let totalScore = 0;
            let totalWeight = 0;

            for (const agent of requiredAgents) {
                const vote = proposal.votes[agent];
                const weight = policy.weights[agent] || 0;
                totalScore += vote.confidence * weight;
                totalWeight += weight;
            }

            const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
            console.log(`[SynthesisNode] Consensus Score for ${proposal.proposalId} (${policy.tier}): ${finalScore.toFixed(3)}`);

            if (finalScore >= policy.consensusThreshold) {
                await this.finalizeDecision(proposal, true, `Consensus Reached (${policy.tier}): ${finalScore.toFixed(3)}`);
            } else {
                await this.finalizeDecision(proposal, false, `Consensus Failed (${policy.tier}): ${finalScore.toFixed(3)} < ${policy.consensusThreshold}`);
            }
        }
    }

    private async finalizeDecision(proposal: ProposalState, approved: boolean, reason: string) {
        proposal.status = approved ? 'APPROVED' : 'REJECTED';
        await this.saveProposal(proposal);

        // Publish DECISION
        await this.moltProducer.publish('DECISION', {
            proposalId: proposal.proposalId,
            command: proposal.command,
            approved,
            reason
        }, proposal.traceContext);

        console.log(`[SynthesisNode] Decision Published: ${approved ? 'APPROVED' : 'REJECTED'} - ${reason}`);
    }

    private async checkTimeouts() {
        const now = Date.now();
        const keys = await this.redis.keys('oddjob:governor:proposal:*');
        for (const key of keys) {
            const data = await this.redis.get(key);
            if (data) {
                const proposal = JSON.parse(data) as ProposalState;
                if (proposal.status === 'PENDING') {
                    const tier = proposal.missionId ? await GovernancePolicyService.resolveTierForRun(proposal.missionId) : 'standard';
                    const policy = GovernancePolicyService.getPolicy(tier);
                    
                    if (now - proposal.startTime > policy.timeoutMs) {
                        console.warn(`[SynthesisNode] Proposal ${proposal.proposalId} timed out (${policy.tier}).`);
                        await this.finalizeDecision(proposal, false, `Synthesis Timeout (${policy.tier}): Missing votes.`);
                    }
                }
            }
        }
    }
}
