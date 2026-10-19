/**
 * useSchemaMapping Hook
 * Business logic for schema mapping editor (selection, types, transforms, hygiene)
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

export interface SchemaColumn {
  jsonPath: string;
  datasetKey: string;
  type: string;
  transform?: string;
}

export interface DataHygiene {
  deduplication?: {
    enabled: boolean;
    keyColumns?: string[];
    strategy: 'keepFirst' | 'keepLast';
    scope?: 'batch' | 'global';
    globalConflictResolution?: 'skip' | 'update';
  };
  nullHandling?: {
    strategy: 'keep' | 'drop' | 'fill';
    fillValue?: string;
  };
  validation?: {
    dropInvalidTypes: boolean;
  };
}

interface SchemaMappingTemplate {
  id: number;
  name: string;
  description?: string;
  mappingConfig: {
    columns: SchemaColumn[];
    hygiene?: DataHygiene;
  };
}

export interface UseSchemaMappingOptions {
  availableKeys: string[];
  initialMapping?: { columns: SchemaColumn[]; hygiene?: DataHygiene } | SchemaColumn[];
  sampleData?: Record<string, unknown>;
  isOpen: boolean;
}

export function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'text';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'date';

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return 'date';
    if (value.trim() !== '' && !isNaN(Number(value))) return 'number';
  }

  if (typeof value === 'object') return 'json';
  return 'text';
}

export function resolvePath(obj: unknown, path: string): unknown {
  if (!obj) return undefined;
  return path.split('.').reduce((o: unknown, i: string) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[i] : undefined), obj);
}

export function useSchemaMapping({
  availableKeys,
  initialMapping,
  sampleData,
  isOpen,
}: UseSchemaMappingOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Core Mapping State
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set());
  const [renameMap, setRenameMap] = useState<Record<string, string>>({});
  const [typeMap, setTypeMap] = useState<Record<string, string>>({});
  const [transformMap, setTransformMap] = useState<Record<string, string>>({});

  // UI State
  const [searchQuery, setSearchQuery] = useState("");
  const [patternAction, setPatternAction] = useState<{ type: string; value: string }>({ type: '', value: '' });
  const [page, setPage] = useState(1);
  const [newFieldName, setNewFieldName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Hygiene State
  const [activeTab, setActiveTab] = useState<'mapping' | 'hygiene'>('mapping');
  const [dedupEnabled, setDedupEnabled] = useState(false);
  const [dedupStrategy, setDedupStrategy] = useState<string>("keepFirst");
  const [dedupScope, setDedupScope] = useState<string>("batch");
  const [dedupGlobalConflict, setDedupGlobalConflict] = useState<string>("skip");
  const [dedupKeyColumns, setDedupKeyColumns] = useState<string[]>([]);
  const [nullStrategy, setNullStrategy] = useState<string>("keep");
  const [nullFillValue, setNullFillValue] = useState("");
  const [dropInvalidTypes, setDropInvalidTypes] = useState(false);

  const ITEMS_PER_PAGE = 50;

  // Templates
  const { data: templates } = useQuery<SchemaMappingTemplate[]>({
    queryKey: ['/api/templates/schema-mappings'],
    enabled: isOpen,
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (payload: { name: string; mappingConfig: unknown }) => {
      const res = await apiRequest("POST", "/api/templates/schema-mappings", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates/schema-mappings'] });
      toast({ title: "Template Saved", description: "Mapping configuration saved as template." });
      setIsSavingTemplate(false);
      setTemplateName("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save template.", variant: "destructive" });
    },
  });

  const loadMappingState = (config: { columns: SchemaColumn[]; hygiene?: DataHygiene } | SchemaColumn[]) => {
    let columns: SchemaColumn[] = [];
    let hygiene: DataHygiene | undefined;

    if (Array.isArray(config)) {
      columns = config;
    } else {
      columns = config.columns || [];
      hygiene = config.hygiene;
    }

    const selected = new Set<string>();
    const renames: Record<string, string> = {};
    const types: Record<string, string> = {};
    const transforms: Record<string, string> = {};

    columns.forEach(col => {
      selected.add(col.jsonPath);
      if (col.jsonPath !== col.datasetKey) renames[col.jsonPath] = col.datasetKey;
      types[col.jsonPath] = col.type || 'text';
      transforms[col.jsonPath] = col.transform || 'none';
    });

    if (hygiene) {
      setDedupEnabled(hygiene.deduplication?.enabled ?? false);
      setDedupStrategy(hygiene.deduplication?.strategy ?? 'keepFirst');
      setDedupKeyColumns(hygiene.deduplication?.keyColumns ?? []);
      setDedupScope(hygiene.deduplication?.scope ?? 'batch');
      setDedupGlobalConflict(hygiene.deduplication?.globalConflictResolution ?? 'skip');
      setNullStrategy(hygiene.nullHandling?.strategy ?? 'keep');
      setNullFillValue(hygiene.nullHandling?.fillValue ?? '');
      setDropInvalidTypes(hygiene.validation?.dropInvalidTypes ?? false);
    } else {
      setDedupEnabled(false);
      setDedupStrategy('keepFirst');
      setDedupKeyColumns([]);
      setDedupScope('batch');
      setDedupGlobalConflict('skip');
      setNullStrategy('keep');
      setNullFillValue('');
      setDropInvalidTypes(false);
    }

    setSelectedKeys(selected);
    setRenameMap(renames);
    setTypeMap(types);
    setTransformMap(transforms);
  };

  useEffect(() => {
    if (isOpen) {
      const hasInitialMapping = Array.isArray(initialMapping)
        ? initialMapping.length > 0
        : (initialMapping?.columns && initialMapping.columns.length > 0);

      if (hasInitialMapping && initialMapping) {
        loadMappingState(initialMapping);
      } else if (availableKeys.length > 0 && selectedKeys.size === 0) {
        setSelectedKeys(new Set(availableKeys));
        const initialTypes: Record<string, string> = {};
        if (sampleData) {
          availableKeys.forEach(k => {
            const val = resolvePath(sampleData, k);
            initialTypes[k] = inferType(val);
          });
        } else {
          availableKeys.forEach(k => { initialTypes[k] = 'text'; });
        }
        setTypeMap(initialTypes);
      }
    }
  }, [isOpen, availableKeys, initialMapping, sampleData]);

  const allKeys = useMemo(() => {
    const set = new Set(availableKeys);
    manualKeys.forEach(k => set.add(k));
    return Array.from(set);
  }, [availableKeys, manualKeys]);

  const displayedKeys = allKeys
    .filter(key => key.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const totalPages = Math.ceil(displayedKeys.length / ITEMS_PER_PAGE);
  const paginatedKeys = displayedKeys.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [searchQuery]);

  const getCurrentMapping = () => {
    const columns = Array.from(selectedKeys).map(key => ({
      jsonPath: key,
      datasetKey: renameMap[key] || key,
      type: typeMap[key] || 'text',
      transform: transformMap[key] || 'none',
    }));

    const hygiene: DataHygiene = {
      deduplication: {
        enabled: dedupEnabled,
        strategy: dedupStrategy as 'keepFirst' | 'keepLast',
        keyColumns: dedupKeyColumns.length > 0 ? dedupKeyColumns : undefined,
        scope: dedupScope as 'batch' | 'global',
        globalConflictResolution: dedupGlobalConflict as 'skip' | 'update',
      },
      nullHandling: {
        strategy: nullStrategy as 'keep' | 'drop' | 'fill',
        fillValue: nullFillValue || undefined,
      },
      validation: { dropInvalidTypes },
    };

    return { columns, hygiene };
  };

  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    const targetNames = new Map<string, string>();
    selectedKeys.forEach(key => {
      const target = renameMap[key] || key;
      if (targetNames.has(target)) {
        issues.push(`Duplicate target column "${target}" (from ${key} and ${targetNames.get(target)})`);
      }
      targetNames.set(target, key);
    });
    return issues;
  }, [selectedKeys, renameMap]);

  const toggleKey = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const handleSelectAll = () => {
    const next = new Set(selectedKeys);
    displayedKeys.forEach(key => next.add(key));
    setSelectedKeys(next);
  };

  const handleDeselectAll = () => {
    const next = new Set(selectedKeys);
    displayedKeys.forEach(key => next.delete(key));
    setSelectedKeys(next);
  };

  const handleAddField = () => {
    if (!newFieldName) return;
    setManualKeys(prev => new Set(prev).add(newFieldName));
    setSelectedKeys(prev => new Set(prev).add(newFieldName));
    setNewFieldName("");
  };

  const handleRemovePrefix = () => {
    const prefix = patternAction.value;
    if (!prefix) return;
    const newRenames = { ...renameMap };
    selectedKeys.forEach(key => {
      if (key.startsWith(prefix)) {
        const currentName = renameMap[key] || key;
        if (currentName.startsWith(prefix)) {
          newRenames[key] = currentName.substring(prefix.length);
        }
      }
    });
    setRenameMap(newRenames);
    setPatternAction({ type: '', value: '' });
  };

  const handleBulkType = (type: string) => {
    const pattern = patternAction.value;
    const newTypes = { ...typeMap };
    displayedKeys.forEach(key => {
      if (pattern && !key.toLowerCase().includes(pattern.toLowerCase())) return;
      if (selectedKeys.has(key)) newTypes[key] = type;
    });
    setTypeMap(newTypes);
    setPatternAction({ type: '', value: '' });
  };

  const handleSaveTemplate = () => {
    if (!templateName) return;
    saveTemplateMutation.mutate({
      name: templateName,
      mappingConfig: getCurrentMapping(),
    });
  };

  return {
    // Mapping state
    selectedKeys,
    setSelectedKeys,
    manualKeys,
    renameMap,
    setRenameMap,
    typeMap,
    setTypeMap,
    transformMap,
    setTransformMap,
    searchQuery,
    setSearchQuery,
    patternAction,
    setPatternAction,
    page,
    setPage,
    newFieldName,
    setNewFieldName,
    templateName,
    setTemplateName,
    isSavingTemplate,
    setIsSavingTemplate,
    // Hygiene state
    activeTab,
    setActiveTab,
    dedupEnabled,
    setDedupEnabled,
    dedupStrategy,
    setDedupStrategy,
    dedupScope,
    setDedupScope,
    dedupGlobalConflict,
    setDedupGlobalConflict,
    dedupKeyColumns,
    setDedupKeyColumns,
    nullStrategy,
    setNullStrategy,
    nullFillValue,
    setNullFillValue,
    dropInvalidTypes,
    setDropInvalidTypes,
    // Derived
    allKeys,
    displayedKeys,
    paginatedKeys,
    totalPages,
    ITEMS_PER_PAGE,
    validationIssues,
    templates,
    // Actions
    loadMappingState,
    getCurrentMapping,
    toggleKey,
    handleSelectAll,
    handleDeselectAll,
    handleAddField,
    handleRemovePrefix,
    handleBulkType,
    handleSaveTemplate,
  };
}

