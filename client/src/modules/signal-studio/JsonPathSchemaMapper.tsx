/**
 * JSONPath Schema Mapping Studio
 *
 * Allows operators to visually map inbound JSON telemetry streams (from webhooks, Kafka bridges, IoT, or scrapers)
 * into Oddjob's universal EventPrimitive schema with instant H3 resolution derivation and live preview.
 */

import React, { useState, useMemo } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import {
  Code2,
  Sparkles,
  Play,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Compass,
  Zap,
  Globe,
  Radio,
  FileCode,
  Send,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';

export interface SchemaMappingFields {
  sourceEntryId: string;
  eventType: string;
  targetSector: string;
  jurisdiction: string;
  severity: string;
  confidenceScore: string;
  latitude: string;
  longitude: string;
  subjectId: string;
  dwellMinutes: string;
  rawText: string;
  sourceUrl: string;
}

const DEFAULT_MAPPING: SchemaMappingFields = {
  sourceEntryId: '$.id',
  eventType: '$.eventType',
  targetSector: '$.targetSector',
  jurisdiction: '$.jurisdiction',
  severity: '$.severity',
  confidenceScore: '$.confidenceScore',
  latitude: '$.latitude',
  longitude: '$.longitude',
  subjectId: '$.subjectId',
  dwellMinutes: '$.dwellMinutes',
  rawText: '$.summary',
  sourceUrl: '$.sourceUrl',
};

interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  payload: Record<string, any>;
  mapping: Partial<SchemaMappingFields>;
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'maritime',
    name: 'Maritime AIS Telemetry',
    description: 'Vessel tracking, port berth dwell times, and anchorage congestion',
    icon: '🚢',
    payload: {
      vessel: {
        mmsi: '368924000',
        name: 'PACIFIC CARRIER',
        type: 'Container Ship',
        destination: 'USLAX',
      },
      telemetry: {
        lat: 33.7432,
        lon: -118.2673,
        speed_knots: 0.2,
        heading: 184,
        anchorage_mins: 180,
      },
      anomaly: {
        severity: 'High',
        event: 'Operational_Disruption',
        alert_msg: 'Excessive berth dwell time at Long Beach Terminal Pier 400',
      },
    },
    mapping: {
      sourceEntryId: '$.vessel.mmsi',
      eventType: '$.anomaly.event',
      targetSector: 'Supply_Chain',
      jurisdiction: 'Port of Long Beach',
      severity: '$.anomaly.severity',
      latitude: '$.telemetry.lat',
      longitude: '$.telemetry.lon',
      subjectId: '$.vessel.name',
      dwellMinutes: '$.telemetry.anchorage_mins',
      rawText: '$.anomaly.alert_msg',
    },
  },
  {
    id: 'energy',
    name: 'Power Grid Infrastructure',
    description: 'Substation frequency monitoring and power grid load events',
    icon: '⚡',
    payload: {
      incident_id: 'ERCOT-FREQ-8821',
      grid_operator: 'ERCOT',
      substation: {
        code: 'AUSTIN-NORTH-3',
        state: 'TX',
        gps: {
          latitude: 30.2672,
          longitude: -97.7431,
        },
      },
      telemetry: {
        measured_hz: 59.81,
        nominal_hz: 60.0,
        urgency: 'Critical',
      },
      message: 'Frequency excursion detected below 59.85 Hz threshold across ERCOT North Zone',
    },
    mapping: {
      sourceEntryId: '$.incident_id',
      eventType: 'Operational_Disruption',
      targetSector: 'Energy',
      jurisdiction: 'US-TX',
      severity: '$.telemetry.urgency',
      latitude: '$.substation.gps.latitude',
      longitude: '$.substation.gps.longitude',
      subjectId: '$.substation.code',
      rawText: '$.message',
    },
  },
  {
    id: 'real_estate',
    name: 'Distressed Parcel Harvest',
    description: 'County recorder notice of default and trustee auction events',
    icon: '🏡',
    payload: {
      filing_number: 'NOD-2026-9021',
      county: 'Orange County, CA',
      parcel: {
        apn: '932-10-482',
        address: '1428 Elm Avenue, Santa Ana, CA 92701',
        coords: {
          lat: 33.7455,
          lng: -117.8677,
        },
      },
      distress: {
        status: 'Notice of Default',
        delinquent_amount: 14200,
        unpaid_principal: 485000,
        auction_date: '2026-10-15',
      },
    },
    mapping: {
      sourceEntryId: '$.filing_number',
      eventType: 'Market_Shift',
      targetSector: 'Enterprise_Operations',
      jurisdiction: 'US-CA',
      severity: 'High',
      latitude: '$.parcel.coords.lat',
      longitude: '$.parcel.coords.lng',
      subjectId: '$.parcel.apn',
      rawText: '$.distress.status',
    },
  },
  {
    id: 'cyber',
    name: 'Cyber Security Vulnerability (SIEM)',
    description: 'CVE vulnerabilities, network anomalies, and infrastructure exploits',
    icon: '🛡️',
    payload: {
      alert_id: 'SEC-CVE-2026-19302',
      cve_id: 'CVE-2026-19302',
      datacenter: {
        name: 'US-East-Ashburn',
        lat: 39.0438,
        lon: -77.4874,
      },
      threat_level: 'Critical',
      description: 'Zero-day remote code execution attempt detected against edge gateway',
    },
    mapping: {
      sourceEntryId: '$.alert_id',
      eventType: 'Security_Incident',
      targetSector: 'Technology',
      jurisdiction: 'US-VA',
      severity: '$.threat_level',
      latitude: '$.datacenter.lat',
      longitude: '$.datacenter.lon',
      subjectId: '$.datacenter.name',
      rawText: '$.description',
    },
  },
];

export interface JsonPathSchemaMapperProps {
  feedId?: number;
  onApplyMapping?: (mapping: SchemaMappingFields) => void;
  className?: string;
}

export const JsonPathSchemaMapper: React.FC<JsonPathSchemaMapperProps> = ({
  feedId,
  onApplyMapping,
  className,
}) => {
  const { toast } = useToast();
  const [selectedPresetId, setSelectedPresetId] = useState<string>('maritime');
  const [rawJsonText, setRawJsonText] = useState<string>(
    JSON.stringify(PRESET_TEMPLATES[0].payload, null, 2)
  );
  const [mapping, setMapping] = useState<SchemaMappingFields>({
    ...DEFAULT_MAPPING,
    ...PRESET_TEMPLATES[0].mapping,
  });
  const [testResult, setTestResult] = useState<any | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isInferred, setIsInferred] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);

  const ingressUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://oddjob.internal';
    return feedId
      ? `${origin}/api/oddjob/signal/ingress/events/${feedId}`
      : `${origin}/api/oddjob/signal/ingress/events`;
  }, [feedId]);

  const curlSnippet = useMemo(() => {
    return `curl -X POST "${ingressUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${rawJsonText.replace(/'/g, "'\\''")}'`;
  }, [ingressUrl, rawJsonText]);

  // Load a preset template
  const handleSelectPreset = (preset: PresetTemplate) => {
    setSelectedPresetId(preset.id);
    setRawJsonText(JSON.stringify(preset.payload, null, 2));
    setMapping((prev) => ({
      ...prev,
      ...preset.mapping,
    }));
    setTestResult(null);
  };

  // Run schema inference
  const handleInferSchema = async () => {
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(rawJsonText);
      } catch {
        toast({
          title: 'Invalid JSON',
          description: 'Please ensure your raw payload is valid JSON before inferring schema.',
          variant: 'destructive',
        });
        return;
      }

      const res = await apiRequest('POST', '/api/oddjob/signal/ingress/infer-schema', {
        rawPayload: parsed,
        title: 'InferredSchema',
      });
      const data = await res.json();
      setIsInferred(true);
      toast({
        title: 'Schema Inferred',
        description: `Discovered ${data.totalFieldsCount} structural fields with ${Math.round(data.confidenceAverage * 100)}% avg confidence.`,
      });
    } catch (err: any) {
      toast({
        title: 'Inference Failed',
        description: err.message || 'Could not infer schema from payload.',
        variant: 'destructive',
      });
    }
  };

  // Run test transform
  const handleTestMapping = async () => {
    setIsTesting(true);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(rawJsonText);
      } catch {
        toast({
          title: 'Invalid JSON',
          description: 'Please ensure your raw payload is valid JSON.',
          variant: 'destructive',
        });
        setIsTesting(false);
        return;
      }

      const res = await apiRequest('POST', '/api/oddjob/signal/ingress/test-mapping', {
        rawPayload: parsed,
        mapping,
      });
      const data = await res.json();
      setTestResult(data);

      if (data.success) {
        toast({
          title: 'Transformation Succeeded',
          description: `Extracted ${data.event.eventType} event in ${data.event.jurisdiction}. Derived H3 index: ${data.event.h3Index || 'N/A'}.`,
        });
      } else {
        toast({
          title: 'Mapping Errors',
          description: data.errors?.join(', ') || 'Transformation produced errors.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Test Failed',
        description: err.message || 'Could not test mapping.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(ingressUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    toast({ title: 'Ingress Webhook URL Copied' });
  };

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(curlSnippet);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
    toast({ title: 'cURL Ingestion Snippet Copied' });
  };

  const handleFieldChange = (field: keyof SchemaMappingFields, value: string) => {
    setMapping((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  return (
    <div className={cn('flex flex-col gap-4 p-4 bg-background text-foreground h-full overflow-y-auto', className)}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Code2 className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-bold text-foreground">JSONPath Schema Mapping Studio</h2>
            <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
              Universal Ingress
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Visually map inbound JSON streams from webhooks, Kafka, and scrapers into Oddjob&apos;s universal event primitives.
          </p>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Presets:</span>
          {PRESET_TEMPLATES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelectPreset(preset)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors border',
                selectedPresetId === preset.id
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                  : 'border-border/70 bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span>{preset.icon}</span>
              <span>{preset.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Two-Column Layout ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Raw Payload Editor & Ingress URL (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* Ingress Endpoint HUD */}
          <div className="rounded-xl border border-cyan-500/30 bg-card/80 p-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-cyan-400" />
                Live Ingress Webhook Endpoint
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="rounded px-2 py-0.5 text-[10px] font-medium bg-muted hover:bg-accent text-foreground transition-colors flex items-center gap-1 border border-border"
                  title="Copy Endpoint URL"
                >
                  {copiedUrl ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyCurl}
                  className="rounded px-2 py-0.5 text-[10px] font-medium bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 transition-colors flex items-center gap-1 border border-cyan-500/40"
                  title="Copy cURL snippet"
                >
                  {copiedCurl ? <Check className="h-3 w-3 text-emerald-400" /> : <FileCode className="h-3 w-3" />}
                  <span>{copiedCurl ? 'Copied' : 'cURL'}</span>
                </button>
              </div>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground break-all bg-background/90 p-2 rounded-md border border-border select-all">
              POST {ingressUrl}
            </p>
          </div>

          {/* Raw JSON Payload */}
          <div className="rounded-xl border border-border/80 bg-card/70 p-3 flex flex-col flex-1 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                <span>Inbound Sample Payload</span>
                <span className="font-mono text-[10px] text-muted-foreground">(JSON)</span>
              </span>
              <button
                type="button"
                onClick={handleInferSchema}
                className="flex items-center gap-1 rounded bg-muted/80 hover:bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors border border-border"
                title="Infer structural schema from payload"
              >
                <Sparkles className="h-3 w-3 text-amber-400" />
                <span>Auto-Infer Schema</span>
              </button>
            </div>
            <textarea
              value={rawJsonText}
              onChange={(e) => setRawJsonText(e.target.value)}
              className="w-full flex-1 min-h-[300px] font-mono text-[11px] bg-background/90 text-foreground p-2.5 rounded-lg border border-border focus:outline-hidden focus:ring-1 focus:ring-primary resize-y leading-relaxed"
              placeholder="Paste raw JSON payload from external webhook..."
              spellCheck={false}
            />
          </div>
        </div>

        {/* Right Column: Schema Field Mapping Grid & Live Preview (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {/* Field Mapping Configuration */}
          <div className="rounded-xl border border-border/80 bg-card/70 p-3 shadow-xs">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Compass className="h-3.5 w-3.5 text-primary" />
                Universal Event Primitive Mappings
              </span>
              <button
                type="button"
                onClick={handleTestMapping}
                disabled={isTesting}
                className="flex items-center gap-1 rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-1 text-xs font-semibold text-white transition-colors shadow-sm disabled:opacity-50"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>{isTesting ? 'Testing...' : 'Test Mapping'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {/* Event Type */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Event Type</span>
                  <span className="text-[10px] text-muted-foreground font-mono">eventType</span>
                </div>
                <input
                  type="text"
                  value={mapping.eventType}
                  onChange={(e) => handleFieldChange('eventType', e.target.value)}
                  placeholder="$.type or Operational_Disruption"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Target Sector */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Target Sector</span>
                  <span className="text-[10px] text-muted-foreground font-mono">targetSector</span>
                </div>
                <input
                  type="text"
                  value={mapping.targetSector}
                  onChange={(e) => handleFieldChange('targetSector', e.target.value)}
                  placeholder="$.domain or Infrastructure"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Severity */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Severity</span>
                  <span className="text-[10px] text-muted-foreground font-mono">severity</span>
                </div>
                <input
                  type="text"
                  value={mapping.severity}
                  onChange={(e) => handleFieldChange('severity', e.target.value)}
                  placeholder="$.level or High"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Jurisdiction */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Jurisdiction</span>
                  <span className="text-[10px] text-muted-foreground font-mono">jurisdiction</span>
                </div>
                <input
                  type="text"
                  value={mapping.jurisdiction}
                  onChange={(e) => handleFieldChange('jurisdiction', e.target.value)}
                  placeholder="$.region or Global"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Latitude */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-400">Latitude (GPS)</span>
                  <span className="text-[10px] text-muted-foreground font-mono">latitude</span>
                </div>
                <input
                  type="text"
                  value={mapping.latitude}
                  onChange={(e) => handleFieldChange('latitude', e.target.value)}
                  placeholder="$.coordinates.lat"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Longitude */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-400">Longitude (GPS)</span>
                  <span className="text-[10px] text-muted-foreground font-mono">longitude</span>
                </div>
                <input
                  type="text"
                  value={mapping.longitude}
                  onChange={(e) => handleFieldChange('longitude', e.target.value)}
                  placeholder="$.coordinates.lng"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Subject / Entity ID */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Subject / Asset ID</span>
                  <span className="text-[10px] text-muted-foreground font-mono">subjectId</span>
                </div>
                <input
                  type="text"
                  value={mapping.subjectId}
                  onChange={(e) => handleFieldChange('subjectId', e.target.value)}
                  placeholder="$.vessel.name or $.asset_id"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Source Entry ID */}
              <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Unique ID</span>
                  <span className="text-[10px] text-muted-foreground font-mono">sourceEntryId</span>
                </div>
                <input
                  type="text"
                  value={mapping.sourceEntryId}
                  onChange={(e) => handleFieldChange('sourceEntryId', e.target.value)}
                  placeholder="$.id or $.uuid"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>

              {/* Summary / Description (full width) */}
              <div className="md:col-span-2 flex flex-col gap-1 p-2 rounded-lg bg-background/60 border border-border/60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Raw Text / Summary Description</span>
                  <span className="text-[10px] text-muted-foreground font-mono">rawText</span>
                </div>
                <input
                  type="text"
                  value={mapping.rawText}
                  onChange={(e) => handleFieldChange('rawText', e.target.value)}
                  placeholder="$.summary or $.alert_msg or $.message"
                  className="font-mono text-[11px] bg-card text-foreground px-2 py-1 rounded border border-border"
                />
              </div>
            </div>

            {onApplyMapping && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => onApplyMapping(mapping)}
                  className="rounded-md bg-primary hover:bg-primary/90 px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition-colors"
                >
                  Save Mapping to Feed
                </button>
              </div>
            )}
          </div>

          {/* Live Transformed Event Preview Card */}
          <div className="rounded-xl border border-border/80 bg-card/70 p-3 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Transformed Event Output Preview
              </span>
              {testResult?.success ? (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Valid Primitive</span>
                </span>
              ) : testResult?.errors?.length ? (
                <span className="rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Errors Detected</span>
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">Click &apos;Test Mapping&apos; to run transform</span>
              )}
            </div>

            {testResult?.event ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                    <span className="text-[10px] text-muted-foreground block">Event Type</span>
                    <span className="font-semibold text-foreground">{testResult.event.eventType}</span>
                  </div>
                  <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                    <span className="text-[10px] text-muted-foreground block">Severity</span>
                    <span
                      className={cn(
                        'font-bold',
                        testResult.event.severity === 'Critical'
                          ? 'text-rose-400'
                          : testResult.event.severity === 'High'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      )}
                    >
                      {testResult.event.severity}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                    <span className="text-[10px] text-muted-foreground block">Uber H3 (Res 7)</span>
                    <span className="font-mono text-[10px] text-cyan-400 font-semibold truncate block">
                      {testResult.event.h3Index || 'None'}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-background/80 border border-border/60">
                    <span className="text-[10px] text-muted-foreground block">Subject ID</span>
                    <span className="font-semibold text-foreground truncate block">
                      {testResult.event.subjectId || 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-background/80 border border-border/60 text-xs">
                  <span className="text-[10px] text-muted-foreground block mb-0.5">Extracted Summary</span>
                  <p className="text-foreground text-[11px] leading-relaxed">{testResult.event.rawText}</p>
                </div>

                <pre className="max-h-40 overflow-y-auto rounded-lg bg-muted/60 p-2 font-mono text-[9px] text-foreground border border-border/60 leading-relaxed select-all">
                  {JSON.stringify(testResult.event, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground bg-background/40 rounded-lg border border-dashed border-border/60">
                Press <strong>&quot;Test Mapping&quot;</strong> to evaluate the JSONPath expressions against the sample payload.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default JsonPathSchemaMapper;
