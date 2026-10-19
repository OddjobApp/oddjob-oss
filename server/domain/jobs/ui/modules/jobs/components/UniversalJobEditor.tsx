import React, { Suspense, lazy } from "react";
import { 
    AlertCircle, 
    Settings, 
    Terminal, 
    Bot, 
    Code, 
    Database, 
    Globe, 
    FileText,
    Zap,
    Braces
} from "lucide-react";
import { 
    Card, 
    CardContent, 
    CardDescription, 
    CardHeader, 
    CardTitle 
} from "@domain-ui/core/ui/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import JsonEditor from "@domain-ui/core/ui/components/shared/JsonEditor";

// Lazy load specialized components to keep the main bundle light
const AIAgentJobConfig = lazy(() => import("./AIAgentJobConfig"));
const AiApiCallJobConfig = lazy(() => import("./AiApiCallJobConfig"));
const AirflowDagRunJobConfig = lazy(() => import("./AirflowDagRunJobConfig"));
const DecisionJobConfig = lazy(() => import("./DecisionJobConfig"));
const EmailSendConfig = lazy(() => import("./EmailSendConfig"));
const FileExportJobConfig = lazy(() => import("./FileExportJobConfig"));
const FileWriterJobConfig = lazy(() => import("./FileWriterJobConfig"));
const FolderImportJobConfig = lazy(() => import("./FolderImportJobConfig"));
const GitJobConfig = lazy(() => import("./GitJobConfig"));
const HumanApprovalJobConfig = lazy(() => import("./HumanApprovalJobConfig"));
const IteratorJobConfig = lazy(() => import("./IteratorJobConfig"));
const NodeScriptJobConfig = lazy(() => import("./NodeScriptJobConfig"));
const OpenAPIJobConfig = lazy(() => import("./OpenAPIJobConfig"));
const PythonJobConfig = lazy(() => import("./PythonJobConfig"));
const RepeaterJobConfig = lazy(() => import("./RepeaterJobConfig"));
const RerankerJobConfig = lazy(() => import("./RerankerJobConfig"));
const SeleniumJobConfig = lazy(() => import("./SeleniumJobConfig"));
const ShellJobConfig = lazy(() => import("./ShellJobConfig"));
const SlackPostConfig = lazy(() => import("./SlackPostConfig"));
const SqlQueryConfig = lazy(() => import("./SqlQueryConfig"));
const StaticResponseJobConfig = lazy(() => import("./StaticResponseJobConfig"));
const SupervisorJobConfig = lazy(() => import("./SupervisorJobConfig"));
const TransformationJobConfig = lazy(() => import("./TransformationJobConfig"));
const CurlJobConfig = lazy(() => import("./CurlJobConfig"));
const TeamsPostConfig = lazy(() => import("./TeamsPostConfig"));
const FileOpsJobConfig = lazy(() => import("./FileOpsJobConfig"));
const ConfluenceSyncConfig = lazy(() => import("./ConfluenceSyncConfig"));
const JiraSyncConfig = lazy(() => import("./JiraSyncConfig"));
const GoogleDriveSyncConfig = lazy(() => import("./GoogleDriveSyncConfig"));
const YoutubeSyncConfig = lazy(() => import("./YoutubeSyncConfig"));
const GithubSyncConfig = lazy(() => import("./GithubSyncConfig"));
const SharepointSyncConfig = lazy(() => import("./SharepointSyncConfig"));
const GithubOpConfig = lazy(() => import("./GithubOpConfig"));
const CloudFunctionConfig = lazy(() => import("./CloudFunctionConfig"));
const MonitoringQueryConfig = lazy(() => import("./MonitoringQueryConfig"));
const DispatcherJobConfig = lazy(() => import("./DispatcherJobConfig"));
const FormAgentConfig = lazy(() => import("./FormAgentConfig"));
const FoundryAgentConfig = lazy(() => import("./FoundryAgentConfig"));
const ComputerUseJobConfig = lazy(() => import("./ComputerUseJobConfig"));

// List of types that have a specialized visual editor
const SPECIALIZED_TYPES = [
    'ai_agent',
    'ai_api_call',
    'airflow_dag_run',
    'api',
    'cloud_function',
    'confluence_sync',
    'curl',
    'decision',
    'dispatcher',
    'email_send',
    'file_export',
    'file_ops',
    'file_writer',
    'folder_import',
    'form_agent',
    'foundry_agent',
    'git_op',
    'github_op',
    'github_sync',
    'google_drive_sync',
    'human_approval',
    'iterator',
    'jira_sync',
    'monitoring_query',
    'node_script',
    'openapi',
    'python',
    'repeater',
    'reranker',
    'selenium',
    'sharepoint_sync',
    'shell',
    'slack_post',
    'sql_query',
    'static_response',
    'supervisor',
    'teams_post',
    'transformer',
    'youtube_sync',
    'computer_use',
];

// Fallback until others are fully restored
const SimplePlaceholder = ({ type }: { type: string }) => (
    <div className="p-12 text-center space-y-4">
        <Braces className="w-12 h-12 mx-auto text-muted-foreground/30" />
        <div className="space-y-1">
            <h3 className="text-sm font-bold uppercase tracking-widest leading-none">Structured Config Available soon</h3>
            <p className="text-[11px] text-muted-foreground">The dedicated UI for {type.toUpperCase()} is being synchronized. Use the JSON editor below for full control.</p>
        </div>
    </div>
);

interface UniversalJobEditorProps {
    type: string;
    config: any;
    onChange: (config: any) => void;
    availableVariables?: any[];
}

export default function UniversalJobEditor({ type, config, onChange, availableVariables = [] }: UniversalJobEditorProps) {
    
    const handleJsonChange = (jsonString: string) => {
        try {
            const parsed = JSON.parse(jsonString);
            onChange(parsed);
        } catch (e) {
            // Keep as string if invalid, JsonEditor handles the error display
        }
    };

    const configString = typeof config === 'string' ? config : JSON.stringify(config, null, 2);

    return (
        <div className="w-full">
            <Tabs defaultValue="visual" className="w-full">
                <div className="px-6 py-3 border-b bg-muted/20 flex items-center justify-between">
                    <TabsList className="bg-background/50 border h-8">
                        <TabsTrigger value="visual" className="text-[10px] uppercase font-bold tracking-widest px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                            Visual Editor
                        </TabsTrigger>
                        <TabsTrigger value="json" className="text-[10px] uppercase font-bold tracking-widest px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                            Raw JSON
                        </TabsTrigger>
                    </TabsList>
                    
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <Settings className="w-3 h-3" />
                        <span>Schema Validation: Active</span>
                    </div>
                </div>

                <TabsContent value="visual" className="m-0 border-none">
                    <Suspense fallback={<div className="p-12 animate-pulse text-center text-xs uppercase font-bold tracking-widest text-muted-foreground">Loading configuration...</div>}>
                        {(() => {
                            switch(type) {
                                case 'ai_agent':
                                    return <AIAgentJobConfig config={config} onChange={onChange} />;
                                case 'ai_api_call':
                                    return <AiApiCallJobConfig config={config} onChange={onChange} />;
                                case 'airflow_dag_run':
                                    return <AirflowDagRunJobConfig config={config} onChange={onChange} />;
                                case 'decision':
                                    return <DecisionJobConfig config={config} onChange={onChange} />;
                                case 'email_send':
                                    return <EmailSendConfig config={config} onChange={onChange} credentials={[]} />;
                                case 'file_export':
                                    return <FileExportJobConfig config={config} onChange={onChange} />;
                                case 'file_writer':
                                    return <FileWriterJobConfig config={config} onChange={onChange} />;
                                case 'folder_import':
                                    return <FolderImportJobConfig config={config} onChange={onChange} />;
                                case 'human_approval':
                                    return <HumanApprovalJobConfig config={config} onChange={onChange} />;
                                case 'iterator':
                                    return <IteratorJobConfig config={config} onChange={onChange} />;
                                case 'node_script':
                                    return <NodeScriptJobConfig config={config} onChange={onChange} />;
                                case 'openapi':
                                    return <OpenAPIJobConfig config={config} onChange={onChange} />;
                                case 'python':
                                    return <PythonJobConfig config={config} onChange={onChange} />;
                                case 'repeater':
                                    return <RepeaterJobConfig config={config} onChange={onChange} />;
                                case 'reranker':
                                    return <RerankerJobConfig config={config} onChange={onChange} credentials={[]} />;
                                case 'selenium':
                                    return <SeleniumJobConfig config={config} onChange={onChange} />;
                                case 'shell':
                                    return <ShellJobConfig config={config} onChange={onChange} />;
                                case 'slack_post':
                                    return <SlackPostConfig config={config} onChange={onChange} credentials={[]} />;
                                case 'sql_query':
                                    return <SqlQueryConfig config={config} onChange={onChange} credentials={[]} />;
                                case 'static_response':
                                    return <StaticResponseJobConfig config={config} onChange={onChange} />;
                                case 'supervisor':
                                    return <SupervisorJobConfig config={config} onChange={onChange} pipelines={[]} />;
                                case 'transformer':
                                    return <TransformationJobConfig config={config} onChange={onChange} />;
                                case 'git_op':
                                    return <GitJobConfig config={config} onChange={onChange} />;
                                case 'curl':
                                    return <CurlJobConfig config={config} onChange={onChange} />;
                                // api type shares the same schema as curl
                                case 'api':
                                    return <CurlJobConfig config={config} onChange={onChange} />;
                                case 'teams_post':
                                    return <TeamsPostConfig config={config} onChange={onChange} />;
                                case 'file_ops':
                                    return <FileOpsJobConfig config={config} onChange={onChange} />;
                                case 'confluence_sync':
                                    return <ConfluenceSyncConfig config={config} onChange={onChange} />;
                                case 'jira_sync':
                                    return <JiraSyncConfig config={config} onChange={onChange} />;
                                case 'google_drive_sync':
                                    return <GoogleDriveSyncConfig config={config} onChange={onChange} />;
                                case 'youtube_sync':
                                    return <YoutubeSyncConfig config={config} onChange={onChange} />;
                                case 'github_sync':
                                    return <GithubSyncConfig config={config} onChange={onChange} />;
                                case 'sharepoint_sync':
                                    return <SharepointSyncConfig config={config} onChange={onChange} />;
                                case 'github_op':
                                    return <GithubOpConfig config={config} onChange={onChange} />;
                                case 'cloud_function':
                                    return <CloudFunctionConfig config={config} onChange={onChange} />;
                                case 'monitoring_query':
                                    return <MonitoringQueryConfig config={config} onChange={onChange} />;
                                case 'dispatcher':
                                    return <DispatcherJobConfig config={config} onChange={onChange} />;
                                case 'form_agent':
                                    return <FormAgentConfig config={config} onChange={onChange} />;
                                case 'foundry_agent':
                                    return <FoundryAgentConfig config={config} onChange={onChange} />;
                                case 'computer_use':
                                    return <ComputerUseJobConfig config={config} onChange={onChange} />;
                                default:
                                    return <SimplePlaceholder type={type} />;
                            }
                        })()}
                    </Suspense>
                    
                    {/* Inline JSON hint if visual is a placeholder */}
                    {!SPECIALIZED_TYPES.includes(type) && (
                        <div className="px-6 pb-6">
                             <JsonEditor 
                                value={configString}
                                onChange={handleJsonChange}
                                rows={12}
                                label="Configuration (JSON)"
                                showAiFixButton={true}
                                aiFixContext={`${type} job configuration`}
                                className="border-primary/10 bg-muted/10"
                            />
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="json" className="m-0 p-6 border-none">
                    <div className="space-y-4">
                        <Card className="border-dashed border-primary/20 bg-primary/5">
                            <CardContent className="p-4 flex items-start gap-3">
                                <AlertCircle className="w-4 h-4 text-primary mt-0.5" />
                                <div className="space-y-1">
                                    <p className="text-[11px] font-bold uppercase tracking-tight">Direct Matrix Access</p>
                                    <p className="text-[10px] text-muted-foreground leading-normal">
                                        Modifying the raw JSON bypasses visual constraints. Ensure all parameters align with the <code className="bg-primary/10 px-1 rounded">{type}</code> schema definition.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        
                        <JsonEditor 
                            value={configString}
                            onChange={handleJsonChange}
                            rows={20}
                            showAiFixButton={true}
                            aiFixContext={`${type} job configuration`}
                            variables={availableVariables}
                        />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
