import React, { useState } from "react";
import { motion } from "framer-motion";
import { Gauge as GaugeIcon, AlertTriangle, ShieldCheck, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Gauge } from "../ui/gauge.js";
import { Slider } from "../ui/slider.js";

export interface GaugeMetricItem {
  id: string;
  label: string;
  value: number;
  max?: number;
  description?: string;
  color?: string;
  unit?: string;
}

export interface PlatformMetricGaugeBlockProps {
  title?: string;
  subtitle?: string;
  metrics?: GaugeMetricItem[];
  allowSimulation?: boolean;
  onCalibrate?: () => void;
}

const DEFAULT_METRICS: GaugeMetricItem[] = [
  {
    id: "system-load",
    label: "Telemetry Pipeline",
    value: 78,
    max: 100,
    description: "Real-time SSE event buffer occupancy",
    color: "#6366f1",
    unit: "%"
  },
  {
    id: "mesh-health",
    label: "H3 Hex Mesh Density",
    value: 92,
    max: 100,
    description: "Spatial resolution & sensor coverage",
    color: "#10b981",
    unit: "%"
  },
  {
    id: "sla-compliance",
    label: "Rescue SLA Margin",
    value: 64,
    max: 100,
    description: "Mean response target threshold",
    color: "#f59e0b",
    unit: "%"
  }
];

export function PlatformMetricGaugeBlock({
  title = "Telemetry & Performance Dials",
  subtitle = "Dynamic circular gauge instrumentation representing platform state",
  metrics = DEFAULT_METRICS,
  allowSimulation = true,
  onCalibrate
}: PlatformMetricGaugeBlockProps) {
  const [activeMetrics, setActiveMetrics] = useState<GaugeMetricItem[]>(metrics);
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSliderChange = (id: string, newVal: number) => {
    setActiveMetrics(prev => prev.map(m => m.id === id ? { ...m, value: newVal } : m));
  };

  const handlePulse = () => {
    setIsSimulating(true);
    setActiveMetrics(prev => prev.map(m => ({
      ...m,
      value: Math.min(100, Math.max(20, Math.round(m.value + (Math.random() * 20 - 10))))
    })));
    setTimeout(() => setIsSimulating(false), 500);
    if (onCalibrate) onCalibrate();
  };

  return (
    <Card className="border-border/60 bg-card/40 backdrop-blur-md shadow-xl overflow-hidden">
      <CardHeader className="p-5 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-inner">
              <GaugeIcon className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <CardTitle className="text-base font-black uppercase tracking-tight text-foreground flex items-center gap-2">
                {title}
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary uppercase">
                  Radial Gauges
                </Badge>
              </CardTitle>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePulse}
              disabled={isSimulating}
              className="h-8 gap-1.5 text-xs font-semibold border-border/60 hover:border-primary/40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? "animate-spin" : ""}`} />
              Pulse Telemetry
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {activeMetrics.map((metric) => {
            const isWarning = metric.value < 40 || metric.value > 90;
            return (
              <motion.div
                key={metric.id}
                layout
                className="p-5 rounded-2xl bg-muted/10 border border-border/50 hover:border-primary/30 transition-all flex flex-col items-center justify-between space-y-4"
              >
                <div className="w-full flex items-center justify-between text-xs">
                  <span className="font-bold text-foreground truncate max-w-[160px]">{metric.label}</span>
                  {isWarning ? (
                    <Badge variant="destructive" className="h-5 px-1.5 text-[9px] gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> High
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[9px] gap-1 text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                      <ShieldCheck className="w-2.5 h-2.5" /> Nominal
                    </Badge>
                  )}
                </div>

                <div className="w-full max-w-[180px] aspect-square flex items-center justify-center">
                  <Gauge
                    value={metric.value}
                    max={metric.max || 100}
                    label={metric.unit || "%"}
                    description={metric.description}
                    color={metric.color || "hsl(var(--primary))"}
                  />
                </div>

                {allowSimulation && (
                  <div className="w-full space-y-1.5 pt-2 border-t border-border/40">
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>Simulate Dial</span>
                      <span>{metric.value}{metric.unit || "%"}</span>
                    </div>
                    <Slider
                      value={[metric.value]}
                      max={metric.max || 100}
                      step={1}
                      onValueChange={(val) => handleSliderChange(metric.id, val[0])}
                      className="w-full"
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default PlatformMetricGaugeBlock;
