
import React, { useState } from 'react';
import { 
  UserCircle2, 
  History, 
  Award, 
  FileText, 
  Search,
  Star,
  Settings2,
  ExternalLink,
  ChevronRight,
  Fingerprint,
  AlertTriangle,
  Bot
} from 'lucide-react';
import { useAgenticHR, AgentWorkforceMember, UpskillingCandidate } from '../hooks/use-agentic-hr';
import { RecruitingConfigModal } from "./RecruitingConfigModal";
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useLocation } from 'wouter';

const AgentCard = ({ agent, isSelected, onClick }: any) => (
  <div 
    onClick={onClick}
    className={`p-4 rounded-xl border cursor-pointer transition-all ${
      isSelected 
        ? 'bg-card border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.1)]' 
        : 'bg-background border-border hover:border-[#3f3f46]'
    }`}
  >
    <div className="flex items-center gap-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isSelected ? 'bg-amber-500/20 text-amber-500' : 'bg-card text-muted-foreground'}`}>
        <Fingerprint className="w-6 h-6" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-sm truncate">{agent.name}</h3>
        <p className="text-xs text-muted-foreground truncate">{agent.archetype}</p>
      </div>
      <div className="text-right">
        <div className="text-xs font-bold text-emerald-500">{agent.reliability}%</div>
        <div className="text-[10px] text-muted-foreground">Reliability</div>
      </div>
    </div>
  </div>
);

export const AgenticHR: React.FC = () => {
  const { workforce, usePortfolio, isLoading: isWorkforceLoading, candidates, error, startUpskilling, isUpskilling } = useAgenticHR();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedAgentId, setSelectedAgentId] = useState<number | undefined>(undefined);
  const [isRecruitingModalOpen, setIsRecruitingModalOpen] = useState(false);
  const { data: portfolio, isLoading: isPortfolioLoading } = usePortfolio(selectedAgentId);
  const [view, setView] = useState<'legend' | 'cv'>('legend');
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase().replace(/^#/, '');
  const filteredWorkforce = workforce.filter(agent => !normalizedSearch || [agent.title, agent.soulArchetype, agent.slug]
    .some(value => String(value || '').toLowerCase().includes(normalizedSearch)));

  // Auto-select first agent
  React.useEffect(() => {
    if (workforce.length > 0 && !selectedAgentId) {
      setSelectedAgentId(workforce[0].id);
    }
  }, [workforce, selectedAgentId]);

  if (isWorkforceLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground font-mono text-xs animate-pulse tracking-[0.3em]">RECALLING AGENT RECORDS...</div>
      </div>
    );
  }

  if (error) {
    return <div role="alert" className="m-8 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Agentic HR data could not be loaded. Please refresh and try again.</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <UserCircle2 className="w-4 h-4" />
              <span className="text-xs font-bold tracking-[0.2em] uppercase">Human Resources for Agents</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight">AGENTIC HR</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search by #topic or concept..." 
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-card border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-amber-500 w-64 transition-all"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Agent Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-2">Active Workforce</h2>
            <div className="space-y-2">
              {filteredWorkforce.map((agent: AgentWorkforceMember) => (
                <AgentCard 
                  key={agent.id} 
                  agent={{
                    name: agent.title,
                    archetype: agent.soulArchetype,
                    reliability: agent.reliability ?? 100
                  }} 
                  isSelected={selectedAgentId === agent.id} 
                  onClick={() => setSelectedAgentId(agent.id)} 
                />
              ))}
              {filteredWorkforce.length === 0 && <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No agents match “{search}”.</div>}
            </div>
            <button 
              onClick={() => setIsRecruitingModalOpen(true)}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 bg-card border border-border rounded-xl text-sm font-bold hover:bg-muted transition-all"
            >
              <Settings2 className="w-4 h-4" />
              Configure Recruiting
            </button>

            {/* Upskilling Alerts */}
            {candidates.length > 0 && (
              <div className="mt-8 space-y-4">
                <h2 className="text-xs font-bold text-rose-500 uppercase tracking-widest px-2 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" />
                  Performance Debt
                </h2>
                {candidates.map((candidate: UpskillingCandidate) => (
                  <div key={candidate.agentId} className="p-4 bg-rose-500/5 border border-rose-500/20 rounded-xl">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold text-xs">{candidate.title}</div>
                      <div className="text-[10px] text-rose-500 font-mono">{candidate.reliability}% RELIABILITY</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mb-3">
                      {candidate.failureCount} recent friction points detected.
                    </div>
                    <button 
                      disabled={isUpskilling}
                      onClick={async () => {
                        try {
                          await startUpskilling(candidate.agentId);
                          toast({ title: "Upskilling Initiated", description: `Started upskilling program for ${candidate.title}.` });
                        } catch (cause: any) {
                          toast({ title: "Upskilling failed", description: cause?.message || "Please try again.", variant: "destructive" });
                        }
                      }}
                      className="w-full py-1.5 bg-rose-500 text-foreground text-[10px] font-black rounded uppercase hover:bg-rose-600 transition-colors"
                    >
                      START UPSKILLING
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agent Portfolio View */}
          <div className="lg:col-span-3">
            {isPortfolioLoading ? (
               <div className="h-full bg-card border border-border rounded-2xl flex items-center justify-center">
                 <div className="text-amber-500/50 font-mono text-xs animate-pulse">SYNTHESIZING PORTFOLIO...</div>
               </div>
            ) : portfolio ? (
              <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
                
                {/* Agent Hero */}
                <div className="p-8 border-b border-border bg-gradient-to-br from-card to-background">
                  <div className="flex items-start justify-between mb-8">
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.05)]">
                        <Fingerprint className="w-10 h-10" />
                      </div>
                      <div>
                        <h2 className="text-3xl font-black">{portfolio.name}</h2>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider rounded border border-amber-500/20">
                            {portfolio.archetype}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Member since {portfolio.createdAt ? new Date(portfolio.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'date unavailable'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigate(`/operations/agents/${portfolio.id}`)}
                        className="p-2 bg-muted rounded-lg hover:bg-[#3f3f46] transition-colors"
                        title="View External Profile"
                        aria-label="View External Profile"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button onClick={() => navigate(`/operations/missions/new?agentId=${portfolio.id}&agentName=${encodeURIComponent(portfolio.name)}`)} className="px-4 py-2 bg-amber-500 text-black font-bold rounded-lg text-xs hover:bg-amber-600 transition-colors">
                        ASSIGN MISSION
                      </button>
                    </div>
                  </div>

                  {/* View Toggles */}
                  <div className="flex gap-8 border-b border-border">
                    <button 
                      onClick={() => setView('legend')}
                      className={`pb-4 text-sm font-bold transition-all relative ${view === 'legend' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      THE LEGEND
                      {view === 'legend' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-amber-500" />}
                    </button>
                    <button 
                      onClick={() => setView('cv')}
                      className={`pb-4 text-sm font-bold transition-all relative ${view === 'cv' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      PORTFOLIO (CV)
                      {view === 'cv' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-amber-500" />}
                    </button>
                  </div>
                </div>

                {/* View Content */}
                <div className="p-8 min-h-[400px]">
                  {view === 'legend' ? (
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2 text-amber-500/50 mb-6">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Autonomous Narrative</span>
                      </div>
                      <p className="text-xl font-serif italic text-muted-foreground leading-relaxed">
                        "{portfolio.legend || "No legend evolved yet. This agent's story is still being written..."}"
                      </p>
                      
                      <div className="mt-12 grid grid-cols-2 gap-8">
                        <div>
                          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Core Philosophy</h4>
                          <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3 text-amber-500" /> Immutable logic over rapid iteration</li>
                            <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3 text-amber-500" /> Exhaustive verification of all tool outputs</li>
                            <li className="flex items-center gap-2"><ChevronRight className="w-3 h-3 text-amber-500" /> Semantic clarity in knowledge propagation</li>
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Mastered Concepts</h4>
                          <div className="flex flex-wrap gap-2">
                            {['#React', '#TypeScript', '#Architecture', '#NodeJS', '#Redis'].map(tag => (
                              <span key={tag} className="px-2 py-1 bg-muted text-muted-foreground text-[10px] rounded hover:text-foreground transition-colors cursor-pointer">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-2 text-blue-400/50">
                          <History className="w-4 h-4" />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Mission Timeline</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{(Array.isArray(portfolio.cv) ? portfolio.cv : []).length} Achievements in QMD</span>
                      </div>

                      {(Array.isArray(portfolio.cv) ? portfolio.cv : []).map((achievement: any, i: number) => (
                        <div key={i} className="group p-6 bg-background border border-border rounded-xl hover:border-blue-500/30 transition-all cursor-pointer">
                          <div className="flex items-start justify-between mb-4">
                            <div>
                              <div className="text-[10px] font-mono text-muted-foreground mb-1">{new Date(achievement.createdAt).toLocaleDateString()}</div>
                              <h4 className="font-bold text-lg group-hover:text-blue-400 transition-colors">{achievement.title}</h4>
                            </div>
                            <div className="p-2 rounded bg-blue-500/10 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <FileText className="w-4 h-4" />
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex gap-2">
                              {(achievement.tags || []).map((tag: string) => (
                                <span key={tag} className="text-[10px] text-muted-foreground">{tag}</span>
                              ))}
                            </div>
                            <div className="w-1 h-1 bg-muted rounded-full" />
                            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                              SUCCESSFUL MISSION
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {(Array.isArray(portfolio.cv) ? portfolio.cv : []).length === 0 && (
                        <div className="p-12 text-center border-2 border-dashed border-border rounded-2xl text-muted-foreground">
                          No mission achievements recorded yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full border-2 border-dashed border-border rounded-2xl flex items-center justify-center text-muted-foreground">
                Select an agent to view their professional legend.
              </div>
            )}
          </div>

        </div>
        
        <RecruitingConfigModal 
          isOpen={isRecruitingModalOpen} 
          onClose={() => setIsRecruitingModalOpen(false)} 
          onSaved={() => toast({ title: "Recruiting configuration saved", description: "Your recruiting thresholds and channels will be restored on this device." })}
        />
      </div>
    </div>
  );
};
