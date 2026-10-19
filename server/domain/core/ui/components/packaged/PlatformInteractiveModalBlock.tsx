import React, { useState } from "react";
import { Layers, Maximize2, PanelRight, Info, ShieldAlert, Sparkles, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter 
} from "../ui/dialog.js";
import { 
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger 
} from "../ui/sheet.js";
import { 
  Popover, PopoverContent, PopoverTrigger 
} from "../ui/popover.js";

export interface PlatformInteractiveModalBlockProps {
  title?: string;
  subtitle?: string;
  dialogTitle?: string;
  sheetTitle?: string;
  popoverText?: string;
  onActionConfirmed?: () => void;
}

export function PlatformInteractiveModalBlock({
  title = "Interactive Overlay & Sheet Suite",
  subtitle = "Interactive testbed wrapping Dialog, Sheet, and Popover primitives",
  dialogTitle = "Tactical Override Confirmation",
  sheetTitle = "Field Operative Telemetry Drawer",
  popoverText = "Instant cryptographic key verified by Oddjob Control Plane.",
  onActionConfirmed
}: PlatformInteractiveModalBlockProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = () => {
    setConfirmed(true);
    setDialogOpen(false);
    setTimeout(() => setConfirmed(false), 3000);
    if (onActionConfirmed) onActionConfirmed();
  };

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-md shadow-xl overflow-hidden">
      <CardHeader className="p-5 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
              <Layers className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground flex items-center gap-2">
                {title}
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary uppercase">
                  Overlays & Modals
                </Badge>
              </CardTitle>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {confirmed && (
            <Badge variant="secondary" className="h-7 px-3 gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" /> Action Executed
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. DIALOG PRIMITIVE */}
          <div className="p-5 rounded-2xl bg-muted/10 border border-border/50 hover:border-primary/30 transition-all flex flex-col justify-between space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Maximize2 className="w-4 h-4 text-primary" />
                Modal Dialog Primitive
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Centered focus modal with backdrop blur for critical confirmations and alerts.
              </p>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="w-full gap-2 text-xs font-bold bg-primary/15 text-primary hover:bg-primary hover:text-background border border-primary/30">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Trigger Dialog
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/60">
                <DialogHeader>
                  <DialogTitle className="text-base font-black uppercase">{dialogTitle}</DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    This action dispatches high-priority override commands to all registered field operatives.
                  </DialogDescription>
                </DialogHeader>
                <div className="p-4 rounded-xl bg-muted/20 border border-border/40 text-xs space-y-2 font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Channel:</span>
                    <span className="text-foreground font-bold">ALPHA-SECURE</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Auth Token:</span>
                    <span className="text-emerald-400 font-bold">VALID (0x8842...FF)</span>
                  </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleConfirm} className="bg-primary text-background hover:bg-primary/90">
                    Confirm Dispatch
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* 2. SHEET PRIMITIVE */}
          <div className="p-5 rounded-2xl bg-muted/10 border border-border/50 hover:border-primary/30 transition-all flex flex-col justify-between space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <PanelRight className="w-4 h-4 text-emerald-400" />
                Side Drawer / Sheet Primitive
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Sliding edge drawer for inspect panels, configuration forms, and deep dive records.
              </p>
            </div>

            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="w-full gap-2 text-xs font-bold border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                  <PanelRight className="w-3.5 h-3.5" />
                  Slide Out Sheet
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[380px] bg-card/95 backdrop-blur-xl border-border/60 p-6 space-y-6">
                <SheetHeader>
                  <SheetTitle className="text-base font-black uppercase tracking-tight">{sheetTitle}</SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    Deep inspection of active session parameters and container health.
                  </SheetDescription>
                </SheetHeader>
                <div className="space-y-3 text-xs">
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                    <span className="text-[10px] font-black uppercase text-muted-foreground">Active Sector</span>
                    <p className="font-mono font-bold text-foreground">Sector 7 (Downtown Grid)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-1">
                    <span className="text-[10px] font-black uppercase text-muted-foreground">Sensor Mesh Latency</span>
                    <p className="font-mono font-bold text-emerald-400">18.4 ms (Optimal)</p>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* 3. POPOVER PRIMITIVE */}
          <div className="p-5 rounded-2xl bg-muted/10 border border-border/50 hover:border-primary/30 transition-all flex flex-col justify-between space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-foreground">
                <Info className="w-4 h-4 text-cyan-400" />
                Context Popover Primitive
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Anchored contextual overlay for rich tooltips, quick info, and mini action menus.
              </p>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full gap-2 text-xs font-bold border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10">
                  <Info className="w-3.5 h-3.5" />
                  Inspect Popover
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 bg-card/95 backdrop-blur-xl border-border/60 p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold text-foreground">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  <span>Telemetry Anchor</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {popoverText}
                </p>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default PlatformInteractiveModalBlock;
