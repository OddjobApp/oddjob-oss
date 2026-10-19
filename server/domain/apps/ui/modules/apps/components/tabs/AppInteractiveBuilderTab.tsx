import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { App, AppDeployment, AppTelemetry, AppAuditLog } from "@shared/schema/apps";

import {
    Send, Loader2, RefreshCw, Monitor, Terminal, Code2,
    ChevronRight, ChevronDown, Folder, FolderOpen,
    FileCode2, FileJson, File as FileIcon, FileText,
    BookOpen, Database, Workflow, Wrench, Globe, BrainCircuit,
    GitBranch, Bell, Cloud, Blocks, MessageSquare, Plug2, MousePointerSquareDashed, X,
    CheckCircle2, Circle, ExternalLink, Zap, Bot,
    LayoutTemplate, ChevronLeft, Bug, Sparkles, Dna, Save,
    MessageCircle, Hash, Activity, Compass, Target, Shield, Heart,
    ScanEye, Lightbulb, Brain, Play, Square, Layers, Cpu, Maximize2,
    LayoutGrid, Plus, Rocket
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { cn } from '@/lib/utils';
import styles from './AppInteractiveBuilderTab.module.css';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { useThrottledArrayState } from '@domain-ui/core/ui/hooks/use-throttled-state';
import { useEventStream } from '@domain-ui/core/ui/hooks/useEventStream';
import { BuilderChat } from './subcomponents/BuilderChat.js';
import { usePreviewSelection } from '../usePreviewSelection.js';
import { DevelopmentPlanView } from './subcomponents/DevelopmentPlanView.js';
import { VisualCanvasEditor } from './subcomponents/visual-editor/VisualCanvasEditor.js';
import { buildLayoutPrompt } from './subcomponents/visual-editor/canvas-layout.js';
import { PRIMITIVE_MIME, EXTERNAL_DRAG, slotInstructionFor, needsConfiguration, resolveDroppedComponent as resolveDropped, type DropSlot } from './subcomponents/drop-placement.js';
import { PublishAppModal } from './subcomponents/PublishAppModal.js';
import { ApiContractExplorer } from './subcomponents/ApiContractExplorer.js';

// ─── Types ───────────────────────────────────────────────────────────────────

import type { AppStudioSelection } from '@shared/app-studio-context';

interface AppInteractiveBuilderTabProps {
    onFocusInChat?: (selection: AppStudioSelection) => void;
    appId: number;
    app: App;
    onAppUpdated: () => void;
    /**
     * Where to land.
     *
     * The studio can be opened by a request that already says what it is for —
     * "fix this app" wants the logs, "publish it" wants the publish flow. Only
     * the initial state is seeded; the author's own navigation afterwards is
     * theirs, so this is not kept in sync with the prop.
     */
    initialView?: 'preview' | 'api' | 'diagnostics' | 'publish';
}

interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    ext?: string;
    size?: number;
    children?: FileNode[];
}

type PreviewMode = 'preview' | 'logs' | 'api';
type StudioTab = 'files' | 'visual' | 'primitives' | 'wiring' | 'soul' | 'plan' | 'telemetry' | 'audits';


// ─── Constants ───────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
    tsx:  { icon: FileCode2, color: 'text-blue-400' },
    jsx:  { icon: FileCode2, color: 'text-blue-400' },
    ts:   { icon: FileCode2, color: 'text-yellow-400' },
    js:   { icon: FileCode2, color: 'text-yellow-400' },
    css:  { icon: FileCode2, color: 'text-pink-400' },
    json: { icon: FileJson,  color: 'text-green-400' },
    md:   { icon: FileText,  color: 'text-muted-foreground' },
};

const TOOL_GROUPS = [
    { label: 'Knowledge',     icon: BookOpen,      color: 'text-blue-400',   count: 22, examples: ['search_unified_knowledge', 'search_knowledge_graph', 'get_entity_impact'] },
    { label: 'Operations',    icon: Workflow,       color: 'text-orange-400', count: 18, examples: ['trigger_pipeline', 'monitoring_query_metrics', 'cloud_invoke_function'] },
    { label: 'GitHub',        icon: GitBranch,      color: 'text-foreground',  count: 7,  examples: ['github_list_prs', 'github_create_issue', 'github_merge_pr'] },
    { label: 'Microsoft 365', icon: LayoutTemplate, color: 'text-cyan-400',   count: 7,  examples: ['teams_post_message', 'outlook_send_email', 'calendar_create_event'] },
    { label: 'Monitoring',    icon: Bell,           color: 'text-red-400',    count: 6,  examples: ['monitoring_get_incidents', 'monitoring_list_alerts', 'monitoring_trigger_alert'] },
    { label: 'Cloud',         icon: Cloud,          color: 'text-sky-400',    count: 3,  examples: ['cloud_invoke_function', 'cloud_list_functions', 'cloud_read_logs'] },
    { label: 'Web & SaaS',    icon: Globe,          color: 'text-green-400',  count: 45, examples: ['browse_web', 'google_search', 'saas_connector'] },
    { label: 'Data',          icon: Database,       color: 'text-purple-400', count: 12, examples: ['sql_query', 'dataset_query', 'analytics_query'] },
    { label: 'Utility',       icon: Wrench,         color: 'text-muted-foreground',  count: 8,  examples: ['current_time', 'python_execute', 'calculator'] },
];

export const UI_COMPONENT_GROUPS = [
    { label: 'Layout',             components: ['Card', 'Tabs', 'Sheet', 'Accordion', 'Resizable', 'ScrollArea', 'Separator', 'Sidebar'] },
    { label: 'Data & Tables',      components: ['DataTable', 'Table', 'Chart', 'Gauge', 'Progress', 'Stat', 'Carousel'] },
    { label: 'Media',              components: ['VideoPlayer', 'AudioPlayer', 'YouTubePlayer'] },
    { label: 'Maps & Location',    components: ['RescueMap', 'LocationInput'] },
    { label: 'Interactive',        components: ['Dialog', 'Popover', 'Command', 'Drawer', 'Tooltip', 'HoverCard', 'MenuBar'] },
    { label: 'Inputs',             components: ['Button', 'Input', 'Select', 'Checkbox', 'Switch', 'Slider', 'Textarea', 'Form'] },
    { label: 'Feedback',           components: ['Toast', 'Alert', 'Skeleton', 'Badge', 'Avatar'] },
    { label: 'Design & Hifi',      components: ['Stitch Design', 'FormRenderer', 'CopilotKit'] },
    // Every name here is imported as @domain-ui/packaged/<name>, so it must be a
    // real module — PlatformKanbanBoardBlock, PlatformWorkflowBuilderBlock and
    // PlatformMetricsDashboardBlock were listed here and do not exist.
    { label: '🔶 Platform Blocks', components: ['PlatformDatasetTableBlock', 'PlatformDatasetChartBlock', 'PlatformAgentChatBlock', 'PlatformAgentSwarmBlock', 'PlatformMissionsBlock', 'PlatformMissionLogBlock', 'PlatformPipelineTriggerBlock', 'PlatformHeroSliderBlock', 'PlatformWorkflowDiagramBlock', 'PlatformMetricGaugeBlock', 'PlatformMediaPlayerBlock', 'PlatformInteractiveModalBlock'] },
];

// ─── OCEAN Soul Constants ─────────────────────────────────────────────────────

const OCEAN_ARCHETYPES: Record<string, { o: number; c: number; e: number; a: number; n: number }> = {
    "Lead Directive":    { o: 0.6, c: 0.9, e: 0.7, a: 0.5, n: 0.2 },
    "Ghost Analyst":     { o: 0.9, c: 0.7, e: 0.2, a: 0.4, n: 0.3 },
    "The Quartermaster": { o: 0.5, c: 0.95, e: 0.4, a: 0.8, n: 0.1 },
};

const OCEAN_LABELS: { key: 'o' | 'c' | 'e' | 'a' | 'n'; label: string; desc: string }[] = [
    { key: 'o', label: 'Openness',          desc: 'Creative / Exploratory' },
    { key: 'c', label: 'Conscientiousness', desc: 'Methodical / Precise'   },
    { key: 'e', label: 'Extraversion',      desc: 'Energetic / Proactive'  },
    { key: 'a', label: 'Agreeableness',     desc: 'Cooperative / Empathetic' },
    { key: 'n', label: 'Neuroticism',       desc: 'Cautious / Risk-Aware'  },
];

// ─── Component Configurator Registry ─────────────────────────────────────────

interface ConfigField {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'toggle' | 'multiselect';
    options?: string[];
    optionsSource?: 'datasets' | 'agents' | 'pipelines' | 'collections';
    placeholder?: string;
    default?: string | boolean;
    required?: boolean;
    helpText?: string;
    rows?: number;
}

const COMPONENT_CONFIGS: Record<string, {
    fields: ConfigField[];
    buildPrompt: (cfg: Record<string, any>, file: string | null) => string;
}> = {
    Chart: {
        fields: [
            { key: 'type',       label: 'Chart Type',    type: 'select', options: ['Bar', 'Line', 'Pie', 'Area', 'Radar'],                              default: 'Bar' },
            { key: 'title',      label: 'Title',         type: 'text',   placeholder: 'e.g. Monthly Revenue' },
            { key: 'dataSource', label: 'Data Source',   type: 'select', options: ['Oddjob appRecords (platform-native)', 'Fetched from API on load', 'Passed as prop'], default: 'Oddjob appRecords (platform-native)' },
            { key: 'color',      label: 'Color Scheme',  type: 'select', options: ['Default', 'Blue', 'Emerald', 'Purple', 'Amber', 'Rose'],             default: 'Default' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a ${cfg.type || 'Bar'} Chart titled "${cfg.title || 'Chart'}". Data: ${cfg.dataSource === 'Oddjob appRecords (platform-native)' ? 'fetched from the Oddjob platform via GET /api/oddjob/datasets?collection=<name>' : (cfg.dataSource || 'fetched from the platform')}. Color: ${cfg.color || 'default'}. Use the shadcn Chart component from @domain-ui/core/ui/components/ui/chart.`,
    },
    Table: {
        fields: [
            { key: 'title',      label: 'Section Title',               type: 'text',   placeholder: 'e.g. Recent Users' },
            { key: 'columns',    label: 'Columns (comma-separated)',    type: 'text',   placeholder: 'e.g. id, name, status, date' },
            { key: 'dataSource', label: 'Data Source',   type: 'select', options: ['Oddjob appRecords (platform-native)', 'Fetched from API on load', 'Passed as prop'], default: 'Oddjob appRecords (platform-native)' },
            { key: 'pagination', label: 'Pagination',  type: 'toggle', default: true },
            { key: 'search',     label: 'Search Bar',  type: 'toggle', default: false },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const cols = cfg.columns ? ` with columns: ${cfg.columns}` : '';
            const extras = [cfg.pagination && 'pagination', cfg.search && 'a search bar'].filter(Boolean).join(' and ');
            const ds = cfg.dataSource === 'Oddjob appRecords (platform-native)' ? 'fetched from the Oddjob platform via GET /api/oddjob/datasets?collection=<name>' : (cfg.dataSource || 'platform records');
            return `${ctx}Add a Table section titled "${cfg.title || 'Data'}"${cols}. Data: ${ds}${extras ? `. Include ${extras}` : ''}. Use the shadcn Table component.`;
        },
    },
    Card: {
        fields: [
            { key: 'title',       label: 'Title',        type: 'text',   placeholder: 'e.g. Total Revenue' },
            { key: 'description', label: 'Description',  type: 'text',   placeholder: 'e.g. Last 30 days' },
            { key: 'contentType', label: 'Body Content', type: 'select', options: ['Metric / KPI value', 'Text paragraph', 'List of items', 'Embedded chart', 'Action buttons'], default: 'Metric / KPI value' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Card with title "${cfg.title || 'Card'}"${cfg.description ? `, description "${cfg.description}"` : ''}. Body: ${cfg.contentType || 'metric or KPI value'}.`,
    },
    Dialog: {
        fields: [
            { key: 'trigger',  label: 'Trigger Button Label', type: 'text',   placeholder: 'e.g. Open Settings' },
            { key: 'title',    label: 'Dialog Title',          type: 'text',   placeholder: 'e.g. Edit Configuration' },
            { key: 'bodyType', label: 'Body Content',          type: 'select', options: ['Confirmation prompt', 'Info / text content', 'Form fields', 'Custom content'], default: 'Confirmation prompt' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Dialog with trigger button "${cfg.trigger || 'Open'}". Title: "${cfg.title || 'Dialog'}". Body: ${cfg.bodyType || 'confirmation prompt'}. Use the shadcn Dialog component.`,
    },
    Form: {
        fields: [
            { key: 'fields',      label: 'Fields (comma-separated)', type: 'text',   placeholder: 'e.g. name, email, message' },
            { key: 'submitLabel', label: 'Submit Button Label',       type: 'text',   placeholder: 'e.g. Save Changes' },
            { key: 'layout',      label: 'Layout',                    type: 'select', options: ['Single column', 'Two columns', 'Inline row'], default: 'Single column' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a form with fields: ${cfg.fields || 'name, email'}. Submit button: "${cfg.submitLabel || 'Submit'}". Layout: ${cfg.layout || 'single column'}. Use shadcn Input, Label, and Button.`,
    },
    Tabs: {
        fields: [
            { key: 'tabs',       label: 'Tab Names (comma-separated)', type: 'text', placeholder: 'e.g. Overview, Details, Settings' },
            { key: 'defaultTab', label: 'Default Active Tab',           type: 'text', placeholder: 'First tab by default' },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const tabs = cfg.tabs || 'Tab 1, Tab 2, Tab 3';
            return `${ctx}Add a Tabs component with tabs: ${tabs}. Default: "${cfg.defaultTab || tabs.split(',')[0]?.trim() || 'Tab 1'}". Use the shadcn Tabs component.`;
        },
    },
    Button: {
        fields: [
            { key: 'label',   label: 'Label',    type: 'text',   placeholder: 'e.g. Save Changes' },
            { key: 'variant', label: 'Variant',  type: 'select', options: ['default', 'secondary', 'outline', 'ghost', 'destructive'], default: 'default' },
            { key: 'action',  label: 'On Click', type: 'select', options: ['No action', 'Navigate to a route', 'Trigger an API call', 'Open a dialog', 'Submit the form'], default: 'No action' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Button labelled "${cfg.label || 'Click me'}", variant "${cfg.variant || 'default'}", on click: ${cfg.action || 'no action'}.`,
    },
    Progress: {
        fields: [
            { key: 'label',     label: 'Label', type: 'text',   placeholder: 'e.g. Upload Progress' },
            { key: 'valueType', label: 'Value', type: 'select', options: ['Static 50%', 'Dynamic from component state', 'Dynamic from prop'], default: 'Static 50%' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Progress bar labelled "${cfg.label || 'Progress'}". Value: ${cfg.valueType || 'static 50%'}. Use the shadcn Progress component.`,
    },
    Select: {
        fields: [
            { key: 'label',       label: 'Field Label',                 type: 'text', placeholder: 'e.g. Choose status' },
            { key: 'options',     label: 'Options (comma-separated)',    type: 'text', placeholder: 'e.g. Active, Inactive, Pending' },
            { key: 'placeholder', label: 'Placeholder Text',             type: 'text', placeholder: 'e.g. Select an option...' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Select dropdown labelled "${cfg.label || 'Select'}" with options: ${cfg.options || 'Option A, Option B, Option C'}. Placeholder: "${cfg.placeholder || 'Select…'}".`,
    },
    Badge: {
        fields: [
            { key: 'text',    label: 'Text',    type: 'text',   placeholder: 'e.g. Active' },
            { key: 'variant', label: 'Variant', type: 'select', options: ['default', 'secondary', 'outline', 'destructive'], default: 'default' },
            { key: 'context', label: 'Used as', type: 'select', options: ['Standalone label', 'Status indicator on a card', 'Tag in a list'], default: 'Standalone label' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Badge with text "${cfg.text || 'Badge'}", variant "${cfg.variant || 'default'}", used as: ${cfg.context || 'standalone label'}.`,
    },
    VideoPlayer: {
        fields: [
            { key: 'src',   label: 'Video URL or path',  type: 'text', placeholder: 'e.g. /public/video.mp4 or https://...' },
            { key: 'title', label: 'Player Title / Label', type: 'text', placeholder: 'e.g. Product Demo' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a VideoPlayer component. Source: "${cfg.src || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'}". Title: "${cfg.title || 'Media Player'}". Import from "@domain-ui/core/ui/components/ui/video-player". Use glassmorphic styling.`,
    },
    AudioPlayer: {
        fields: [
            { key: 'src',    label: 'Audio URL or path', type: 'text', placeholder: 'e.g. /public/track.mp3 or https://...' },
            { key: 'title',  label: 'Track Title',       type: 'text', placeholder: 'e.g. Background Ambience' },
            { key: 'artist', label: 'Artist / Source',   type: 'text', placeholder: 'e.g. Oddjob Audio' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add an AudioPlayer component. Source: "${cfg.src || 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'}". Title: "${cfg.title || 'Audio Player'}", Artist: "${cfg.artist || ''}". Import from "@domain-ui/core/ui/components/ui/audio-player".`,
    },
    DataTable: {
        fields: [
            { key: 'title',        label: 'Section Title',               type: 'text',   placeholder: 'e.g. Active Users' },
            { key: 'columns',      label: 'Column names (comma-sep)',     type: 'text',   placeholder: 'e.g. id, name, status, date' },
            { key: 'searchable',   label: 'Searchable',                   type: 'toggle', default: true },
            { key: 'customCells',  label: 'Custom cell rendering',        type: 'toggle', default: true },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const cols = cfg.columns || 'id, name, status, createdAt';
            const search = cfg.searchable ? ' Include a search bar.' : '';
            const cells = cfg.customCells ? ' Use custom cell renderers with Badge for status and progress bars for numeric fields.' : '';
            const ds = cfg.dataSource === 'Oddjob appRecords (platform-native)' ? 'fetched from the Oddjob platform via GET /api/oddjob/datasets?collection=<name>' : (cfg.dataSource || 'platform records');
            return `${ctx}Add a DataTable section titled "${cfg.title || 'Data'}". Columns: ${cols}. Data: ${ds}.${search}${cells} Import DataTable and Column from "@domain-ui/core/ui/components/ui/data-table". Use typed column definitions with \`accessorKey\` and \`cell\` renderers.`;
        },
    },
    Gauge: {
        fields: [
            { key: 'label',     label: 'Metric Label',   type: 'text',   placeholder: 'e.g. System Health' },
            { key: 'valueType', label: 'Value Source',   type: 'select', options: ['Static 75%', 'Linked to a Slider', 'Dynamic from API'], default: 'Static 75%' },
            { key: 'color',     label: 'Gauge Color',    type: 'select', options: ['#6366f1 (Indigo)', '#f3ca50 (Gold)', '#10b981 (Emerald)', '#f43f5e (Rose)'], default: '#6366f1 (Indigo)' },
        ],
        buildPrompt: (cfg, file) => {
            const color = (cfg.color || '#6366f1 (Indigo)').split(' ')[0];
            return `${file ? `[Editing ${file}]\n\n` : ''}Add a Gauge (circular dial/meter) component labeled "${cfg.label || 'Gauge'}". Value source: ${cfg.valueType || 'Static 75%'}. Color: "${color}". Import Gauge from "@domain-ui/core/ui/components/ui/gauge". Props: value (0-100), max, size (px), color (hex).`;
        },
    },
    Slider: {
        fields: [
            { key: 'label',   label: 'Label',      type: 'text',   placeholder: 'e.g. Volume' },
            { key: 'min',     label: 'Min Value',  type: 'text',   placeholder: '0' },
            { key: 'max',     label: 'Max Value',  type: 'text',   placeholder: '100' },
            { key: 'linked',  label: 'Bind to Gauge/State', type: 'toggle', default: false },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a Slider component labeled "${cfg.label || 'Slider'}" with range ${cfg.min || 0}–${cfg.max || 100}.${cfg.linked ? ' Wire its onValueChange to update a state variable and pass that value to a Gauge component.' : ''} Import from "@domain-ui/core/ui/components/ui/slider".`,
    },
    RescueMap: {
        fields: [
            { key: 'centerLat',  label: 'Default Center Lat',   type: 'text',   placeholder: 'e.g. 40.748' },
            { key: 'centerLng',  label: 'Default Center Lng',   type: 'text',   placeholder: 'e.g. -73.985' },
            { key: 'zoom',       label: 'Default Zoom Level',   type: 'select', options: ['10 (City)', '13 (Neighbourhood)', '15 (Street)', '17 (Building)'], default: '13 (Neighbourhood)' },
            { key: 'markers',    label: 'Marker Data Source',   type: 'select', options: ['Static example markers', 'Fetched from platform dataset', 'Passed as prop'], default: 'Fetched from platform dataset' },
            { key: 'routing',    label: 'Show Route Overlay',   type: 'toggle', default: false },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const lat = cfg.centerLat || '40.7484';
            const lng = cfg.centerLng || '-73.9857';
            const zoom = parseInt((cfg.zoom || '13 (Neighbourhood)').split(' ')[0]) || 13;
            const markerSrc = cfg.markers === 'Fetched from platform dataset' ? 'fetched via GET /api/oddjob/datasets?collection=locations and mapped to { id, lat, lng, label }' : (cfg.markers || 'static example markers');
            const route = cfg.routing ? ' Include a routePoints prop and render a GeoJSON route line overlay.' : '';
            return `${ctx}Add an interactive Mapbox map using RescueMap from "@domain-ui/rescue/ui/modules/rescue/components/RescueMap". Center: { lat: ${lat}, lng: ${lng} }, zoom: ${zoom}. Markers: ${markerSrc}.${route} Requires VITE_MAPBOX_ACCESS_TOKEN env var. Wrap in a Card with a height of at least 400px.`;
        },
    },
    LocationInput: {
        fields: [
            { key: 'label',       label: 'Field Label',       type: 'text', placeholder: 'e.g. Pickup Address' },
            { key: 'stateVar',    label: 'State Variable',    type: 'text', placeholder: 'e.g. address' },
            { key: 'placeholder', label: 'Placeholder Text',  type: 'text', placeholder: 'e.g. Search for an address...' },
        ],
        buildPrompt: (cfg, file) => `${file ? `[Editing ${file}]\n\n` : ''}Add a LocationInput address autocomplete field labelled "${cfg.label || 'Address'}". Bind to state variable "${cfg.stateVar || 'address'}". Placeholder: "${cfg.placeholder || 'Search for an address...'}". Import LocationInput from "@domain-ui/core/ui/components/ui/location-input".`,
    },
    'Stitch Design': {
        fields: [
            { key: 'style', label: 'Design Style', type: 'select', options: ['Sovereign Intelligence (Gold/Obsidian)', 'Glassmorphism (Dark)', 'Command Interface (Emerald/Navy)', 'Agency Maturity (Electric Blue)', 'Minimalist Light'], default: 'Sovereign Intelligence (Gold/Obsidian)' },
            { key: 'scope', label: 'Scope', type: 'select', options: ['Entire Page', 'Active Section', 'New Dashboard Layout'], default: 'Entire Page' },
        ],
        buildPrompt: (cfg, file) => {
            const styleMap: Record<string, string> = {
                'Sovereign Intelligence (Gold/Obsidian)': 'Dark obsidian background (#131313), Aureate Gold primary (#f3ca50), Space Grotesk + Manrope fonts, no border lines (use background color shifts for structure), glassmorphic floating panels.',
                'Glassmorphism (Dark)': 'Deep slate background, backdrop-blur-md panels with bg-foreground/10 border border-foreground/20, indigo/violet gradient accents.',
                'Command Interface (Emerald/Navy)': 'Deep navy background (#060e20), Emerald primary (#69f6b8), Cyan secondary (#53ddfc), Manrope body font.',
                'Agency Maturity (Electric Blue)': 'Near-black background (#10131a), Electric Blue primary (#00E5FF), Emerald secondary (#34FF8D), Gold tertiary (#F4CE00).',
                'Minimalist Light': 'White background, slate-900 text, Inter font, clean card layout, no glassmorphism.',
            };
            const styleInstructions = styleMap[cfg.style || Object.keys(styleMap)[0]] || styleMap['Sovereign Intelligence (Gold/Obsidian)'];
            return `${file ? `[Editing ${file}]\n\n` : ''}Redesign the ${cfg.scope || 'Entire Page'} using this exact design system: ${styleInstructions} Do NOT use plain white backgrounds or generic styling. Replace all colors with the specified palette. Use the Oddjob UI component library.`;
        },
    },
    // ─── Platform Blocks (Self-Wiring) ─────────────────────────────────────────
    PlatformDatasetTableBlock: {
        fields: [
            { key: 'collection', label: 'Dataset Collection', type: 'text', placeholder: 'e.g. contacts, orders, inventory', required: true, helpText: 'The Oddjob dataset collection name this table will manage' },
            { key: 'title', label: 'Table Title', type: 'text', placeholder: 'e.g. Customer Records' },
            { key: 'columnsJson', label: 'Column Definitions (JSON)', type: 'textarea', placeholder: '[\n  {"key":"name","label":"Name","type":"text"},\n  {"key":"status","label":"Status","type":"badge"}\n]', required: true, rows: 6, helpText: 'Array of {key, label, type} objects. Types: text, badge, currency, date, number' },
            { key: 'allowCreate', label: 'Allow Create', type: 'toggle', default: true, helpText: 'Show "New" button and create modal' },
            { key: 'allowEdit', label: 'Allow Edit', type: 'toggle', default: true, helpText: 'Show edit action on each row' },
            { key: 'allowDelete', label: 'Allow Delete', type: 'toggle', default: true, helpText: 'Show delete action on each row' },
            { key: 'pageSize', label: 'Page Size', type: 'select', options: ['5', '10', '25', '50', '100'], default: '10' },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const columns = cfg.columnsJson || '[{key:"id",label:"ID",type:"text"}]';
            const props = [
                `collection="${cfg.collection}"`,
                `columns={${columns}}`,
                cfg.title && `title="${cfg.title}"`,
                cfg.allowCreate === 'false' ? 'allowCreate={false}' : 'allowCreate={true}',
                cfg.allowEdit === 'false' ? 'allowEdit={false}' : 'allowEdit={true}',
                cfg.allowDelete === 'false' ? 'allowDelete={false}' : 'allowDelete={true}',
                cfg.pageSize && cfg.pageSize !== '10' && `pageSize={${cfg.pageSize}}`,
            ].filter(Boolean).join(' ');
            return `${ctx}Add a PlatformDatasetTableBlock (${props}). This is a self-wiring CRUD table connected to the Oddjob platform via /api/oddjob/datasets. Import from "@domain-ui/packaged/PlatformDatasetTableBlock".`;
        },
    },
    PlatformAgentChatBlock: {
        fields: [
            { key: 'agentId', label: 'Agent ID', type: 'text', placeholder: 'e.g. 42', required: true, helpText: 'The Oddjob agent ID to connect this chat to' },
            { key: 'personaName', label: 'Persona Name', type: 'text', placeholder: 'e.g. Support Assistant', default: 'AI Assistant' },
            { key: 'suggestedPrompts', label: 'Suggested Prompts', type: 'textarea', placeholder: 'What are your hours?\nHow do I reset my password?', rows: 3, helpText: 'One per line - shown as quick-action buttons' },
            { key: 'collectionName', label: 'Message Persistence Dataset', type: 'text', placeholder: 'e.g. chat_history', helpText: 'Optional - saves conversation history to this dataset' },
            { key: 'height', label: 'Height', type: 'select', options: ['400px', '600px', '800px', '100%'], default: '600px' },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const prompts = cfg.suggestedPrompts?.split('\n').filter(Boolean) || [];
            const props = [
                `agentId={${cfg.agentId}}`,
                cfg.personaName && `personaName="${cfg.personaName}"`,
                prompts.length > 0 && `suggestedPrompts={[${prompts.map((p: string) => `"${p.trim()}"`).join(', ')}]}`,
                cfg.collectionName && `collectionName="${cfg.collectionName}"`,
                cfg.height && cfg.height !== '600px' && `height="${cfg.height}"`,
            ].filter(Boolean).join(' ');
            return `${ctx}Add a PlatformAgentChatBlock (${props}). This is a self-wiring chat interface with SSE streaming from /api/oddjob/agents/{agentId}/chat. Import from "@domain-ui/packaged/PlatformAgentChatBlock".`;
        },
    },
    PlatformMissionsBlock: {
        fields: [
            { key: 'title', label: 'Title', type: 'text', default: 'Missions' },
            { key: 'allowLaunch', label: 'Allow Launch', type: 'toggle', default: false, helpText: 'Show "Launch Mission" button (requires mission:create permission)' },
            { key: 'allowAbort', label: 'Allow Abort', type: 'toggle', default: true, helpText: 'Show abort action on active missions' },
            { key: 'pollingIntervalMs', label: 'Poll Interval (ms)', type: 'select', options: ['2000', '5000', '10000', '30000'], default: '5000', helpText: 'How often to refresh mission status' },
            { key: 'enableLogLink', label: 'Link to Log Viewer', type: 'toggle', default: true, helpText: 'Clicking a mission opens PlatformMissionLogBlock' },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const props = [
                cfg.title && cfg.title !== 'Missions' && `title="${cfg.title}"`,
                cfg.allowLaunch === 'true' && 'allowLaunch={true}',
                cfg.allowAbort === 'false' && 'allowAbort={false}',
                cfg.pollingIntervalMs && cfg.pollingIntervalMs !== '5000' && `pollingIntervalMs={${cfg.pollingIntervalMs}}`,
            ].filter(Boolean).join(' ');
            let code = `${ctx}Add a PlatformMissionsBlock${props ? ` (${props})` : ''}. `;
            if (cfg.enableLogLink !== 'false') {
                code += `Also add state: const [activeMissionId, setActiveMissionId] = useState<number|null>(null); and conditionally render PlatformMissionLogBlock when activeMissionId is set. `;
            }
            code += `This polls /api/oddjob/missions for live mission status. Import from "@domain-ui/packaged/PlatformMissionsBlock".`;
            return code;
        },
    },
    PlatformMissionLogBlock: {
        fields: [
            { key: 'missionIdSource', label: 'Mission ID Source', type: 'select', options: ['From parent state', 'Fixed ID', 'From URL param'], default: 'From parent state', required: true },
            { key: 'missionId', label: 'Fixed Mission ID', type: 'text', placeholder: 'e.g. 42' },
            { key: 'title', label: 'Title', type: 'text', default: 'Mission Log' },
            { key: 'maxLines', label: 'Max Lines', type: 'select', options: ['100', '300', '500', '1000'], default: '300' },
            { key: 'height', label: 'Height', type: 'select', options: ['300px', '400px', '600px', '100%'], default: '400px' },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const missionId = cfg.missionIdSource === 'Fixed ID' ? cfg.missionId : cfg.missionIdSource === 'From URL param' ? 'Number(router.query.missionId)' : 'activeMissionId';
            const props = [
                `missionId={${missionId}}`,
                cfg.title && cfg.title !== 'Mission Log' && `title="${cfg.title}"`,
                cfg.maxLines && cfg.maxLines !== '300' && `maxLines={${cfg.maxLines}}`,
                cfg.height && cfg.height !== '400px' && `height="${cfg.height}"`,
            ].filter(Boolean).join(' ');
            return `${ctx}Add a PlatformMissionLogBlock (${props}). This displays live streaming logs from /api/oddjob/missions/{missionId}/logs. Auto-stops when mission completes. Import from "@domain-ui/packaged/PlatformMissionLogBlock".`;
        },
    },
    PlatformPipelineTriggerBlock: {
        fields: [
            { key: 'allowedPipelineIds', label: 'Pipeline Trigger IDs', type: 'text', placeholder: 'e.g. 1, 5, 12', helpText: 'Comma-separated pipeline IDs the app is allowed to invoke. Leave empty to show all available pipelines' },
            { key: 'title', label: 'Title', type: 'text', default: 'Pipeline Trigger' },
            { key: 'showExecutionHistory', label: 'Show Step History', type: 'toggle', default: true },
        ],
        buildPrompt: (cfg, file) => {
            const ctx = file ? `[Editing ${file}]\n\n` : '';
            const ids = cfg.allowedPipelineIds ? `allowedPipelineIds={[${cfg.allowedPipelineIds.split(',').map((s: string) => s.trim()).join(', ')}]}` : '';
            const props = [
                ids,
                cfg.title && cfg.title !== 'Pipeline Trigger' && `title="${cfg.title}"`,
                cfg.showExecutionHistory === 'false' && 'showExecutionHistory={false}',
            ].filter(Boolean).join(' ');
            return `${ctx}Add a PlatformPipelineTriggerBlock${props ? ` (${props})` : ''}. This provides a pipeline selector, trigger button, and polls /api/oddjob/pipelines/executions/{execId} for step-by-step status. Import from "@domain-ui/packaged/PlatformPipelineTriggerBlock".`;
        },
    },
};

// ─── Tool Composer Helpers ────────────────────────────────────────────────────

const TOOL_DISPLAY_OPTIONS = ['Table', 'Card', 'List of items', 'Chart', 'Metric value', 'JSON (debug)'] as const;
const TOOL_TRIGGER_OPTIONS  = ['On page load', 'On button click', 'On form submit', 'On interval (30s)'] as const;
const TOOL_ERROR_OPTIONS    = ['Hide the section', 'Show an error alert', 'Show an empty state'] as const;

function buildToolComposerPrompt(
    toolName: string,
    cfg: { sectionTitle: string; displayAs: string; trigger: string; showLoading: boolean; onError: string },
    file: string | null
): string {
    const ctx = file ? `[Editing ${file}]\n\n` : '';
    const loading = cfg.showLoading ? ' Show a Skeleton loading state while fetching.' : '';
    const errorBehavior =
        cfg.onError === 'Show an error alert'  ? ' Show an error Alert if the call fails.' :
        cfg.onError === 'Show an empty state'  ? ' Show a friendly empty state if no data is returned.' :
        ' Hide the section if the call fails.';
    return `${ctx}Add a section titled "${cfg.sectionTitle || toolName}" that calls the \`${toolName}\` tool ${(cfg.trigger || 'on page load').toLowerCase()}. Display results as a ${cfg.displayAs || 'Table'}.${loading}${errorBehavior}`.trim();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const FileTreeNode = React.memo(({
    node, depth, expanded, onToggle, onSelect, selectedPath,
}: {
    node: FileNode; depth: number; expanded: Set<string>;
    onToggle: (p: string) => void; onSelect: (n: FileNode) => void; selectedPath?: string;
}) => {
    const isOpen = expanded.has(node.path);
    const isSelected = selectedPath === node.path;
    const indent = depth * 12;

    if (node.type === 'dir') {
        return (
            <div>
                <motion.button
                    onClick={() => onToggle(node.path)}
                    className={cn("w-full flex items-center gap-1.5 px-2 py-0.5 text-xs hover:bg-foreground/5 text-foreground rounded", styles.dynamicPadding)}
                    initial={false}
                    animate={{ paddingLeft: depth * 12 + 8 }}
                    transition={{ duration: 0.1 }}
                >
                    {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />}
                    {isOpen ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-yellow-400/80" /> : <Folder className="w-3.5 h-3.5 flex-shrink-0 text-yellow-400/80" />}
                    <span className="truncate">{node.name}</span>
                </motion.button>
                {isOpen && node.children?.map(child => (
                    <FileTreeNode key={child.path} node={child} depth={depth + 1}
                        expanded={expanded} onToggle={onToggle} onSelect={onSelect} selectedPath={selectedPath} />
                ))}
            </div>
        );
    }

    const iconDef = FILE_ICONS[node.ext || ''] || { icon: FileIcon, color: 'text-muted-foreground' };
    const IconComp = iconDef.icon;

    return (
        <motion.button
            onClick={() => onSelect(node)}
            className={cn(
                "w-full flex items-center gap-1.5 px-2 py-0.5 text-xs rounded truncate",
                styles.dynamicPadding,
                isSelected ? 'bg-primary/20 text-primary' : 'hover:bg-foreground/5 text-muted-foreground'
            )}
            initial={false}
            animate={{ paddingLeft: depth * 12 + 8 }}
            transition={{ duration: 0.1 }}
        >
            <IconComp className={`w-3.5 h-3.5 flex-shrink-0 ${iconDef.color}`} />
            <span className="truncate">{node.name}</span>
            {node.size != null && (
                <span className="ml-auto text-muted-foreground text-[10px] flex-shrink-0">
                    {node.size < 1024 ? `${node.size}b` : `${(node.size / 1024).toFixed(1)}k`}
                </span>
            )}
        </motion.button>
    );
});

FileTreeNode.displayName = 'FileTreeNode';

const PlumbingRow = React.memo(({ icon: Icon, label, value, linked }: {
    icon: React.ElementType; label: string; value: string; linked: boolean;
}) => {
    return (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <Icon className={`w-3 h-3 flex-shrink-0 ${linked ? 'text-emerald-400' : 'text-muted-foreground'}`} />
            <span className="text-muted-foreground w-16 flex-shrink-0">{label}</span>
            <span className={`truncate ${linked ? 'text-foreground' : 'text-muted-foreground'}`}>{value}</span>
        </div>
    );
});

PlumbingRow.displayName = 'PlumbingRow';

function FileContentViewer({ appId, filePath, onClose }: { appId: number; filePath: string; onClose: () => void }) {
    const { data, isLoading } = useQuery<{ content: string; path: string }>({
        queryKey: [`/api/apps/${appId}/files/content`, filePath],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/files/content?path=${encodeURIComponent(filePath)}`);
            if (!res.ok) throw new Error('Failed to load file');
            return res.json();
        },
        enabled: !!filePath,
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-background">
            <div className="flex items-center justify-between px-3 py-2 border-b border-foreground/10 bg-background/40">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                    <Code2 className="w-3.5 h-3.5" />
                    <span>{filePath}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={onClose} data-testid="close-file-viewer">
                    <ChevronLeft className="w-4 h-4" />
                </Button>
            </div>
            <ScrollArea className="flex-1">
                {isLoading ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Loading…</div>
                ) : (
                    <pre className="text-xs font-mono text-foreground p-4 whitespace-pre-wrap leading-relaxed">
                        {data?.content}
                    </pre>
                )}
            </ScrollArea>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AppInteractiveBuilderTab({ appId, app, onAppUpdated, initialView = 'preview', onFocusInChat }: AppInteractiveBuilderTabProps) {
    const { toast } = useToast();

    // ── Preview / layout state
    const [previewMode, setPreviewMode] = useState<PreviewMode>(
        initialView === 'api' ? 'api' : initialView === 'diagnostics' ? 'logs' : 'preview',
    );
    // Element selection inside the preview, used to scope a change request.
    const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
    // The pane the highlights draw into. Its overflow-hidden clips them, so a
    // selection can never paint over the chat rail or its composer.
    const previewPaneRef = useRef<HTMLDivElement | null>(null);
    const preview = usePreviewSelection(previewIframeRef, previewPaneRef);

    // Seeds the chat composer when a control elsewhere starts a change request.
    const [chatDraft, setChatDraft] = useState('');

    // 'files' is the landing tab now that chat has its own rail.
    const [activeStudioTab, setActiveStudioTab] = useState<StudioTab>(
        initialView === 'diagnostics' ? 'audits' : 'files',
    );

    // ── UI state bits
    const [viewingFile, setViewingFile] = useState<string | null>(null);
    const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['pages', 'src', 'src/components']));
    const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(new Set());
    const [expandedUiGroups, setExpandedUiGroups] = useState<Set<string>>(new Set());

    // ── Chat state (isolated to BuilderChat, but history is shared)
    const CHAT_KEY = `oddjob:builder-chat:${appId}`;
    const WELCOME_MSG = { role: 'system' as const, content: 'Welcome to the App Studio. Describe a change or ask a design question — e.g. "What fonts are available?" or "Change the background to dark slate."' };
    
    // We remove the local 'prompt' state to isolate re-renders
    const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'system'; content: string }[]>(() => {
        try {
            const saved = sessionStorage.getItem(CHAT_KEY);
            if (saved) return JSON.parse(saved);
        } catch {}
        return [WELCOME_MSG];
    });

    // ── Drag/Drop state
    // Set when a drag starts in the Arsenal. A drag from the Visual canvas palette
    // starts outside this component, so the preview pane also arms the overlay
    // from the drag's MIME types on drag-enter — without that the slot overlay
    // never mounted, the drag passed over the preview iframe, and the drop was
    // silently swallowed.
    const [isDraggingComponent, setIsDraggingComponent] = useState<string | null>(null);
    const [hoveredSlot, setHoveredSlot] = useState<DropSlot>(null);
    /** Placement held across a detour through the configurator for required props. */
    const [pendingDropSlot, setPendingDropSlot] = useState<DropSlot>(null);

    // A drag that started outside this component (the Visual canvas palette) fires
    // its dragend on that element, so the pane never hears it. Without this the
    // slot overlay stayed up over the preview after an abandoned drag.
    useEffect(() => {
        const clear = () => { setIsDraggingComponent(null); setHoveredSlot(null); };
        window.addEventListener('dragend', clear);
        window.addEventListener('drop', clear);
        return () => {
            window.removeEventListener('dragend', clear);
            window.removeEventListener('drop', clear);
        };
    }, []);

    // ── Soul / OCEAN personality state
    const [soulArchetype, setSoulArchetype] = useState<string>("Custom");
    const [oceanTraits, setOceanTraits] = useState({ o: 0.6, c: 0.7, e: 0.5, a: 0.6, n: 0.3 });

    // ── Component configurator state
    const [activeComponentConfig, setActiveComponentConfig] = useState<string | null>(null);
    const [componentConfigValues, setComponentConfigValues] = useState<Record<string, any>>({});

    // ── Tool composer state
    const [activeToolComposer, setActiveToolComposer] = useState<string | null>(null);
    const [toolComposerValues, setToolComposerValues] = useState<Record<string, any>>({
        sectionTitle: '',
        displayAs: 'Table',
        trigger: 'On page load',
        showLoading: true,
        onError: 'Show an error alert',
    });

    // ── Iframe / restart state
    const [iframeKey, setIframeKey] = useState(0);
    const [isAwaitingRestart, setIsAwaitingRestart] = useState(false);
    const [canUndo, setCanUndo] = useState(false);
    const [isCodeChange, setIsCodeChange] = useState(false);

    // ── Publishing state
    const [isPublishModalOpen, setIsPublishModalOpen] = useState(initialView === 'publish');
    const { data: deploymentData, refetch: refetchDeployment } = useQuery({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null;
            if (!res.ok) return null;
            return res.json();
        }
    });
    const isPublished = Boolean(deploymentData?.isPublished);

    // ── Throttled Logs state (Buffers updates to prevent UI jank)
    const [logLines, appendLog, clearLogs] = useThrottledArrayState<string>([], 100, 500);
    const logRef = useRef<HTMLPreElement>(null);

    interface PlumbingItem {
        label: string;
        icon: any;
        value: string;
        linked: boolean;
    }

    // Every row is read from something. These were the constants 'STABLE', 'IDLE'
    // and 'READY' with fixed linked flags, rendered as green/muted status badges —
    // indistinguishable from live subsystem health, and measuring nothing. Where a
    // signal genuinely is not available, the row says so rather than inventing a
    // reassuring one.

    // ── Runtime
    const runtimeMetadata = app.runtimeMetadata as any;
    const assignedPort = runtimeMetadata?.assignedPort;
    const isRunning = runtimeMetadata?.status === 'running';

    // ── Queries
    const { data: deployment, isError: isDeploymentError } = useQuery<AppDeployment | null>({
        queryKey: [`/api/apps/${appId}/deploy`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/deploy`);
            if (res.status === 404) return null; // No deployment record yet
            if (!res.ok) throw new Error(`Failed to load deployment (${res.status})`);
            return res.json();
        },
    });

    const { data: fileData, isLoading: isLoadingFiles, refetch: refetchFiles } = useQuery<{ tree: FileNode[] | null; slug: string }>({
        queryKey: [`/api/apps/${appId}/files`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/files`);
            if (!res.ok) return { tree: null, slug: '' };
            return res.json();
        },
    });

    // ── Mutations
    const enhanceMutation = useMutation({
        mutationFn: async (userPrompt: string) => {
            const res = await apiRequest('POST', `/api/apps/${appId}/enhance`, { 
                prompt: userPrompt,
                chatHistory 
            }, 180000);
            return res.json();
        },
        onMutate: (userPrompt) => {
            setChatHistory(prev => [...prev, { role: 'user', content: userPrompt }]);
            setCanUndo(false);
        },
        onSuccess: (data) => {
            if (data?.conversational) {
                setChatHistory(prev => [...prev, { role: 'system', content: data.message || 'Here are your options.' }]);
                return;
            }
            if (data?.success === false && data?.buildFailed) {
                const detail = data.error || 'Rebuild failed after applying code changes.';
                setCanUndo(Boolean(data.backupAvailable));
                setIsAwaitingRestart(false);
                setChatHistory(prev => [
                    ...prev,
                    {
                        role: 'system',
                        content: data.backupAvailable
                            ? `Changes were written, but the rebuild failed: ${detail}\n\nYou can revert the last change from this chat.`
                            : `Changes were written, but the rebuild failed: ${detail}\n\nNo rollback backup was created.`,
                    },
                ]);
                toast({
                    title: 'Rebuild Failed',
                    description: data.backupAvailable ? 'Changes are recoverable with Revert.' : detail,
                    variant: 'destructive',
                });
                refetchFiles();
                onAppUpdated();
                return;
            }
            const fileCount = data?.filesWritten ?? null;
            const msg = fileCount != null && fileCount > 0
                ? `Applied (${fileCount} file${fileCount !== 1 ? 's' : ''} updated). Dev server restarting…`
                : fileCount === 0
                ? 'No files changed — the AI found nothing to update for that request.'
                : 'Changes applied. Dev server restarting…';
            setChatHistory(prev => [...prev, { role: 'system', content: msg }]);
            if (fileCount && fileCount > 0) {
                setCanUndo(true);
                toast({ title: 'App Updated', description: 'Rebuilding container with your changes.' });
                setIsAwaitingRestart(true);
                refetchFiles();
                onAppUpdated();
            }
        },
        onError: (err: any) => {
            const detail = err?.response?.error || err.message;
            setChatHistory(prev => [...prev, { role: 'system', content: `Enhancement failed: ${detail}` }]);
            toast({ title: 'Enhancement Failed', description: detail, variant: 'destructive' });
        },
    });

    const startMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/start`, {});
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Starting', description: 'Dev server starting…' });
            setIsAwaitingRestart(true);
            onAppUpdated();
        },
        onError: (err: any) => {
            toast({ title: 'Start Failed', description: err.message, variant: 'destructive' });
        },
    });

    const rebuildMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/rebuild`, {}, 180000);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Rebuilding', description: 'Building fresh image from workspace files.' });
            setIsAwaitingRestart(true);
            onAppUpdated();
        },
        onError: (err: any) => {
            toast({ title: 'Rebuild Failed', description: err.message, variant: 'destructive' });
        },
    });

    const revertMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/revert-last`, {}, 60000);
            return res.json();
        },
        onSuccess: (data) => {
            setCanUndo(false);
            setChatHistory(prev => [...prev, { role: 'system', content: `Reverted — ${data.filesRestored} file(s) restored. Dev server restarting…` }]);
            toast({ title: 'Reverted', description: 'Last change has been undone.' });
            setIsAwaitingRestart(true);
            refetchFiles();
            onAppUpdated();
        },
        onError: (err: any) => {
            toast({ title: 'Revert Failed', description: err.message, variant: 'destructive' });
        },
    });

    const personalityMutation = useMutation({
        mutationFn: async (payload: { archetype: string; o: number; c: number; e: number; a: number; n: number }) => {
            const res = await apiRequest('PATCH', `/api/apps/${appId}/personality`, {
                archetype: payload.archetype,
                openness: payload.o,
                conscientiousness: payload.c,
                extraversion: payload.e,
                agreeableness: payload.a,
                neuroticism: payload.n,
                oceanTraits: { o: payload.o, c: payload.c, e: payload.e, a: payload.a, n: payload.n }
            });
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Soul Updated', description: 'Personality traits saved. Takes effect on next agent call.' });
            onAppUpdated();
        },
        onError: (err: any) => {
            toast({ title: 'Save Failed', description: err.message, variant: 'destructive' });
        },
    });

    const approvePlanMutation = useMutation({
        mutationFn: async () => {
            const res = await apiRequest('POST', `/api/apps/${appId}/approve-plan`, {});
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Plan Approved', description: 'Development sequence initiated.' });
            onAppUpdated();
        },
        onError: (err: any) => {
            toast({ title: 'Approval Failed', description: err.message, variant: 'destructive' });
        }
    });

    // Use event stream for real-time telemetry updates instead of polling
    const { events: telemetryEvents, isConnected: telemetryConnected } = useEventStream({
        type: [`app.${appId}.telemetry`, "app.telemetry"],
        autoConnect: true,
    });

    // Transform events to telemetry lines
    const telemetryLines: any[] = telemetryEvents
        .filter(e => e.eventType === `app.${appId}.telemetry` || e.payload?.appId === appId)
        .map(e => ({
            id: e.eventId,
            createdAt: e.timestamp,
            event: e.payload?.event || e.payload?.metric || e.payload?.type || 'telemetry',
            level: e.payload?.level || 'info',
            metadata: e.payload || {},
        }))
        .slice(-50); // Keep last 50 entries

    const plumbingItems: PlumbingItem[] = [
        {
            label: 'RUNTIME',
            icon: Shield,
            value: isRunning ? (assignedPort ? `RUNNING :${assignedPort}` : 'RUNNING') : 'STOPPED',
            linked: Boolean(isRunning),
        },
        {
            label: 'MISSION LINK',
            icon: Target,
            value: app.oddjobMissionId ? `MISSION #${app.oddjobMissionId}` : 'UNLINKED',
            linked: Boolean(app.oddjobMissionId),
        },
        {
            label: 'REALTIME PULSE',
            icon: Activity,
            value: telemetryConnected ? 'LIVE' : 'OFFLINE',
            linked: telemetryConnected,
        },
    ];

    const { data: auditFindings } = useQuery<AppAuditLog[]>({
        queryKey: [`/api/apps/${appId}/audit-logs`],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/audit-logs`);
            return res.json();
        },
    });


    // ── Effects

    // Persist chat history to sessionStorage
    useEffect(() => {
        try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory)); } catch {}
    }, [CHAT_KEY, chatHistory]);

    // Container logs SSE
    useEffect(() => {
        if (previewMode !== 'logs') return;
        clearLogs();
        const es = new EventSource(`/api/apps/${appId}/logs`);
        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.line) appendLog(data.line);
            } catch {}
        };
        es.onerror = () => es.close();
        return () => es.close();
    }, [appId, previewMode]);

    // Reload iframe after dev server ready
    useEffect(() => {
        if (!isAwaitingRestart) return;
        let cancelled = false;
        const slug = app.slug;
        const poll = async () => {
            // Give it 60 seconds total (30 * 2s)
            for (let i = 0; i < 30; i++) {
                if (cancelled) return;
                try {
                    const r = await apiRequest('GET', `/forged/${slug}`);
                    // If we get a success OR a redirect (304), the server is at least responding
                    if (r.ok || r.status === 200 || r.status === 304) {
                        if (!cancelled) {
                            setIsAwaitingRestart(false);
                            setIframeKey(k => k + 1);
                        }
                        return;
                    }
                } catch { /* not ready yet / proxy error */ }
                await new Promise(res => setTimeout(res, 2000));
            }
            if (!cancelled) { 
                setIsAwaitingRestart(false); 
                setIframeKey(k => k + 1); 
            }
        };
        poll();
        return () => { cancelled = true; };
    }, [isAwaitingRestart, app.slug]);

    // ── Handlers

    const toggleDir = useCallback((p: string) => {
        setExpandedDirs(prev => {
            const next = new Set(prev);
            next.has(p) ? next.delete(p) : next.add(p);
            return next;
        });
    }, []);

    const handleFileSelect = useCallback((node: FileNode) => {
        setViewingFile(node.path);
        setPreviewMode('preview');
    }, []);

    const handleChatEnhance = useCallback((text: string) => {
        const fullPrompt = viewingFile ? `[Editing ${viewingFile}]\n\n${text}` : text;
        enhanceMutation.mutate(fullPrompt);
    }, [enhanceMutation, viewingFile]);

    const handleQuickAction = useCallback((action: string) => {
        enhanceMutation.mutate(action);
    }, [enhanceMutation]);

    const handleRevert = useCallback(() => {
        revertMutation.mutate();
    }, [revertMutation]);

    const openComponentConfig = useCallback((componentName: string) => {
        const meta = COMPONENT_CONFIGS[componentName];
        if (!meta) { 
            handleChatEnhance(`Add a component that uses ${componentName} and displays the results.`);
            return; 
        }
        const defaults: Record<string, any> = {};
        meta.fields.forEach(f => {
            defaults[f.key] = f.default !== undefined ? f.default : (f.type === 'toggle' ? false : '');
        });
        setComponentConfigValues(defaults);
        setActiveComponentConfig(componentName);
    }, [handleChatEnhance]);

    const handleInsertComponent = useCallback(() => {
        if (!activeComponentConfig) return;
        const meta = COMPONENT_CONFIGS[activeComponentConfig];
        const builtPrompt = meta.buildPrompt(componentConfigValues, viewingFile);
        setIsCodeChange(true);
        // A drop that had to stop for required props still remembers where it landed.
        enhanceMutation.mutate(`${builtPrompt}${slotInstructionFor(pendingDropSlot)}`);
        setPendingDropSlot(null);
        setActiveComponentConfig(null);
    }, [activeComponentConfig, componentConfigValues, viewingFile, enhanceMutation, pendingDropSlot]);

    /** The component a drop is carrying, ignoring the external-drag placeholder. */
    const resolveDroppedComponent = useCallback(
        (e: React.DragEvent) => resolveDropped(e.dataTransfer.getData(PRIMITIVE_MIME), isDraggingComponent),
        [isDraggingComponent],
    );

    const handleDirectDropComponent = useCallback((componentName: string, slot?: DropSlot) => {
        const meta = COMPONENT_CONFIGS[componentName];

        // A drop cannot fill in a required prop, and buildPrompt would emit
        // `collection=""` for it. Open the configurator instead, holding the slot
        // so the placement survives the detour.
        const missingRequired = needsConfiguration(meta?.fields);
        if (meta && missingRequired) {
            setPendingDropSlot(slot ?? null);
            openComponentConfig(componentName);
            toast({
                title: `${componentName} needs configuration`,
                description: `Fill in the required fields — the ${slot ?? 'chosen'} placement is remembered.`,
            });
            return;
        }

        let basePrompt: string;
        if (meta) {
            const defaults: Record<string, any> = {};
            meta.fields.forEach(f => {
                defaults[f.key] = f.default !== undefined ? f.default : (f.type === 'toggle' ? false : '');
            });
            basePrompt = meta.buildPrompt(defaults, viewingFile);
        } else {
            basePrompt = viewingFile
                ? `[Editing ${viewingFile}]\n\nAdd the ${componentName} component to this page. Lay it out cleanly with responsive CSS, wire its sample props or platform dataset, and match the app's existing theme.`
                : `Add the ${componentName} component to the main page layout. Lay it out cleanly with responsive CSS, wire its sample props or platform dataset, and match the app's existing theme.`;
        }

        const fullPrompt = `${basePrompt}${slotInstructionFor(slot)}\n\nIMPORTANT: Keep the page's existing components and styling, and return valid JSON with the updated file contents.`;

        setIsCodeChange(true);
        const slotLabel = slot ? ` (${slot.toUpperCase()} Slot)` : '';
        toast({
            title: `Materializing ${componentName}${slotLabel}`,
            description: `Synthesizing ${componentName} into the page layout and hot-reloading the active runtime...`,
        });
        enhanceMutation.mutate(fullPrompt);
    }, [viewingFile, enhanceMutation, toast, openComponentConfig]);

    const openToolComposer = useCallback((toolName: string) => {
        setToolComposerValues(prev => ({ ...prev, sectionTitle: toolName }));
        setActiveToolComposer(toolName);
        setActiveStudioTab('wiring');
    }, []);

    const handleComposeIntegration = useCallback(() => {
        if (!activeToolComposer) return;
        const builtPrompt = buildToolComposerPrompt(activeToolComposer, toolComposerValues as any, viewingFile);
        setIsCodeChange(true);
        enhanceMutation.mutate(builtPrompt);
        setActiveToolComposer(null);
    }, [activeToolComposer, toolComposerValues, viewingFile, enhanceMutation]);


    useEffect(() => {
        if (!deployment) return;
        const dep = deployment as any;
        if (dep.oceanTraits) setOceanTraits(dep.oceanTraits);
        if (dep.soulArchetype) setSoulArchetype(dep.soulArchetype);
    }, [deployment]);

    // Redundant chat bubble and submit handlers removed in favor of BuilderChat

    const renderSoulRadar = (psy: any) => {
        const data = OCEAN_LABELS.map(l => ({
            label: l.label,
            value: (psy[l.key] || 0.5) * 100,
            fullMark: 100,
        }));
        return (
            <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                        <PolarGrid stroke="rgba(139,92,246,0.15)" strokeWidth={1} />
                        <PolarAngleAxis dataKey="label" tick={{ fill: 'rgba(167,139,250,0.6)', fontSize: 9, fontWeight: 900, fontFamily: 'var(--font-mono)' }} />
                        <Radar 
                            name="Soul" 
                            dataKey="value" 
                            stroke="rgba(139,92,246,1)" 
                            fill="url(#radarGradient)" 
                            fillOpacity={0.4} 
                            isAnimationActive={true}
                        />
                        <defs>
                            <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(139,92,246,0.1)" />
                                <stop offset="100%" stopColor="rgba(139,92,246,0.6)" />
                            </radialGradient>
                        </defs>
                    </RadarChart>
                </ResponsiveContainer>
            </div>
        );
    };

    return (
        <>
            <div className="flex h-full bg-background overflow-hidden animate-in fade-in duration-500">

            {/* ═══ LEFT: CHAT RAIL ══════════════════════════════════════════ */}
            {/* Chat is no longer one tab among eight. It is the surface you type
                into while reading everything else, so it keeps its own column and
                is never swapped away by opening Visual or the file tree. */}
            <div className="order-first w-[380px] flex-shrink-0 border-r border-foreground/10 flex flex-col min-h-0 bg-foreground/5 backdrop-blur-xl">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-foreground/10 bg-foreground/5 flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-primary" />
                    <span className="text-xs font-black uppercase tracking-widest">Chat</span>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                    <BuilderChat
                        chatHistory={chatHistory as any}
                        onEnhance={handleChatEnhance}
                        isEnhancing={enhanceMutation.isPending}
                        viewingFile={viewingFile}
                        canUndo={canUndo}
                        onRevert={handleRevert}
                        onQuickAction={handleQuickAction}
                        draftPrompt={chatDraft}
                    />
                </div>
            </div>

            {/* ═══ MIDDLE: PREVIEW / LOGS / SOURCE ═══════════════════════════ */}
            <div className="flex-1 flex flex-col min-w-0 bg-card/10">
                {viewingFile ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {onFocusInChat && <Button type="button" variant="outline" size="sm" className="m-2 self-start" onClick={() => onFocusInChat({ appId, kind: 'file', label: viewingFile, filePath: viewingFile })}>Discuss this file in CREW</Button>}
                        <FileContentViewer appId={appId} filePath={viewingFile} onClose={() => setViewingFile(null)} />
                    </div>
                ) : (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-y-2 px-6 py-3 border-b border-foreground/10 bg-background/40 backdrop-blur-md flex-shrink-0 min-w-0">
                            <div className="flex items-center gap-6">
                                <button 
                                    onClick={() => setPreviewMode('preview')} 
                                    className={cn(
                                        "text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2.5 transition-all duration-300", 
                                        previewMode === 'preview' ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <div className={cn("p-1.5 rounded-lg transition-all", previewMode === 'preview' ? "bg-primary/20 shadow-[0_0_15px_hsl(var(--primary)/0.3)]" : "bg-foreground/5")}>
                                        <Monitor className="w-3.5 h-3.5" />
                                    </div>
                                    <span>Preview</span>
                                </button>
                                <button 
                                    onClick={() => setPreviewMode('logs')} 
                                    className={cn(
                                        "text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2.5 transition-all duration-300", 
                                        previewMode === 'logs' ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <div className={cn("p-1.5 rounded-lg transition-all", previewMode === 'logs' ? "bg-primary/20 shadow-[0_0_15px_hsl(var(--primary)/0.3)]" : "bg-foreground/5")}>
                                        <Terminal className="w-3.5 h-3.5" />
                                    </div>
                                    <span>Telemetry</span>
                                </button>
                                <button 
                                    onClick={() => setPreviewMode('api')} 
                                    className={cn(
                                        "text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2.5 transition-all duration-300", 
                                        previewMode === 'api' ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <div className={cn("p-1.5 rounded-lg transition-all", previewMode === 'api' ? "bg-primary/20 shadow-[0_0_15px_hsl(var(--primary)/0.3)]" : "bg-foreground/5")}>
                                        <Code2 className="w-3.5 h-3.5" />
                                    </div>
                                    <span>API Contract</span>
                                </button>
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <Badge variant={isRunning ? "default" : "secondary"} className={cn("font-mono text-[9px] px-3 py-1 uppercase tracking-widest border-foreground/10", isRunning ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]" : "bg-red-500/20 text-red-500")}>
                                    {isRunning ? `LIVE // PORT ${assignedPort}` : "SYSTEM OFFLINE"}
                                </Badge>
                                <Badge 
                                    variant="outline" 
                                    className={cn(
                                        "font-mono text-[9px] px-2.5 py-1 uppercase tracking-wider", 
                                        isPublished ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.2)]" : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                                    )}
                                >
                                    {isPublished ? "● PUBLISHED" : "○ DRAFT"}
                                </Badge>
                                <Button
                                    size="sm"
                                    onClick={() => setIsPublishModalOpen(true)}
                                    className="h-8 gap-1.5 rounded-xl px-3 text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-foreground shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                                >
                                    <Rocket className="w-3.5 h-3.5" />
                                    <span>Publish App</span>
                                </Button>
                                <div className="w-[1px] h-6 bg-foreground/10 mx-1" />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    title={isRunning ? 'Select elements in the preview to scope a change request' : 'Start the app to select elements'}
                                    disabled={!isRunning}
                                    onClick={() => preview.setSelectMode(!preview.selectMode)}
                                    data-testid="preview-select-toggle"
                                    className={cn(
                                        "h-8 gap-1.5 rounded-xl px-2.5 text-[10px] font-black uppercase tracking-widest transition-all",
                                        preview.selectMode
                                            ? "bg-primary/20 text-primary border border-primary/30"
                                            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                                    )}
                                >
                                    <MousePointerSquareDashed className="w-3.5 h-3.5" />
                                    {preview.selectMode ? 'Selecting' : 'Select'}
                                    {preview.selections.length > 0 && (
                                        <span className="ml-1 rounded-full bg-primary/30 px-1.5 text-[9px]">{preview.selections.length}</span>
                                    )}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all" title="Force Rebuild Neural Image" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending}>
                                    <RefreshCw className={cn("w-4 h-4", rebuildMutation.isPending && "animate-spin")} />
                                </Button>
                            </div>
                        </div>

                        <div
                            ref={previewPaneRef}
                            onDragEnter={(e) => {
                                // Arms the overlay for a drag that started elsewhere (the
                                // Visual canvas palette). getData is unreadable until drop,
                                // so hold a sentinel and resolve the real name there.
                                if (!isDraggingComponent && e.dataTransfer.types.includes(PRIMITIVE_MIME)) {
                                    setIsDraggingComponent(EXTERNAL_DRAG);
                                }
                            }}
                            onDragOver={(e) => {
                                if (e.dataTransfer.types.includes(PRIMITIVE_MIME) || isDraggingComponent) {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                }
                            }}
                            onDrop={(e) => {
                                // Fallback for a drop that reaches the pane rather than a
                                // slot: place at the bottom rather than swallowing it.
                                e.preventDefault();
                                const comp = resolveDroppedComponent(e);
                                setIsDraggingComponent(null);
                                setHoveredSlot(null);
                                if (comp) handleDirectDropComponent(comp, 'bottom');
                            }}
                            className="flex-1 relative bg-background/40 overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.08)_0%,transparent_50%)]" />
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(239,68,68,0.05)_0%,transparent_50%)]" />

                            {/* ── DRAG & DROP MULTI-SLOT GRID PLACEMENT OVERLAY ── */}
                            {isDraggingComponent && (
                                <div
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'copy';
                                    }}
                                    onDrop={(e) => {
                                        // Between the slots. Cancel rather than guess — the
                                        // drop triggers a rewrite of the page.
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const comp = resolveDroppedComponent(e);
                                        const slot = hoveredSlot;
                                        setIsDraggingComponent(null);
                                        setHoveredSlot(null);
                                        if (comp && slot) {
                                            handleDirectDropComponent(comp, slot);
                                        }
                                    }}
                                    className="absolute inset-0 z-50 bg-background/85 backdrop-blur-md p-6 flex flex-col justify-between animate-in fade-in duration-200 cursor-copy select-none"
                                >
                                    {/* Eulerian Snap Grid Background */}
                                    <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.6)_1.5px,transparent_1.5px)] bg-[size:24px_24px]" />

                                    {/* Slot 1: TOP (Header / Full Width) */}
                                    <div
                                        onDragEnter={() => setHoveredSlot('top')}
                                        onDragOver={(e) => { e.preventDefault(); setHoveredSlot('top'); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const comp = resolveDroppedComponent(e);
                                            setIsDraggingComponent(null);
                                            setHoveredSlot(null);
                                            if (comp) handleDirectDropComponent(comp, 'top');
                                        }}
                                        className={cn(
                                            "w-full h-24 rounded-2xl border-2 border-dashed transition-all duration-200 flex items-center justify-center p-4 relative z-10",
                                            hoveredSlot === 'top' 
                                                ? "border-primary bg-primary/20 shadow-[0_0_30px_hsl(var(--primary)/0.3)] scale-[1.01]"
                                                : "border-border/60 bg-card/40 hover:border-primary/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Plus className={cn("w-5 h-5 transition-transform", hoveredSlot === 'top' ? "scale-125 text-primary" : "text-muted-foreground")} />
                                            <div>
                                                <span className="text-xs font-black uppercase tracking-wider text-foreground">Top Hero / Banner Position</span>
                                                <p className="text-[10px] text-muted-foreground">Drop here to place above existing card grid</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle Row: LEFT & RIGHT COLUMNS */}
                                    <div className="flex-1 my-4 grid grid-cols-2 gap-4 relative z-10">
                                        {/* Slot 2: LEFT COLUMN */}
                                        <div
                                            onDragEnter={() => setHoveredSlot('left')}
                                            onDragOver={(e) => { e.preventDefault(); setHoveredSlot('left'); }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const comp = resolveDroppedComponent(e);
                                                setIsDraggingComponent(null);
                                                setHoveredSlot(null);
                                                if (comp) handleDirectDropComponent(comp, 'left');
                                            }}
                                            className={cn(
                                                "h-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center p-6 text-center",
                                                hoveredSlot === 'left' 
                                                    ? "border-primary bg-primary/20 shadow-[0_0_30px_hsl(var(--primary)/0.3)] scale-[1.01]"
                                                    : "border-border/60 bg-card/40 hover:border-primary/50"
                                            )}
                                        >
                                            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                                                <Plus className={cn("w-6 h-6 transition-transform", hoveredSlot === 'left' ? "scale-125 text-primary" : "text-muted-foreground")} />
                                            </div>
                                            <h5 className="text-xs font-black uppercase tracking-wider text-foreground">Left Column Grid Slot</h5>
                                            <p className="text-[10px] text-muted-foreground mt-1 max-w-[180px]">Drop to insert into the left column of the page grid</p>
                                            {hoveredSlot === 'left' && (
                                                <Badge variant="outline" className="mt-3 text-[9px] font-mono border-primary/40 text-primary animate-pulse">
                                                    Targeting Column 1
                                                </Badge>
                                            )}
                                        </div>

                                        {/* Slot 3: RIGHT COLUMN */}
                                        <div
                                            onDragEnter={() => setHoveredSlot('right')}
                                            onDragOver={(e) => { e.preventDefault(); setHoveredSlot('right'); }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const comp = resolveDroppedComponent(e);
                                                setIsDraggingComponent(null);
                                                setHoveredSlot(null);
                                                if (comp) handleDirectDropComponent(comp, 'right');
                                            }}
                                            className={cn(
                                                "h-full rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center p-6 text-center",
                                                hoveredSlot === 'right' 
                                                    ? "border-primary bg-primary/20 shadow-[0_0_30px_hsl(var(--primary)/0.3)] scale-[1.01]"
                                                    : "border-border/60 bg-card/40 hover:border-primary/50"
                                            )}
                                        >
                                            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                                                <Plus className={cn("w-6 h-6 transition-transform", hoveredSlot === 'right' ? "scale-125 text-primary" : "text-muted-foreground")} />
                                            </div>
                                            <h5 className="text-xs font-black uppercase tracking-wider text-foreground">Right Column Grid Slot</h5>
                                            <p className="text-[10px] text-muted-foreground mt-1 max-w-[180px]">Drop to insert into the right column of the page grid</p>
                                            {hoveredSlot === 'right' && (
                                                <Badge variant="outline" className="mt-3 text-[9px] font-mono border-primary/40 text-primary animate-pulse">
                                                    Targeting Column 2
                                                </Badge>
                                            )}
                                        </div>
                                    </div>

                                    {/* Slot 4: BOTTOM (Footer / Full Width) */}
                                    <div
                                        onDragEnter={() => setHoveredSlot('bottom')}
                                        onDragOver={(e) => { e.preventDefault(); setHoveredSlot('bottom'); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const comp = resolveDroppedComponent(e);
                                            setIsDraggingComponent(null);
                                            setHoveredSlot(null);
                                            if (comp) handleDirectDropComponent(comp, 'bottom');
                                        }}
                                        className={cn(
                                            "w-full h-24 rounded-2xl border-2 border-dashed transition-all duration-200 flex items-center justify-center p-4 relative z-10",
                                            hoveredSlot === 'bottom' 
                                                ? "border-primary bg-primary/20 shadow-[0_0_30px_hsl(var(--primary)/0.3)] scale-[1.01]"
                                                : "border-border/60 bg-card/40 hover:border-primary/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Plus className={cn("w-5 h-5 transition-transform", hoveredSlot === 'bottom' ? "scale-125 text-primary" : "text-muted-foreground")} />
                                            <div>
                                                <span className="text-xs font-black uppercase tracking-wider text-foreground">Bottom Full Width Position</span>
                                                <p className="text-[10px] text-muted-foreground">Drop here to append beneath the 2-column grid</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Selection overlay. Fixed-positioned because the rects are
                                captured inside the iframe and translated to viewport
                                coordinates; pointer-events stay off so the click still
                                reaches the element being picked. */}
                            {preview.selectMode && preview.hoverRect && (
                                <div
                                    className="pointer-events-none absolute z-50 rounded border-2 border-primary bg-primary/10"
                                    style={{
                                        top: preview.hoverRect.top,
                                        left: preview.hoverRect.left,
                                        width: preview.hoverRect.width,
                                        height: preview.hoverRect.height,
                                    }}
                                />
                            )}
                            {preview.selectMode && preview.selections.map(sel => (
                                <div
                                    key={sel.selector}
                                    className="pointer-events-none absolute z-40 rounded border-2 border-emerald-400 bg-emerald-400/10"
                                    style={{ top: sel.rect.top, left: sel.rect.left, width: sel.rect.width, height: sel.rect.height }}
                                />
                            ))}

                            {/* Selection bar: what is currently scoped, and the way to act
                                on it. Seeding the composer rather than sending keeps the
                                user in control of the wording — the selection is context,
                                not an instruction on its own. */}
                            {preview.selectMode && (
                                <div className="absolute bottom-0 left-0 right-0 z-30 border-t border-primary/20 bg-background/95 backdrop-blur-xl p-3" data-testid="preview-selection-bar">
                                    {preview.unavailable ? (
                                        <p className="text-[10px] text-amber-400 font-medium px-1">{preview.unavailable}</p>
                                    ) : preview.selections.length === 0 ? (
                                        <p className="text-[10px] text-muted-foreground font-medium px-1">
                                            Click any element in the preview to scope your next change request. Click it again to deselect.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {preview.selections.map(sel => (
                                                    <button
                                                        key={sel.selector}
                                                        onClick={() => preview.remove(sel.selector)}
                                                        title={`${sel.selector} — click to remove`}
                                                        className="group flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                                                    >
                                                        <span className="font-mono opacity-60">&lt;{sel.tag}&gt;</span>
                                                        <span className="max-w-[180px] truncate">{sel.label}</span>
                                                        <X className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    className="h-8 rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                    data-testid="scope-change-request"
                                                    onClick={() => {
                                                        setChatDraft(preview.buildScopedPrompt(''));
                                                        preview.setSelectMode(false);
                                                    }}
                                                >
                                                    Scope change request
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 rounded-xl text-[10px] font-black uppercase tracking-widest text-muted-foreground"
                                                    onClick={preview.clear}
                                                >
                                                    Clear
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {previewMode === 'api' ? (
                                <ApiContractExplorer
                                    appId={appId}
                                    appSlug={app.slug}
                                    assignedPort={assignedPort}
                                />
                            ) : previewMode === 'preview' ? (
                                (isRunning || isAwaitingRestart) ? (
                                     <div className="absolute inset-0 flex flex-col animate-in zoom-in-95 duration-500">
                                         {isAwaitingRestart && (
                                             <div className="absolute inset-0 z-10 bg-background/80 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center">
                                                 <div className="relative mb-6">
                                                    <Loader2 className="w-12 h-12 text-primary animate-spin opacity-20" />
                                                    <Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 text-primary animate-pulse" />
                                                 </div>
                                                 <p className="text-sm font-black uppercase tracking-[0.2em] text-primary mb-2">Re-Igniting Core</p>
                                                 <p className="text-[10px] font-medium text-muted-foreground max-w-[200px]">Hot-swapping modified modules into the active runtime…</p>
                                             </div>
                                         )}
                                         {isRunning && <iframe ref={previewIframeRef} key={iframeKey} src={`/forged/${app.slug}`} className="flex-1 w-full border-none shadow-2xl" title="Forged App Preview" sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation" />}
                                     </div>
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center animate-in fade-in zoom-in-95 duration-700">
                                        <div className="relative group mb-10">
                                            <div className="absolute -inset-8 bg-primary/10 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
                                            <div className="relative p-8 rounded-[3rem] bg-foreground/5 border border-foreground/10 shadow-2xl backdrop-blur-xl transition-all duration-700 group-hover:scale-110 group-hover:border-primary/40 group-hover:shadow-primary/20">
                                                <div className="absolute inset-0 rounded-[3rem] bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                                <Cpu className="w-20 h-20 text-muted-foreground group-hover:text-primary transition-colors duration-700 relative z-10" />
                                                <div className="absolute -bottom-4 -right-4 p-3 rounded-2xl bg-card border border-foreground/10 shadow-2xl scale-0 group-hover:scale-100 transition-transform duration-700 delay-200">
                                                    <Zap className="w-6 h-6 text-primary animate-pulse" />
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-4 max-w-[400px]">
                                            <h3 className="text-xl font-black uppercase tracking-[0.4em] text-foreground/90 italic">Forge Engine Idle</h3>
                                            <div className="flex justify-center gap-1.5">
                                                <div className="h-1 w-8 bg-primary/40 rounded-full" />
                                                <div className="h-1 w-2 bg-primary/20 rounded-full" />
                                                <div className="h-1 w-2 bg-primary/10 rounded-full" />
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed tracking-wider font-medium opacity-80 px-4">
                                                The localized development environment is currently dormant. <span className="text-primary/80 font-bold">Ignite the Forge</span> to instantiate your neural architecture and begin real-time synthesis.
                                            </p>
                                        </div>

                                        <Button 
                                            size="lg" 
                                            onClick={() => startMutation.mutate()} 
                                            disabled={startMutation.isPending} 
                                            className="mt-12 px-16 h-14 shadow-[0_0_40px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_60px_hsl(var(--primary)/0.6)] transition-all duration-700 rounded-2xl group/btn overflow-hidden relative"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_auto] animate-gradient-x opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                            <div className="relative flex items-center gap-3">
                                                {startMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />}
                                                <span className="font-black uppercase tracking-[0.2em] text-xs">Ignite Neural Forge</span>
                                            </div>
                                        </Button>
                                    </div>
                                )
                            ) : (
                                <div className="absolute inset-0 p-4 bg-background/40 flex flex-col">
                                    {onFocusInChat && <Button type="button" variant="outline" size="sm" className="mb-2 self-start" onClick={() => onFocusInChat({ appId, kind: 'diagnostic', label: 'Runtime logs' })}>Discuss diagnostics in CREW</Button>}
                                    <pre ref={logRef} className="min-h-0 flex-1 w-full overflow-y-auto text-[10px] font-mono leading-relaxed text-foreground custom-scrollbar opacity-80">
                                        {logLines.length > 0 ? logLines.map((l: string, i: number) => (
                                            <div key={i} className="py-0.5 border-l-2 border-primary/20 pl-3 hover:bg-foreground/5 transition-colors">{l}</div>
                                        )) : (
                                            <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
                                                <Activity className="w-8 h-8 mb-4 animate-pulse text-primary/40" />
                                                Waiting for system telemetry…
                                            </div>
                                        )}
                                    </pre>
                                </div>
                            )}
                        </div>

                        {/* Accessibility Deep-Dive (Compact) */}
                        <AnimatePresence>

                            {previewMode === 'preview' && runtimeMetadata?.accessibilityReport && (
                                <motion.div 
                                    initial={{ height: 0, opacity: 0 }} 
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="border-t border-foreground/10 bg-background/60 backdrop-blur-md overflow-hidden"
                                >
                                    <div className="p-3 flex items-start gap-4">
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Shield className="w-3.5 h-3.5 text-primary" />
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Titan A11Y Guard</span>
                                                </div>
                                                <span className="text-[10px] font-mono text-muted-foreground">
                                                    {runtimeMetadata.accessibilityReport.violationCount} Violations / {runtimeMetadata.accessibilityReport.passesCount} Passes
                                                </span>
                                            </div>
                                            {runtimeMetadata.accessibilityReport.topViolations?.length > 0 ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {runtimeMetadata.accessibilityReport.topViolations.slice(0, 3).map((v: any, i: number) => (
                                                        <Badge key={i} variant="outline" className="bg-foreground/5 border-foreground/10 text-[9px] text-muted-foreground flex items-center gap-1.5 py-0.5">
                                                            <div className={cn("w-1 h-1 rounded-full", v.impact === 'critical' ? 'bg-red-500' : 'bg-amber-500')} />
                                                            {v.id}
                                                        </Badge>
                                                    ))}
                                                    {runtimeMetadata.accessibilityReport.violationCount > 3 && (
                                                        <span className="text-[9px] text-muted-foreground self-center">+{runtimeMetadata.accessibilityReport.violationCount - 3} more</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <p className="text-[10px] text-emerald-500/70 font-medium">Compliance verified. No critical violations detected.</p>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </>
                )}
            </div>

            {/* ═══ RIGHT: WORKSPACE + STUDIO ════════════════════════════════ */}
            {/* The workspace tree is now the first tab of this panel, joining Visual,
                Plan, Feed, Audits, Primitives, Wiring and Soul. Chat keeps the left
                rail to itself: it is the thing you type into continuously, and it
                should not vanish because you went to look at the file tree. */}
            <div className={cn(
                "order-last flex-shrink-0 border-l border-foreground/10 flex flex-col min-h-0 bg-foreground/5 backdrop-blur-xl transition-all duration-300",
                activeStudioTab === 'visual' ? "w-[840px] max-w-[62vw]" : "w-[380px]"
            )}>

                {/* Tab bar */}
                <div className="flex border-b border-foreground/10 flex-shrink-0 bg-foreground/5 p-1.5 gap-1">
                    {([
                        { id: 'files',      icon: Folder,        label: 'Files'      },
                        { id: 'visual',     icon: LayoutGrid,    label: 'Visual'    },
                        { id: 'plan',       icon: Target,        label: 'Plan'       },
                        { id: 'telemetry',  icon: Activity,      label: 'Feed'       },
                        { id: 'audits',     icon: ScanEye,       label: 'Audits'     },
                        { id: 'primitives', icon: Blocks,        label: 'Primitives' },
                        { id: 'wiring',     icon: Plug2,         label: 'Wiring'     },
                        { id: 'soul',       icon: Dna,           label: 'Soul'       },
                    ] as { id: StudioTab; icon: React.ElementType; label: string }[]).map(({ id, icon: Icon, label }) => (
                        <button 
                            key={id} 
                            onClick={() => setActiveStudioTab(id)}
                            title={label}
                            className={cn(
                                "flex items-center justify-center gap-2 py-2 px-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300",
                                activeStudioTab === id 
                                    ? "flex-[2] bg-primary/20 text-primary shadow-[0_0_20px_hsl(var(--primary)/0.2)] border border-primary/20" 
                                    : "flex-1 text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                            )}
                        >
                            <Icon className={cn("w-4 h-4", activeStudioTab === id ? "animate-pulse" : "")} />
                            <AnimatePresence mode="wait">
                                {activeStudioTab === id && (
                                    <motion.span 
                                        initial={{ opacity: 0, width: 0 }}
                                        animate={{ opacity: 1, width: 'auto' }}
                                        exit={{ opacity: 0, width: 0 }}
                                        className="whitespace-nowrap overflow-hidden"
                                    >
                                        {label}
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </button>
                    ))}
                </div>

                <div className="flex-1 min-h-0 relative">
                    <AnimatePresence mode="wait">
                        {/* ── FILES TAB (the former standalone Workspace column) ── */}
                        {activeStudioTab === 'files' && (
                            <motion.div key="files" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col min-h-0">
                                <div className="px-3 py-2 border-b border-foreground/10 flex items-center justify-between flex-shrink-0">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Workspace</span>
                                    <Badge variant="outline" className="text-[10px] h-5">{fileData?.slug || 'Oddjob'}</Badge>
                                </div>
                                <ScrollArea className="flex-1 p-2 min-h-0">
                                    {isLoadingFiles ? (
                                        <div className="p-8 text-center space-y-3">
                                            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                                            <p className="text-[10px] text-muted-foreground uppercase font-black">Decrypting workspace…</p>
                                        </div>
                                    ) : fileData?.tree?.map(node => (
                                        <FileTreeNode key={node.path} node={node} depth={0} expanded={expandedDirs} onToggle={toggleDir} onSelect={handleFileSelect} selectedPath={viewingFile ?? undefined} />
                                    ))}
                                </ScrollArea>
                                <div className="p-3 border-t border-foreground/5 bg-foreground/5 flex-shrink-0">
                                    <Button variant="ghost" className="w-full justify-start gap-2 h-8 text-[10px] uppercase font-black tracking-widest text-muted-foreground hover:text-primary transition-all" onClick={() => (window as any).open('/api/apps/' + appId + '/files/download')}>
                                        <Cloud className="w-3.5 h-3.5" />
                                        Pull Snapshot
                                    </Button>
                                </div>
                            </motion.div>
                        )}

                        {/* ── VISUAL TAB ── */}
                        {activeStudioTab === 'visual' && (
                            <motion.div key="visual" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col min-h-0 p-3">
                                <VisualCanvasEditor
                                    appId={appId}
                                    onFocusInChat={onFocusInChat}
                                    onSave={(nodes, edges, sourceFile) => {
                                        // buildLayoutPrompt carries positions, wiring and every
                                        // configured property. The old handler sent only a list
                                        // of node labels, so the properties panel edited state
                                        // that never reached the generated code.
                                        setIsCodeChange(true);
                                        enhanceMutation.mutate(buildLayoutPrompt(nodes, edges, sourceFile));
                                    }}
                                />
                            </motion.div>
                        )}

                        {/* ── PRIMITIVES TAB ── */}
                        {activeStudioTab === 'primitives' && (
                            <motion.div key="primitives" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                {activeComponentConfig ? (
                                    <div className="flex flex-col h-full bg-card/10">
                                        <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/10 bg-foreground/5 flex-shrink-0">
                                            <button 
                                                onClick={() => setActiveComponentConfig(null)} 
                                                className="p-1 hover:bg-foreground/5 rounded text-muted-foreground hover:text-foreground transition-all"
                                                title="Back to arsenal"
                                            >
                                                <ChevronLeft className="w-4 h-4" />
                                            </button>
                                            <span className="text-xs font-black uppercase tracking-widest flex-1">{activeComponentConfig}</span>
                                        </div>
                                        <ScrollArea className="flex-1">
                                            <div className="p-4 space-y-4">
                                                {COMPONENT_CONFIGS[activeComponentConfig].fields.map(f => (
                                                    <div key={f.key} className="space-y-1.5">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                                            {f.label}
                                                            {f.required && <span className="text-rose-400 ml-1">*</span>}
                                                        </label>
                                                        {f.helpText && <p className="text-[9px] text-foreground/40 leading-tight">{f.helpText}</p>}
                                                        {f.type === 'text' && <Input value={componentConfigValues[f.key] || ''} onChange={e => setComponentConfigValues(prev => ({...prev, [f.key]: e.target.value}))} placeholder={f.placeholder} className="h-8 text-xs bg-background/20 border-foreground/5" />}
                                                        {f.type === 'textarea' && <textarea value={componentConfigValues[f.key] || ''} onChange={e => setComponentConfigValues(prev => ({...prev, [f.key]: e.target.value}))} placeholder={f.placeholder} rows={f.rows || 3} className="w-full text-xs bg-background/20 border border-foreground/5 rounded-md px-3 py-2 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50" />}
                                                        {f.type === 'select' && (
                                                            <div className="flex flex-wrap gap-1">
                                                                {f.options?.map(o => (
                                                                    <button key={o} onClick={() => setComponentConfigValues(prev => ({...prev, [f.key]: o}))} className={cn("px-2 py-1 rounded text-[10px] border transition-all", componentConfigValues[f.key] === o ? "border-primary bg-primary/10 text-primary" : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20")}>
                                                                        {o}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {f.type === 'toggle' && (
                                                            <button
                                                                onClick={() => setComponentConfigValues(prev => ({...prev, [f.key]: !prev[f.key]}))}
                                                                className={cn("flex items-center gap-2 px-3 py-1.5 rounded text-[10px] border transition-all", componentConfigValues[f.key] ? "border-primary bg-primary/10 text-primary" : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20")}
                                                            >
                                                                <div className={cn("w-3 h-3 rounded-sm border transition-all", componentConfigValues[f.key] ? "bg-primary border-primary" : "border-foreground/30")}>
                                                                    {componentConfigValues[f.key] && <svg className="w-3 h-3 text-background" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none"/></svg>}
                                                                </div>
                                                                {componentConfigValues[f.key] ? 'Enabled' : 'Disabled'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <div className="p-3 rounded-xl bg-foreground/5 border border-foreground/5 space-y-2">
                                                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Prompt DNA</p>
                                                    <p className="text-[10px] text-primary/70 font-mono leading-relaxed line-clamp-3">
                                                        {COMPONENT_CONFIGS[activeComponentConfig].buildPrompt(componentConfigValues, viewingFile)}
                                                    </p>
                                                </div>
                                            </div>
                                        </ScrollArea>
                                        <div className="p-4 border-t border-foreground/10">
                                            <Button onClick={handleInsertComponent} disabled={enhanceMutation.isPending} className="w-full gap-2 shadow-lg shadow-primary/20">
                                                {enhanceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                                Materialize Component
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <ScrollArea className="flex-1">
                                        <div className="p-4 space-y-8">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-primary/10 rounded-lg shadow-[0_0_15px_hsl(var(--primary)/0.3)]">
                                                    <Blocks className="w-5 h-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-black uppercase tracking-tight">Arsenal</h4>
                                                    <p className="text-[10px] text-muted-foreground italic font-medium">Click to configure or drag onto canvas to insert.</p>
                                                </div>
                                            </div>
                                            <div className="space-y-6">
                                                {UI_COMPONENT_GROUPS.map(group => (
                                                    <div key={group.label} className="p-5 rounded-3xl glass-panel border-foreground/5 hover:border-primary/20 transition-all group/card relative overflow-hidden">
                                                        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none group-hover/card:opacity-20 transition-opacity">
                                                            <Blocks className="w-12 h-12" />
                                                        </div>
                                                        <div className="flex items-center justify-between mb-5 relative z-10">
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/70">{group.label}</span>
                                                                <div className="h-0.5 w-8 bg-primary/30 mt-1 rounded-full group-hover/card:w-16 transition-all duration-500" />
                                                            </div>
                                                            <div className="flex gap-1.5">
                                                                {group.components.slice(0,3).map(c => <div key={c} className="w-1.5 h-1.5 rounded-full bg-foreground/5 border border-foreground/10 group-hover/card:bg-primary/20 group-hover/card:border-primary/40 transition-all" />)}
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 relative z-10">
                                                            {group.components.map(c => (
                                                                <button 
                                                                    key={c} 
                                                                    draggable
                                                                    onDragStart={(e) => {
                                                                        e.dataTransfer.setData(PRIMITIVE_MIME, c);
                                                                        e.dataTransfer.effectAllowed = 'copy';
                                                                        setIsDraggingComponent(c);
                                                                    }}
                                                                    onDragEnd={() => setIsDraggingComponent(null)}
                                                                    onClick={() => openComponentConfig(c)} 
                                                                    className="px-3 py-1.5 rounded-xl border border-foreground/5 bg-foreground/5 text-[11px] font-bold text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all shadow-sm cursor-grab active:cursor-grabbing select-none"
                                                                    title="Click to configure or drag directly onto app canvas"
                                                                >
                                                                    {c}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </ScrollArea>
                                )}
                            </motion.div>
                        )}

                        {/* ── WIRING TAB ── */}
                        {activeStudioTab === 'wiring' && (
                            <motion.div key="wiring" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-8">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-emerald-500/10 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                                <Plug2 className="w-5 h-5 text-emerald-400" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black uppercase tracking-tight">Vortex Wiring</h4>
                                                <p className="text-[10px] text-muted-foreground italic font-medium">Cross-domain hyper-links.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            {plumbingItems.map(item => (
                                                <div key={item.label} className="flex items-center justify-between p-3 rounded-2xl border border-foreground/5 bg-card/30 group hover:border-emerald-500/20 transition-all">
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn("p-1.5 rounded-lg bg-foreground/5 group-hover:bg-emerald-500/10 transition-all", item.linked ? "text-emerald-400" : "text-muted-foreground")}>
                                                            <item.icon className="w-4 h-4" />
                                                        </div>
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</span>
                                                    </div>
                                                    <Badge variant="outline" className={cn("text-[9px] font-bold font-mono border-foreground/5", item.linked ? "text-emerald-400" : "text-muted-foreground")}>
                                                        {item.value}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="p-4 rounded-2xl border border-foreground/5 bg-foreground/5 space-y-4">
                                            <div className="flex items-center gap-2">
                                                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                                                <span className="text-[10px] font-black uppercase tracking-widest">Active Schema</span>
                                            </div>
                                            <div className="space-y-1.5 opacity-60">
                                                {['domain_governor', 'mission_telemetry', 'realtime_events'].map(s => (
                                                    <div key={s} className="flex items-center justify-between px-2 py-1 bg-background/40 rounded border border-foreground/5">
                                                        <span className="text-[10px] font-mono">{s}</span>
                                                        <CheckCircle2 className="w-3 h-3 text-emerald-500/50" />
                                                    </div>
                                                ))}
                                            </div>
                                            <Button variant="ghost" className="w-full h-8 text-[10px] font-black uppercase tracking-widest text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10">
                                                Sync Master Catalog
                                            </Button>
                                        </div>
                                    </div>
                                </ScrollArea>
                            </motion.div>
                        )}

                        {/* ── SOUL TAB ── */}
                        {activeStudioTab === 'soul' && (
                            <motion.div key="soul" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-8">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-violet-500/10 rounded-lg shadow-[0_0_15px_rgba(139,92,246,0.3)]">
                                                <Dna className="w-5 h-5 text-violet-400" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black uppercase tracking-tight">Archetype Mapping</h4>
                                                <p className="text-[10px] text-muted-foreground italic font-medium">Neural personality footprint.</p>
                                            </div>
                                        </div>

                                        {/* Soul Radar */}
                                        <div className="relative p-2 rounded-xl border border-border bg-card overflow-hidden group">
                                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.1),transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity" />
                                            {renderSoulRadar(oceanTraits)}
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.keys(OCEAN_ARCHETYPES).map(name => (
                                                <button key={name} onClick={() => { setSoulArchetype(name); setOceanTraits({ ...OCEAN_ARCHETYPES[name] }); }}
                                                    className={cn("px-3 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border",
                                                        soulArchetype === name ? "border-violet-500 bg-violet-500/20 text-violet-700 dark:text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]" : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20")}>
                                                    {name}
                                                </button>
                                            ))}
                                            <button onClick={() => setSoulArchetype('Custom')} className={cn("col-span-2 px-3 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border",
                                                soulArchetype === 'Custom' ? "border-violet-500 bg-violet-500/20 text-violet-700 dark:text-violet-300 shadow-[0_0_15px_rgba(139,92,246,0.2)]" : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20")}>
                                                Manual Sync
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            {OCEAN_LABELS.map(label => (
                                                <div key={label.key} className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{label.label}</span>
                                                        <span className="text-[10px] font-black font-mono text-violet-400">{(oceanTraits[label.key] || 0.5).toFixed(2)}</span>
                                                    </div>
                                                    <input 
                                                        type="range" 
                                                        min="0" 
                                                        max="1" 
                                                        step="0.01" 
                                                        value={oceanTraits[label.key] || 0.5} 
                                                        onChange={(e) => { setOceanTraits(prev => ({...prev, [label.key]: parseFloat(e.target.value)})); setSoulArchetype('Custom'); }} 
                                                        className="w-full h-1 bg-foreground/5 rounded-full appearance-none cursor-pointer accent-violet-500" 
                                                        aria-label={label.label}
                                                        title={label.label}
                                                    />
                                                </div>
                                            ))}
                                        </div>

                                        <Button onClick={() => personalityMutation.mutate({ archetype: soulArchetype, ...oceanTraits })} disabled={personalityMutation.isPending} className="w-full h-10 gap-2 bg-violet-600 hover:bg-violet-700 shadow-xl shadow-violet-900/20 border-violet-500/30">
                                            {personalityMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                            Update Personality Matrix
                                        </Button>
                                    </div>
                                </ScrollArea>
                            </motion.div>
                        )}

                        {/* ── PLAN TAB ── */}
                        {activeStudioTab === 'plan' && (
                            <motion.div key="plan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                <DevelopmentPlanView plan={app.developmentPlan as any} />
                            </motion.div>
                        )}

                        {/* ── TELEMETRY TAB ── */}
                        {activeStudioTab === 'telemetry' && (
                            <motion.div key="telemetry" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-500/10 rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                                                <Activity className="w-5 h-5 text-blue-400" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black uppercase tracking-tight">Mission Bridge</h4>
                                                <p className="text-[10px] text-muted-foreground italic font-medium">Real-time application pulse.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            {telemetryLines?.length ? telemetryLines.map((line) => (
                                                <div key={line.id} className="p-3 rounded-xl border border-foreground/5 bg-card/40 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Badge variant="outline" className={cn("text-[9px] font-mono border-foreground/5", 
                                                            line.level === 'error' ? 'text-red-400' : 
                                                            line.level === 'warn' ? 'text-amber-400' : 'text-blue-400')}>
                                                            {line.event.toUpperCase()}
                                                        </Badge>
                                                        <span className="text-[9px] text-muted-foreground">{new Date(line.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground leading-relaxed font-mono">
                                                        {JSON.stringify(line.metadata)}
                                                    </p>
                                                </div>
                                            )) : (
                                                <div className="py-20 text-center opacity-30 italic text-[10px]">No telemetry signals detected.</div>
                                            )}
                                        </div>
                                    </div>
                                </ScrollArea>
                            </motion.div>
                        )}

                        {/* ── AUDITS TAB ── */}
                        {activeStudioTab === 'audits' && (
                            <motion.div key="audits" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full flex flex-col overflow-hidden">
                                <ScrollArea className="flex-1">
                                    <div className="p-4 space-y-6">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-red-500/10 rounded-lg shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                                                <ScanEye className="w-5 h-5 text-red-400" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black uppercase tracking-tight">Forge Shadow</h4>
                                                <p className="text-[10px] text-muted-foreground italic font-medium">Adversarial QA & Self-Healing.</p>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            {auditFindings?.length ? auditFindings.map((audit) => (
                                                <div key={audit.id} className="p-4 rounded-2xl border border-foreground/5 bg-foreground/5 space-y-3 group hover:border-red-500/20 transition-all">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("w-2 h-2 rounded-full animate-pulse", 
                                                                audit.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500')} />
                                                            <span className="text-[10px] font-black uppercase tracking-widest">{audit.findingType}</span>
                                                        </div>
                                                        <span className="text-[9px] text-muted-foreground">{new Date(audit.createdAt).toLocaleDateString()}</span>
                                                    </div>
                                                    <p className="text-[11px] text-foreground leading-relaxed">{audit.description}</p>
                                                    {audit.recommendation && (
                                                        <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                                                            <p className="text-[9px] text-red-400/80 font-medium italic">Recommendation: {audit.recommendation}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )) : (
                                                <div className="py-20 text-center opacity-30 italic text-[10px]">No audit history found. Run a Shadow Audit to begin.</div>
                                            )}
                                        </div>
                                    </div>
                                </ScrollArea>
                            </motion.div>
                        )}

                    </AnimatePresence>
                </div>
            </div>
            </div>

            {app.planReviewStatus === 'pending' && (
                <div className="absolute inset-0 z-overlay bg-background/90 backdrop-blur-xl flex items-center justify-center p-8">
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }} 
                        animate={{ opacity: 1, scale: 1 }} 
                        className="w-full max-w-4xl max-h-[90vh] bg-card border border-foreground/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
                    >
                        <div className="p-6 border-b border-foreground/10 flex items-center justify-between bg-foreground/5">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/20 rounded-2xl shadow-[0_0_20px_hsl(var(--primary)/0.4)]">
                                    <Target className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black uppercase tracking-tighter">Plan Review Required</h2>
                                    <p className="text-xs text-muted-foreground">The AI Architect has finalized the build sequence for <span className="text-primary font-bold">{app.name}</span>.</p>
                                </div>
                            </div>
                            <Badge variant="outline" className="px-3 py-1 bg-primary/10 border-primary/20 text-primary uppercase font-black tracking-widest text-[10px]">Governance Gate</Badge>
                        </div>
                        
                        <div className="flex-1 overflow-hidden">
                            <DevelopmentPlanView plan={app.developmentPlan as any} />
                        </div>

                        <div className="p-6 border-t border-foreground/10 bg-foreground/5 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                {/* Says what this gate IS — a human approval point — rather than
                                    "Autonomous Safety Verified", which claimed a check nothing ran. */}
                                <div className="p-2 bg-foreground/5 rounded-lg flex items-center gap-2">
                                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Awaiting Human Approval</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Button variant="ghost" className="text-xs font-black uppercase tracking-widest text-red-500 hover:bg-red-500/10" onClick={() => setChatDraft(`Revise the development plan before I approve it: `)}>
                                    Request Changes
                                </Button>
                                <Button className="px-8 h-12 shadow-xl shadow-primary/20" onClick={() => approvePlanMutation.mutate()} disabled={approvePlanMutation.isPending}>
                                    {approvePlanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                    Approve & Execute Build
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
            {/* Direct Studio Publish App Modal */}
            <PublishAppModal
                isOpen={isPublishModalOpen}
                onClose={() => setIsPublishModalOpen(false)}
                appId={appId}
                appSlug={app.slug}
                appName={app.name}
                onPublished={() => {
                    refetchDeployment();
                    onAppUpdated();
                }}
            />
        </>
    );
}
