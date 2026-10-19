import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@domain-ui/core/ui/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  ShieldCheck,
  Zap,
  Bot,
  Database,
  Globe,
  Layers,
  Sparkles,
  GitBranch,
  Copy,
  CheckCircle2,
  Lock,
  FileCode,
  Smartphone
} from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { type Blueprint, MATURITY_INFO } from './BlueprintGallery';

interface BlueprintDetailModalProps {
  blueprint: Blueprint | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (slug: string) => void;
  onCloneSuccess?: (draft: any) => void;
}

export function BlueprintDetailModal({
  blueprint,
  isOpen,
  onClose,
  onSelect,
  onCloneSuccess
}: BlueprintDetailModalProps) {
  const { toast } = useToast();
  const [isCloning, setIsCloning] = useState(false);

  if (!blueprint) return null;

  const handleClone = async () => {
    setIsCloning(true);
    try {
      const response = await fetch(`/api/apps/blueprints/${blueprint.slug}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          customName: `${blueprint.name} (Workspace Instance)`,
          objective: blueprint.description
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to clone blueprint');
      }

      toast({
        title: 'Blueprint Cloned!',
        description: `Created new draft '${payload.draft.name}' ready for Forge customization.`
      });

      if (onCloneSuccess) {
        onCloneSuccess(payload.draft);
      }
      onSelect(blueprint.slug);
      onClose();
    } catch (err: any) {
      toast({
        title: 'Clone failed',
        description: err.message || 'Unable to clone blueprint instance',
        variant: 'destructive'
      });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-5">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-wider">
                {blueprint.category}
              </Badge>
              {blueprint.persona && (
                <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                  Persona: {blueprint.persona}
                </Badge>
              )}
            </div>
            {blueprint.governanceRisk && (
              <Badge
                variant="outline"
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  blueprint.governanceRisk === 'high'
                    ? 'border-destructive/40 text-destructive bg-destructive/10'
                    : blueprint.governanceRisk === 'medium'
                    ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
                    : 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                }`}
              >
                <Shield className="w-3 h-3 mr-1" />
                {blueprint.governanceRisk} Risk Gate
              </Badge>
            )}
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight mt-2 flex items-center gap-2">
            {blueprint.name}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            {blueprint.description}
          </DialogDescription>
        </DialogHeader>

        {/* Maturity Banner */}
        {(() => {
          const info = MATURITY_INFO[blueprint.maturity ?? "experimental"];
          return (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5 flex items-start gap-3" data-testid="blueprint-maturity-banner">
              <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">Maturity</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${info.className}`}>
                    {info.label}
                  </span>
                </div>
                <p className="text-muted-foreground leading-relaxed">{info.description}</p>
              </div>
            </div>
          );
        })()}

        {/* Capabilities Grid */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Capabilities & Data Connectors</h4>
          <div className="flex flex-wrap gap-2">
            {blueprint.capabilities?.map((cap) => (
              <Badge key={cap} variant="secondary" className="px-2.5 py-1 text-xs font-mono flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                {cap}
              </Badge>
            ))}
          </div>
        </div>

        {/* Architecture Spec & Operational Roles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs">
          <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Layers className="w-4 h-4 text-primary" />
              <span>Execution Affordances</span>
            </div>
            <p className="text-muted-foreground">
              Directly exposes operational API routes, state reconciliation heartbeats, and autonomous background worker listeners.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <GitBranch className="w-4 h-4 text-primary" />
              <span>Cycle Orchestration Binding</span>
            </div>
            <p className="text-muted-foreground">
              Compatible with Finish-to-Start (FS) Cycle stages, HIL decision checkpoints, and rolling wave fan-out.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClone}
              disabled={isCloning}
            >
              <Copy className="w-4 h-4 mr-1.5" />
              {isCloning ? 'Cloning…' : 'Fork / Clone Instance'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSelect(blueprint.slug);
                onClose();
              }}
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Select in App Forge
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
