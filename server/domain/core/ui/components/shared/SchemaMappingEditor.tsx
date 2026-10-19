import { useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@domain-ui/core/ui/components/ui/dialog";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";
import {
    Wand2,
    AlertTriangle,
    ArrowRight,
    CaseSensitive,
    CaseLower,
    CaseUpper,
    Scissors,
    Type,
    CheckCircle2,
    Save,
    Upload,
    Settings2, // Icon for config
    Plus
} from "lucide-react";
import { useSchemaMapping, resolvePath, inferType, type SchemaColumn, type DataHygiene } from "@domain-ui/pipeline/ui/modules/pipelines/hooks/useSchemaMapping";
import { SchemaMappingHygiene } from './SchemaMappingHygiene.js';
import { Popover, PopoverContent, PopoverTrigger } from "@domain-ui/core/ui/components/ui/popover";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";

export type { SchemaColumn, DataHygiene };

interface SchemaMappingEditorProps {
    availableKeys: string[];
    initialMapping?: { columns: SchemaColumn[], hygiene?: DataHygiene } | SchemaColumn[]; // Backward compatibility
    onSave: (config: { columns: SchemaColumn[], hygiene?: DataHygiene }) => void;
    trigger?: React.ReactNode;
    title?: string;
    description?: string;
    sampleData?: Record<string, any>;
}

export function SchemaMappingEditor({
    availableKeys,
    initialMapping,
    onSave,
    trigger,
    title = "Normalize Data",
    description = "Select fields to keep, rename them, and define their data types.",
    sampleData
}: SchemaMappingEditorProps) {
    const [isOpen, setIsOpen] = useState(false);

    const mapping = useSchemaMapping({
        availableKeys,
        initialMapping,
        sampleData,
        isOpen,
    });

    const {
        selectedKeys,
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
        paginatedKeys,
        displayedKeys,
        totalPages,
        ITEMS_PER_PAGE,
        validationIssues,
        templates,
        loadMappingState,
        getCurrentMapping,
        toggleKey,
        handleSelectAll,
        handleDeselectAll,
        handleAddField,
        handleRemovePrefix,
        handleBulkType,
        handleSaveTemplate,
    } = mapping;

    const handleSave = () => {
        onSave(getCurrentMapping());
        setIsOpen(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="sm">
                        <Wand2 className="mr-2 h-4 w-4" />
                        Normalize
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="max-w-[1200px] max-h-[90vh] flex flex-col w-[95vw]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                {/* Tab Navigation */}
                <div className="flex px-4 border-b">
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'mapping' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
                        onClick={() => setActiveTab('mapping')}
                    >
                        Field Mapping
                    </button>
                    <button
                        className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === 'hygiene' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
                        onClick={() => setActiveTab('hygiene')}
                    >
                        Data Hygiene
                    </button>
                </div>

                {activeTab === 'mapping' ? (
                    <>
                        {/* Toolbar */}
                        <div className="flex flex-col gap-4 py-4 border-b px-4">
                            <div className="flex gap-2 items-center">
                                <Input
                                    placeholder="Search fields..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="flex-1 max-w-sm"
                                />
                                <Button variant="outline" size="sm" onClick={handleSelectAll}>
                                    Select All
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                                    Deselect All
                                </Button>

                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm">
                                            <Plus className="mr-2 h-4 w-4" />
                                            Add Field
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80">
                                        <div className="space-y-2">
                                            <h4 className="font-medium leading-none">Add Manual Field</h4>
                                            <p className="text-sm text-muted-foreground">Enter the JSON path for the field.</p>
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="path.to.field"
                                                    value={newFieldName}
                                                    onChange={e => setNewFieldName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleAddField();
                                                    }}
                                                />
                                                <Button onClick={handleAddField}>Add</Button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <div className="flex-1" />

                                {/* Templates Dropdown */}
                                <div className="flex items-center gap-2">
                                    <Select onValueChange={(val) => {
                                        const template = templates?.find(t => t.id.toString() === val);
                                        if (template) loadMappingState(template.mappingConfig);
                                    }}>
                                        <SelectTrigger className="w-[180px] h-9">
                                            <SelectValue placeholder="Load Template..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {templates?.map(t => (
                                                <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                                            ))}
                                            {(!templates || templates.length === 0) && (
                                                <div className="p-2 text-xs text-muted-foreground text-center">No templates found</div>
                                            )}
                                        </SelectContent>
                                    </Select>

                                    <Select
                                        value={patternAction.type}
                                        onValueChange={(val) => setPatternAction({ type: val, value: '' })}
                                    >
                                        <SelectTrigger className="w-[180px] h-9">
                                            <SelectValue placeholder="Bulk Actions..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="remove_prefix">Remove Prefix</SelectItem>
                                            <SelectItem value="set_type_text">Set Type: Text</SelectItem>
                                            <SelectItem value="set_type_number">Set Type: Number</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    {patternAction.type && (
                                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-5">
                                            <Input
                                                placeholder={patternAction.type === 'remove_prefix' ? "Prefix to remove..." : "Matching pattern..."}
                                                value={patternAction.value}
                                                onChange={e => setPatternAction({ ...patternAction, value: e.target.value })}
                                                className="w-40 h-9"
                                            />
                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    if (patternAction.type === 'remove_prefix') handleRemovePrefix();
                                                    if (patternAction.type === 'set_type_text') handleBulkType('text');
                                                    if (patternAction.type === 'set_type_number') handleBulkType('number');
                                                }}
                                            >
                                                Apply
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setPatternAction({ type: '', value: '' })}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {validationIssues.length > 0 && (
                                <Alert variant="destructive" className="py-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Configuration Issues</AlertTitle>
                                    <AlertDescription>
                                        <ul className="list-disc list-inside text-xs">
                                            {validationIssues.slice(0, 3).map((issue, i) => (
                                                <li key={i}>{issue}</li>
                                            ))}
                                            {validationIssues.length > 3 && <li>...and {validationIssues.length - 3} more</li>}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>

                        <div className="grid grid-cols-[30%_20%_15%_15%_20%] gap-4 font-semibold text-sm mb-2 px-4 text-muted-foreground">
                            <div>Source Field (Path)</div>
                            <div>Target Column</div>
                            <div>Data Type</div>
                            <div>Transform</div>
                            <div>Preview</div>
                        </div>

                        <ScrollArea className="flex-1 border rounded-md p-4 min-h-0 bg-muted/50 mx-4 mb-4">
                            <div className="space-y-2">
                                {paginatedKeys.map(key => {
                                    const isSelected = selectedKeys.has(key);
                                    const sampleValue = sampleData ? resolvePath(sampleData, key) : undefined;
                                    const sampleString = sampleValue !== undefined ? String(sampleValue) : '';

                                    return (
                                        <div
                                            key={key}
                                            className={`grid grid-cols-[30%_20%_15%_15%_20%] gap-4 items-center p-2 rounded-md transition-colors ${isSelected ? 'bg-card shadow-sm border border-border' : 'opacity-60 hover:opacity-100'
                                                }`}
                                        >
                                            {/* Source */}
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <Checkbox
                                                    id={`col-${key}`}
                                                    checked={isSelected}
                                                    onCheckedChange={() => toggleKey(key)}
                                                />
                                                <div className="flex flex-col overflow-hidden">
                                                    <Label htmlFor={`col-${key}`} className="truncate font-mono text-xs" title={key}>
                                                        {key}
                                                    </Label>
                                                    <span className="text-[10px] text-muted-foreground truncate">
                                                        {key.split('.').slice(0, -1).join('.')}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Target */}
                                            <div>
                                                <Input
                                                    placeholder={key}
                                                    value={renameMap[key] || ""}
                                                    onChange={(e) => setRenameMap(prev => ({ ...prev, [key]: e.target.value }))}
                                                    disabled={!isSelected}
                                                    className="h-8 text-xs font-mono"
                                                />
                                            </div>

                                            {/* Type */}
                                            <div>
                                                <Select
                                                    value={typeMap[key] || "text"}
                                                    onValueChange={(val) => setTypeMap(prev => ({ ...prev, [key]: val }))}
                                                    disabled={!isSelected}
                                                >
                                                    <SelectTrigger className={`h-8 text-xs ${typeMap[key] !== 'text' ? 'text-indigo-600 font-medium' : ''}`}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="text"><Type className="w-3 h-3 mr-2 inline" /> Text</SelectItem>
                                                        <SelectItem value="number"><span className="mr-2 font-mono">123</span> Number</SelectItem>
                                                        <SelectItem value="boolean"><CheckCircle2 className="w-3 h-3 mr-2 inline" /> Boolean</SelectItem>
                                                        <SelectItem value="date"><span className="mr-2">📅</span> Date</SelectItem>
                                                        <SelectItem value="json"><span className="mr-2 font-mono">{"{}"}</span> JSON</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* Transform */}
                                            <div>
                                                <Select
                                                    value={transformMap[key] || "none"}
                                                    onValueChange={(val) => setTransformMap(prev => ({ ...prev, [key]: val }))}
                                                    disabled={!isSelected}
                                                >
                                                    <SelectTrigger className={`h-8 text-xs ${transformMap[key] && transformMap[key] !== 'none' ? 'bg-orange-50 text-orange-700' : ''}`}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">None</SelectItem>
                                                        <SelectItem value="uppercase"><CaseUpper className="w-3 h-3 mr-2 inline" /> UPPERCASE</SelectItem>
                                                        <SelectItem value="lowercase"><CaseLower className="w-3 h-3 mr-2 inline" /> lowercase</SelectItem>
                                                        <SelectItem value="trim"><Scissors className="w-3 h-3 mr-2 inline" /> Trim</SelectItem>
                                                        <SelectItem value="regex"><span className="mr-2 font-mono">/re/</span> Regex</SelectItem>
                                                    </SelectContent>
                                                </Select>

                                                {transformMap[key]?.startsWith('regex:') && (() => {
                                                    const regexVal = transformMap[key].substring(6);
                                                    // Split safely: regex:/pattern/replacement/flags
                                                    // Delimiter is first char.
                                                    const delimiter = regexVal.charAt(0) || '/';
                                                    const parts = regexVal.substring(1).split(delimiter);
                                                    // parts[0] = pattern, parts[1] = replacement, parts[2] = flags
                                                    const pattern = parts[0] || '';
                                                    const replacement = parts[1] || '';
                                                    const flags = parts[2] || '';

                                                    // Helper to rebuild string
                                                    const updateRegex = (p: string, r: string, f: string) => {
                                                        // Escape delimiter in pattern/replacement? 
                                                        // For simplicity, we stick to / delimiter and assume simple use cases or user manual edit if needed.
                                                        // If pattern has /, we probably should pick another delimiter, but for this UI, let's enforce /
                                                        setTransformMap(prev => ({
                                                            ...prev,
                                                            [key]: `regex:/${p}/${r}/${f}`
                                                        }));
                                                    };

                                                    return (
                                                        <div className="mt-1 flex items-center gap-1">
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <Button variant="outline" size="sm" className="h-6 text-[10px] w-full justify-between">
                                                                        <span className="truncate">{regexVal || "Configure Regex"}</span>
                                                                        <Settings2 className="h-3 w-3 ml-1 opacity-50" />
                                                                    </Button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-80 p-4" align="start">
                                                                    <div className="space-y-4">
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs">Match Pattern (Regex)</Label>
                                                                            <Input
                                                                                className="h-8 text-xs font-mono"
                                                                                placeholder="^Prefix_"
                                                                                value={pattern}
                                                                                onChange={e => updateRegex(e.target.value, replacement, flags)}
                                                                            />
                                                                        </div>
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs">Replacement</Label>
                                                                            <Input
                                                                                className="h-8 text-xs font-mono"
                                                                                placeholder=""
                                                                                value={replacement}
                                                                                onChange={e => updateRegex(pattern, e.target.value, flags)}
                                                                            />
                                                                        </div>
                                                                        <div className="flex items-center gap-4">
                                                                            <div className="flex items-center gap-2">
                                                                                <Switch
                                                                                    id={`case-${key}`}
                                                                                    checked={flags.includes('i')}
                                                                                    onCheckedChange={(checked) => {
                                                                                        let newFlags = flags.replace('i', '');
                                                                                        if (checked) newFlags += 'i';
                                                                                        updateRegex(pattern, replacement, newFlags);
                                                                                    }}
                                                                                />
                                                                                <Label htmlFor={`case-${key}`} className="text-xs">Ignore Case</Label>
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <Switch
                                                                                    id={`global-${key}`}
                                                                                    checked={flags.includes('g')}
                                                                                    onCheckedChange={(checked) => {
                                                                                        let newFlags = flags.replace('g', '');
                                                                                        if (checked) newFlags += 'g';
                                                                                        updateRegex(pattern, replacement, newFlags);
                                                                                    }}
                                                                                />
                                                                                <Label htmlFor={`global-${key}`} className="text-xs">Global</Label>
                                                                            </div>
                                                                        </div>

                                                                        <div className="pt-2 border-t">
                                                                            <div className="text-[10px] text-muted-foreground mb-1">Preview Result:</div>
                                                                            <div className="bg-muted p-2 rounded text-xs font-mono break-all">
                                                                                {(() => {
                                                                                    try {
                                                                                        // Live preview logic locally
                                                                                        if (!pattern) return <span className="text-muted-foreground">Enter pattern...</span>;
                                                                                        if (!sampleString) return <span className="text-muted-foreground">No sample data</span>;
                                                                                        const re = new RegExp(pattern, flags);
                                                                                        return sampleString.replace(re, replacement);
                                                                                    } catch (e) {
                                                                                        return <span className="text-red-500">Invalid Regex</span>;
                                                                                    }
                                                                                })()}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </PopoverContent>
                                                            </Popover>
                                                        </div>
                                                    );
                                                })()}

                                            </div>

                                            {/* Preview */}
                                            <div className="text-xs text-muted-foreground truncate font-mono bg-muted p-1.5 rounded" title={sampleString}>
                                                {sampleString || <span className="italic text-muted-foreground">null</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                                {availableKeys.length === 0 && (
                                    <div className="text-center text-muted-foreground py-12">
                                        <div className="mb-2">No fields detected.</div>
                                        <span className="text-xs">Run this job once to capture output schema.</span>
                                    </div>
                                )}
                                {availableKeys.length > 0 && displayedKeys.length === 0 && (
                                    <div className="text-center text-muted-foreground py-12">
                                        No fields match your search.
                                    </div>
                                )}
                            </div>
                        </ScrollArea>

                        <div className="flex items-center justify-between px-4 py-2 border-t bg-muted mx-4">
                            <div className="text-xs text-muted-foreground">
                                Showing {((page - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(page * ITEMS_PER_PAGE, displayedKeys.length)} of {displayedKeys.length} items
                                {selectedKeys.size > 0 && ` • ${selectedKeys.size} selected`}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    </>
                ) : (
                    <SchemaMappingHygiene
                        dedupEnabled={dedupEnabled}
                        onDedupEnabledChange={setDedupEnabled}
                        dedupStrategy={dedupStrategy}
                        onDedupStrategyChange={setDedupStrategy}
                        dedupScope={dedupScope}
                        onDedupScopeChange={setDedupScope}
                        dedupGlobalConflict={dedupGlobalConflict}
                        onDedupGlobalConflictChange={setDedupGlobalConflict}
                        dedupKeyColumns={dedupKeyColumns}
                        onDedupKeyColumnsChange={setDedupKeyColumns}
                        nullStrategy={nullStrategy}
                        onNullStrategyChange={setNullStrategy}
                        nullFillValue={nullFillValue}
                        onNullFillValueChange={setNullFillValue}
                        dropInvalidTypes={dropInvalidTypes}
                        onDropInvalidTypesChange={setDropInvalidTypes}
                        selectedKeys={selectedKeys}
                        renameMap={renameMap}
                    />
                )}


                <DialogFooter className="px-4 pb-4 flex justify-between items-center bg-card border-t pt-4">
                    <div className="flex items-center gap-2">
                        {isSavingTemplate ? (
                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-5">
                                <Input
                                    placeholder="Template name..."
                                    className="h-8 w-40"
                                    value={templateName}
                                    onChange={e => setTemplateName(e.target.value)}
                                />
                                <Button size="sm" onClick={handleSaveTemplate} disabled={!templateName}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setIsSavingTemplate(false)}>Cancel</Button>
                            </div>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={() => setIsSavingTemplate(true)}>
                                <Save className="mr-2 h-4 w-4" /> Save as Template
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={validationIssues.length > 0}>Save Configuration</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

