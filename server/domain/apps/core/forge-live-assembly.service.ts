import { uiRegistryService, type PackagedBlockEntry } from './ui-registry.service.js';
import type {
    ArchitectureProposal,
    ForgeApiContract,
    ForgeApiEndpoint,
    ForgeLiveAssembly,
    ForgeLiveAssemblyBlock,
    ForgeLiveBlockStatus,
    ForgeOptions,
} from './forge-types.js';

// Matches a path SEGMENT, not a substring anywhere in the path.
const API_FILE_PATTERN = /(^|\/)(api|routes?|controllers?|openapi|schemas?)(\/|\.|$)/i;

function isApiImplementationFile(file: string): boolean {
    return API_FILE_PATTERN.test(file);
}

function resourceName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'records';
}

function buildApiContract(options: ForgeOptions, proposal?: ArchitectureProposal): ForgeApiContract {
    const basePath = `/api/${options.slug}`;
    // Claim only what the plan actually establishes. `!== false` read undefined —
    // no assembly plan at all — as authenticated, so an app with no auth pack got
    // a contract advertising bearer auth on every endpoint and a bearerAuth
    // security scheme. Advertising protection that may not exist is the wrong
    // direction to default: with no plan we know nothing, so we declare nothing.
    const selectedPacks = options.assemblyPlan?.selectedPacks;
    const auth: ForgeApiEndpoint['auth'] = selectedPacks?.includes('auth-jwt')
        ? 'bearer'
        : selectedPacks
            ? 'session'
            : 'public';
    const authenticated = auth === 'bearer';
    const proposalEndpoints = (proposal?.services || []).flatMap((service) =>
        (service.endpoints || []).map((endpoint, index) => ({
            id: `${resourceName(service.name)}-${index}`,
            method: endpoint.method.toUpperCase() as ForgeApiEndpoint['method'],
            path: endpoint.path.startsWith('/') ? endpoint.path : `/${endpoint.path}`,
            summary: endpoint.description,
            resource: resourceName(service.name),
            auth,
            status: 'specifying' as const,
            implementationFiles: [],
        })),
    );
    const resources = (options.defaultCollections?.length ? options.defaultCollections : [options.slug]).map(resourceName);
    const endpoints: ForgeApiEndpoint[] = proposalEndpoints.length ? proposalEndpoints : resources.flatMap((resource) => [
        { id: `${resource}-list`, method: 'GET', path: `${basePath}/${resource}`, summary: `List ${resource}`, resource, auth, status: 'specifying', implementationFiles: [] },
        { id: `${resource}-create`, method: 'POST', path: `${basePath}/${resource}`, summary: `Create ${resource}`, resource, auth, status: 'specifying', implementationFiles: [] },
        { id: `${resource}-read`, method: 'GET', path: `${basePath}/${resource}/{id}`, summary: `Get ${resource} by id`, resource, auth, status: 'specifying', implementationFiles: [] },
        { id: `${resource}-update`, method: 'PATCH', path: `${basePath}/${resource}/{id}`, summary: `Update ${resource}`, resource, auth, status: 'specifying', implementationFiles: [] },
        { id: `${resource}-delete`, method: 'DELETE', path: `${basePath}/${resource}/{id}`, summary: `Delete ${resource}`, resource, auth, status: 'specifying', implementationFiles: [] },
    ] as ForgeApiEndpoint[]);
    const schemas = proposal?.dataModels?.length ? proposal.dataModels : resources.map((resource) => ({
        name: resource.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(''),
        fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'name', type: 'string', required: true },
            { name: 'status', type: 'string', required: true },
            { name: 'createdAt', type: 'string', required: true },
        ],
    }));
    const paths = endpoints.reduce<Record<string, any>>((result, endpoint) => {
        result[endpoint.path] ||= {};
        result[endpoint.path][endpoint.method.toLowerCase()] = {
            summary: endpoint.summary,
            operationId: endpoint.id,
            security: endpoint.auth === 'bearer' ? [{ bearerAuth: [] }] : [],
            responses: { '200': { description: 'Successful response' } },
        };
        return result;
    }, {});
    const document = {
        openapi: '3.1.0',
        info: { title: `${options.name} API`, version: '1.0.0', description: options.apiInstructions || options.description },
        servers: [{ url: basePath }],
        paths,
        components: {
            schemas: Object.fromEntries(schemas.map((schema) => [schema.name, {
                type: 'object',
                required: schema.fields.filter((field) => field.required).map((field) => field.name),
                properties: Object.fromEntries(schema.fields.map((field) => [field.name, { type: field.type }])),
            }])),
            securitySchemes: authenticated ? { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } : {},
        },
    };

    return {
        openapi: '3.1.0',
        title: `${options.name} API`,
        version: '1.0.0',
        basePath,
        status: 'specifying',
        // Name what was actually certified. The SAT/DPLL solve resolves the
        // scaffold PACKS; it never inspects this contract, so calling the contract
        // itself "SAT-compatible" claimed a verification nothing performed.
        certification: options.assemblyPlan
            ? `Scaffold packs SAT-resolved (${options.assemblyPlan.selectedPacks.length} of ${options.assemblyPlan.requestedPacks.length}); the contract itself is unverified`
            : 'No SAT plan; compatibility unverified',
        endpoints,
        schemas,
        generatedFiles: [],
        document,
    };
}

const SAFE_PREVIEW_MODULES = new Set([
    'IndustrialDashboardHero',
    'MetricGrid',
    'StatusTimeline',
    'MissionControlTable',
    'AIAgentChat',
]);

const BLUEPRINT_COMPOSITIONS: Array<{ test: RegExp; modules: string[] }> = [
    { test: /chat|assistant|support/, modules: ['AIAgentChat', 'StatusTimeline', 'MetricGrid'] },
    { test: /crud|ticket|sales|stakeholder/, modules: ['MetricGrid', 'MissionControlTable', 'StatusTimeline'] },
    { test: /mission|ops|dispatch|devops|pipeline/, modules: ['IndustrialDashboardHero', 'MissionControlTable', 'StatusTimeline'] },
    { test: /analytics|dashboard|budget|industrial/, modules: ['IndustrialDashboardHero', 'MetricGrid', 'StatusTimeline'] },
];

function previewProps(module: string, options: ForgeOptions): Record<string, any> {
    const title = options.name || 'New Application';
    const collection = options.defaultCollections?.[0] || options.slug || 'records';
    switch (module) {
        case 'IndustrialDashboardHero':
            return {
                title,
                subtitle: options.description || 'Assembled with Oddjob platform components',
                stats: [
                    { label: 'Availability', value: '99.9%', change: 0.3, trend: 'up', icon: 'activity' },
                    { label: 'Active records', value: '1,248', change: 8.4, trend: 'up', icon: 'zap' },
                    { label: 'Policy checks', value: 'Passed', change: 0, trend: 'up', icon: 'shield' },
                ],
                data: [
                    { name: 'Mon', value: 38 }, { name: 'Tue', value: 52 },
                    { name: 'Wed', value: 47 }, { name: 'Thu', value: 68 },
                    { name: 'Fri', value: 74 },
                ],
            };
        case 'MetricGrid':
            return {
                columns: 3,
                metrics: [
                    { label: 'Total', value: '1,248', change: 8.4, trend: 'up', iconName: 'activity' },
                    { label: 'In progress', value: 32, change: 4.1, trend: 'up', iconName: 'loader' },
                    { label: 'Completed', value: '96%', change: 1.8, trend: 'up', iconName: 'check-circle' },
                ],
            };
        case 'StatusTimeline':
            const now = new Date().toISOString();
            return {
                title: 'Recent activity',
                events: [
                    { id: '1', timestamp: now, title: 'Application scaffold selected', status: 'completed' },
                    { id: '2', timestamp: now, title: 'Components assembled', status: 'in_progress' },
                    { id: '3', timestamp: now, title: 'Preview validation', status: 'pending' },
                ],
            };
        case 'MissionControlTable':
            return {
                title: `${title} records`,
                collection,
                columns: [
                    { key: 'name', label: 'Name' },
                    { key: 'status', label: 'Status', variant: 'badge' },
                    { key: 'updatedAt', label: 'Updated', variant: 'date' },
                ],
            };
        case 'AIAgentChat':
            return {
                personaName: `${title} Assistant`,
                initialMessages: [{ role: 'assistant', content: `Welcome to ${title}. How can I help?` }],
                suggestedPrompts: ['Show the latest activity', 'Summarize open work', 'What needs attention?'],
            };
        default:
            return {};
    }
}

function requestedModules(blueprintSlug: string, options: ForgeOptions, proposal?: ArchitectureProposal): string[] {
    const proposalModules = (proposal?.components || [])
        .map((component) => component.platformBlockId)
        .filter((id): id is string => !!id && SAFE_PREVIEW_MODULES.has(id));
    if (proposalModules.length) return proposalModules.slice(0, 4);

    const context = `${blueprintSlug} ${options.description || ''}`.toLowerCase();
    return BLUEPRINT_COMPOSITIONS.find((entry) => entry.test.test(context))?.modules
        || ['IndustrialDashboardHero', 'MetricGrid', 'StatusTimeline'];
}

function toBlock(entry: PackagedBlockEntry, options: ForgeOptions): ForgeLiveAssemblyBlock {
    const span = entry.id === 'IndustrialDashboardHero' || entry.id === 'AIAgentChat'
        ? 12
        : entry.id === 'MissionControlTable' ? 8 : 4;
    return {
        module: entry.id,
        componentName: entry.name,
        category: entry.category,
        description: entry.description,
        props: previewProps(entry.id, options),
        span,
        status: 'selected',
    };
}

export const forgeLiveAssemblyService = {
    async plan(blueprintSlug: string, options: ForgeOptions, proposal?: ArchitectureProposal): Promise<ForgeLiveAssembly> {
        const catalog = await uiRegistryService.getPackagedBlockManifest();
        const byId = new Map(catalog.map((entry) => [entry.id, entry]));
        const modules = [...new Set(requestedModules(blueprintSlug, options, proposal))];
        const blocks = modules.map((id) => byId.get(id)).filter((entry): entry is PackagedBlockEntry => !!entry).map((entry) => toBlock(entry, options));
        return {
            title: options.name,
            slug: options.slug,
            source: 'component-gallery',
            phase: 'planning',
            blocks,
            api: buildApiContract(options, proposal),
            files: [],
            previewUrl: options.blackboard?.deploymentUrl,
            updatedAt: new Date().toISOString(),
        };
    },

    withStatus(assembly: ForgeLiveAssembly, status: ForgeLiveBlockStatus, phase: ForgeLiveAssembly['phase']): ForgeLiveAssembly {
        return {
            ...assembly,
            phase,
            blocks: assembly.blocks.map((block) => ({ ...block, status })),
            api: {
                ...assembly.api,
                status: phase === 'preview' ? 'ready' : phase === 'failed' ? 'failed' : phase === 'assembling' ? 'generating' : 'specifying',
                endpoints: assembly.api.endpoints.map((endpoint) => ({
                    ...endpoint,
                    status: phase === 'preview' ? 'ready' : phase === 'failed' ? 'failed' : phase === 'assembling' ? 'generating' : 'specifying',
                })),
            },
            updatedAt: new Date().toISOString(),
        };
    },

    withFiles(assembly: ForgeLiveAssembly, files: string[], activeTask?: string): ForgeLiveAssembly {
        return {
            ...assembly,
            phase: 'assembling',
            files: [...new Set([...assembly.files, ...files])].sort(),
            activeTask,
            blocks: assembly.blocks.map((block) => ({ ...block, status: 'assembling' })),
            api: {
                ...assembly.api,
                status: 'generating',
                generatedFiles: [...new Set([
                    ...assembly.api.generatedFiles,
                    ...files.filter(isApiImplementationFile),
                ])].sort(),
                endpoints: assembly.api.endpoints.map((endpoint) => ({
                    ...endpoint,
                    status: 'generating',
                    // The same anchored test as generatedFiles above. The previous
                    // /route|controller|api/i matched anywhere in the string, so a
                    // path like src/components/RapidList.tsx counted as an API
                    // implementation — "Rapid" contains "api".
                    implementationFiles: [...new Set([
                        ...endpoint.implementationFiles,
                        ...files.filter(isApiImplementationFile),
                    ])].sort(),
                })),
            },
            updatedAt: new Date().toISOString(),
        };
    },
};
