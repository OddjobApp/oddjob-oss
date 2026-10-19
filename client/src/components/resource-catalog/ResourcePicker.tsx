import * as React from "react";
import {
  AppWindow,
  Briefcase,
  BookOpen,
  CalendarClock,
  Check,
  CheckSquare,
  ChevronsUpDown,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  FileText,
  GitBranch,
  KeyRound,
  Layers,
  Loader2,
  type LucideIcon,
  RefreshCcw,
  Rocket,
  Slack,
  Workflow,
  X,
  Zap,
} from "lucide-react";

import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@domain-ui/core/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@domain-ui/core/ui/components/ui/popover";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_DEFINITIONS,
  isResourceType,
  type PlatformResource,
  type ResourceCatalogResponse,
  type ResourceRiskLevel,
  type ResourceType,
} from "@shared/resource-catalog";

export const RESOURCE_TYPE_ICONS: Record<ResourceType, LucideIcon> = {
  crew_room: Slack,
  cycle: RefreshCcw,
  cycle_blueprint: Layers,
  mission: Briefcase,
  mission_run: Rocket,
  agent: Zap,
  agent_deployment: Rocket,
  agent_session: Briefcase,
  agent_run: Rocket,
  agent_state: Layers,
  pipeline: Workflow,
  pipeline_step: GitBranch,
  job: Zap,
  tool: Zap,
  tool_call: GitBranch,
  capability: Check,
  connector_action: Workflow,
  mcp_server: Layers,
  dataset: Database,
  memory: BookOpen,
  context_packet: Layers,
  retrieval_result: FileText,
  knowledge_topic: BookOpen,
  knowledge_document: FileText,
  knowledge_source: BookOpen,
  claim: ClipboardCheck,
  fact: CheckSquare,
  contradiction: X,
  document_template: FileSpreadsheet,
  hil_form: ClipboardCheck,
  approval_request: CheckSquare,
  policy: ClipboardCheck,
  policy_pack: Layers,
  risk_control: CheckSquare,
  approval_policy: ClipboardCheck,
  app: AppWindow,
  app_deployment: Rocket,
  app_release: Rocket,
  artifact: FileText,
  report: FileSpreadsheet,
  evidence_bundle: ClipboardCheck,
  trace: GitBranch,
  trace_event: GitBranch,
  eval_dataset: Database,
  eval_run: CheckSquare,
  eval_gate: Check,
  schedule: CalendarClock,
  credential: KeyRound,
  slack_workspace: Slack,
  user: Briefcase,
  team: Layers,
  role: KeyRound,
  stakeholder: CheckSquare,
  owner_group: Layers,
  incident: X,
  alert: X,
  failure_pattern: GitBranch,
  remediation: RefreshCcw,
  runbook: BookOpen,
};

const RISK_BADGE_VARIANT: Record<ResourceRiskLevel, "secondary" | "warning" | "critical" | "destructive"> = {
  low: "secondary",
  medium: "warning",
  high: "critical",
  critical: "destructive",
};

const RECENTS_STORAGE_KEY = "oddjob.resource-picker.recents";
const RECENTS_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 30;

interface RecentEntry {
  key: string;
  type: ResourceType;
  id: string;
  name: string;
}

function isRecentEntry(value: unknown): value is RecentEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.type === "string" &&
    isResourceType(entry.type)
  );
}

function loadRecents(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry) : [];
  } catch {
    return [];
  }
}

function pushRecent(entry: RecentEntry) {
  if (typeof window === "undefined") return;
  try {
    const next = [entry, ...loadRecents().filter((item) => item.key !== entry.key)].slice(0, RECENTS_LIMIT);
    window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can throw under private-browsing/storage-full conditions; recents are a convenience, not required.
  }
}

function toRecentEntry(resource: PlatformResource): RecentEntry {
  return { key: resource.key, type: resource.type, id: resource.id, name: resource.name };
}

async function fetchResources(params: { search: string; types: ResourceType[] }): Promise<PlatformResource[]> {
  const query = new URLSearchParams();
  if (params.search.trim()) query.set("search", params.search.trim());
  query.set("types", params.types.join(","));
  query.set("limit", String(RESULT_LIMIT));

  const res = await apiRequest("GET", `/api/resource-catalog/resources?${query.toString()}`);
  const data: ResourceCatalogResponse = await res.json();
  return data.resources;
}

async function fetchResourceByKey(key: string): Promise<PlatformResource | null> {
  try {
    const res = await apiRequest("GET", `/api/resource-catalog/resources/${encodeURIComponent(key)}`);
    return (await res.json()) as PlatformResource;
  } catch {
    return null;
  }
}

interface ResourcePickerCommonProps {
  /** Restrict which resource types are pickable. Defaults to every type in the catalog. */
  types?: ResourceType[];
  /** Resource keys to hide from results, e.g. the resource being edited itself. */
  excludeKeys?: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface SingleResourcePickerProps extends ResourcePickerCommonProps {
  multiple?: false;
  value: string | null;
  onChange: (key: string | null, resource: PlatformResource | null) => void;
}

interface MultiResourcePickerProps extends ResourcePickerCommonProps {
  multiple: true;
  value: string[];
  onChange: (keys: string[], resources: PlatformResource[]) => void;
}

export type ResourcePickerProps = SingleResourcePickerProps | MultiResourcePickerProps;

function ResourceTypeIcon({ type, className }: { type: ResourceType; className?: string }) {
  const Icon = RESOURCE_TYPE_ICONS[type];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} />;
}

export function ResourcePicker(props: ResourcePickerProps) {
  const { types: allowedTypes, excludeKeys, placeholder, disabled, className } = props;
  const selectableTypes = React.useMemo<ResourceType[]>(
    () => (allowedTypes?.length ? allowedTypes : [...RESOURCE_TYPES]),
    [allowedTypes],
  );

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activeTypes, setActiveTypes] = React.useState<ResourceType[]>(selectableTypes);
  const [results, setResults] = React.useState<PlatformResource[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [recents, setRecents] = React.useState<RecentEntry[]>([]);
  const [resourceCache, setResourceCache] = React.useState<Map<string, PlatformResource>>(new Map());

  React.useEffect(() => {
    setActiveTypes(selectableTypes);
  }, [selectableTypes]);

  React.useEffect(() => {
    if (open) setRecents(loadRecents());
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const resources = await fetchResources({ search, types: activeTypes });
        if (cancelled) return;
        setResults(resources);
        setResourceCache((prev) => {
          const next = new Map(prev);
          for (const resource of resources) next.set(resource.key, resource);
          return next;
        });
      } catch (error) {
        console.error("[ResourcePicker] Failed to load resources:", error);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, activeTypes]);

  const selectedKeys = React.useMemo(
    () => (props.multiple ? props.value : props.value ? [props.value] : []),
    [props.multiple, props.value],
  );
  const selectedKeysSignature = selectedKeys.join(",");

  // Best-effort lookup so the trigger shows real resource names for values the picker
  // hasn't fetched into its own list yet (e.g. editing a record with a pre-selected resource).
  React.useEffect(() => {
    const missing = selectedKeys.filter((key) => !resourceCache.has(key));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(missing.map(fetchResourceByKey));
      if (cancelled) return;
      setResourceCache((prev) => {
        const next = new Map(prev);
        for (const resource of fetched) if (resource) next.set(resource.key, resource);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by stable signature, not the array identity
  }, [selectedKeysSignature]);

  const excluded = React.useMemo(() => new Set(excludeKeys ?? []), [excludeKeys]);
  const searchNeedle = search.trim().toLowerCase();

  const visibleRecents = recents.filter(
    (entry) =>
      activeTypes.includes(entry.type) &&
      !excluded.has(entry.key) &&
      (!searchNeedle || entry.name.toLowerCase().includes(searchNeedle)),
  );
  const recentKeys = new Set(visibleRecents.map((entry) => entry.key));
  const visibleResults = results.filter((resource) => !excluded.has(resource.key) && !recentKeys.has(resource.key));

  function toggleType(type: ResourceType) {
    setActiveTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((t) => t !== type);
        return next.length ? next : selectableTypes;
      }
      return [...current, type];
    });
  }

  function handleSelect(resource: PlatformResource) {
    pushRecent(toRecentEntry(resource));
    setResourceCache((prev) => new Map(prev).set(resource.key, resource));

    if (props.multiple) {
      const alreadySelected = props.value.includes(resource.key);
      const nextKeys = alreadySelected
        ? props.value.filter((key) => key !== resource.key)
        : [...props.value, resource.key];
      const nextResources = resolveResources(nextKeys, resourceCache, resource);
      props.onChange(nextKeys, nextResources);
    } else {
      const isSame = props.value === resource.key;
      props.onChange(isSame ? null : resource.key, isSame ? null : resource);
      setOpen(false);
    }
  }

  function handleRemove(key: string) {
    if (!props.multiple) {
      props.onChange(null, null);
      return;
    }
    const nextKeys = props.value.filter((k) => k !== key);
    props.onChange(nextKeys, resolveResources(nextKeys, resourceCache));
  }

  function resolveResources(keys: string[], cache: Map<string, PlatformResource>, justSelected?: PlatformResource) {
    return keys
      .map((key) => cache.get(key) ?? (justSelected?.key === key ? justSelected : undefined))
      .filter((resource): resource is PlatformResource => Boolean(resource));
  }

  const selectedResources = selectedKeys
    .map((key) => resourceCache.get(key))
    .filter((resource): resource is PlatformResource => Boolean(resource));

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            props.multiple ? "h-auto min-h-10 py-2 px-3" : "",
            selectedResources.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          {props.multiple ? (
            <div className="flex flex-wrap gap-1">
              {selectedResources.length > 0 ? (
                selectedResources.map((resource) => (
                  <Badge
                    key={resource.key}
                    variant="secondary"
                    className="mr-1 mb-1 gap-1"
                    onClick={(event) => {
                      if (disabled) return;
                      event.stopPropagation();
                      handleRemove(resource.key);
                    }}
                  >
                    <ResourceTypeIcon type={resource.type} className="h-3 w-3" />
                    {resource.name}
                    {!disabled && <X className="ml-1 h-3 w-3 text-muted-foreground hover:text-foreground" />}
                  </Badge>
                ))
              ) : (
                <span>{placeholder ?? "Select resources..."}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 truncate">
              {selectedResources[0] ? (
                <>
                  <ResourceTypeIcon type={selectedResources[0].type} className="opacity-70" />
                  <span className="truncate">{selectedResources[0].name}</span>
                </>
              ) : (
                <span>{placeholder ?? "Select a resource..."}</span>
              )}
            </div>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {selectableTypes.length > 1 && (
          <div className="flex flex-wrap gap-1 border-b p-2">
            {selectableTypes.map((type) => {
              const isActive = activeTypes.includes(type);
              const Icon = RESOURCE_TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {RESOURCE_TYPE_DEFINITIONS[type].label}
                </button>
              );
            })}
          </div>
        )}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search resources..." value={search} onValueChange={setSearch} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Searching...</span>
              </div>
            )}
            {!loading && visibleRecents.length === 0 && visibleResults.length === 0 && (
              <CommandEmpty>No resources found.</CommandEmpty>
            )}
            {!loading && visibleRecents.length > 0 && (
              <CommandGroup heading="Recent">
                {visibleRecents.map((entry) => (
                  <ResourcePickerRow
                    key={entry.key}
                    resourceKey={entry.key}
                    type={entry.type}
                    name={entry.name}
                    isSelected={selectedKeys.includes(entry.key)}
                    onSelect={async () => {
                      const resource = resourceCache.get(entry.key) ?? (await fetchResourceByKey(entry.key));
                      if (resource) handleSelect(resource);
                    }}
                  />
                ))}
              </CommandGroup>
            )}
            {!loading && visibleResults.length > 0 && (
              <CommandGroup heading="Resources">
                {visibleResults.map((resource) => (
                  <ResourcePickerRow
                    key={resource.key}
                    resourceKey={resource.key}
                    type={resource.type}
                    name={resource.name}
                    lifecycle={resource.lifecycle}
                    riskLevel={resource.riskLevel}
                    isSelected={selectedKeys.includes(resource.key)}
                    onSelect={() => handleSelect(resource)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ResourcePickerRow({
  resourceKey,
  type,
  name,
  lifecycle,
  riskLevel,
  isSelected,
  onSelect,
}: {
  resourceKey: string;
  type: ResourceType;
  name: string;
  lifecycle?: string;
  riskLevel?: ResourceRiskLevel;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={resourceKey} onSelect={onSelect} className="gap-2">
      <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
      <ResourceTypeIcon type={type} className="opacity-70" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <span className="truncate text-sm">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{RESOURCE_TYPE_DEFINITIONS[type].label}</span>
      </div>
      {riskLevel && riskLevel !== "low" && (
        <Badge variant={RISK_BADGE_VARIANT[riskLevel]} className="shrink-0 text-[10px]">
          {riskLevel}
        </Badge>
      )}
      {lifecycle && lifecycle !== "active" && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{lifecycle}</span>
      )}
    </CommandItem>
  );
}
