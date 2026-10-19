import React, { useEffect, useState } from 'react';
import { useModalBehavior } from "@/hooks/use-modal-behavior";
import { X, Settings2, Shield, DollarSign, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface RecruitingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const STORAGE_KEY = 'oddjob.agenticHr.recruitingConfig';

export const RecruitingConfigModal: React.FC<RecruitingConfigModalProps> = ({ isOpen, onClose, onSaved }) => {
  const panelRef = useModalBehavior<HTMLDivElement>({ isOpen, onClose });
  const [threshold, setThreshold] = useState(80);
  const [budget, setBudget] = useState(1000);
  const [forge, setForge] = useState(true);
  const [swarm, setSwarm] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      setThreshold(saved.threshold ?? 80);
      setBudget(saved.budget ?? 1000);
      setForge(saved.forge ?? true);
      setSwarm(saved.swarm ?? true);
    } catch { /* use defaults */ }
  }, [isOpen]);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-modal flex items-center justify-center animate-in fade-in duration-200">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recruiting configuration"
        className="bg-card border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-amber-500/5">
        
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Recruiting Configuration</h2>
              <p className="text-xs text-muted-foreground">Set parameters for autonomous agent acquisition.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-all"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          {/* Auto-Recruit Threshold */}
          <div className="space-y-2">
            <Label 
              htmlFor="auto-recruit-threshold"
              className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2"
            >
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              Auto-Recruit Threshold
            </Label>
            <div className="flex items-center gap-4">
              <input 
                id="auto-recruit-threshold"
                type="range" 
                min="50" 
                max="95" 
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
                className="flex-1 accent-amber-500"
                title="Auto-Recruit Threshold"
              />
              <span className="text-sm font-mono font-bold text-amber-500">{threshold}%</span>
            </div>
            <p className="text-[10px] text-muted-foreground">Recruit new agents when workforce reliability falls below this threshold.</p>
          </div>

          {/* Budget */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-amber-500" />
              Recruitment Budget
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input 
                type="number" 
                value={budget}
                onChange={(event) => setBudget(Math.max(0, Number(event.target.value)))}
                className="bg-background border-border pl-8 text-sm focus:border-amber-500 h-11"
              />
            </div>
            <p className="text-[10px] text-muted-foreground">Maximum budget allocated for agent acquisition per cycle.</p>
          </div>

          {/* Sourcing Channels */}
          <div className="space-y-3">
            <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-amber-500" />
              Sourcing Channels
            </Label>
            
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg hover:border-[#3f3f46] transition-all cursor-pointer">
                <div className="flex items-center gap-3">
                  <Checkbox id="channel-forge" checked={forge} onCheckedChange={(checked) => setForge(checked === true)} />
                  <div>
                    <label htmlFor="channel-forge" className="text-sm font-bold text-foreground cursor-pointer">Internal Forge</label>
                    <p className="text-[10px] text-muted-foreground">Synthesize agents using local LLMs.</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-emerald-500">LOW COST</span>
              </div>

              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg hover:border-[#3f3f46] transition-all cursor-pointer">
                <div className="flex items-center gap-3">
                  <Checkbox id="channel-swarm" checked={swarm} onCheckedChange={(checked) => setSwarm(checked === true)} />
                  <div>
                    <label htmlFor="channel-swarm" className="text-sm font-bold text-foreground cursor-pointer">Swarm Marketplace</label>
                    <p className="text-[10px] text-muted-foreground">Hire specialized agents from the network.</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-amber-500">MID COST</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex justify-between items-center bg-background">
          <div className="text-[10px] text-muted-foreground font-mono">
            STATUS: READY_TO_CONFIGURE
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={onClose}
              className="border-border hover:bg-card text-xs h-9"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ threshold, budget, forge, swarm }));
                onSaved?.();
                onClose();
              }}
              className="bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs h-9"
            >
              Save Configuration
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};
