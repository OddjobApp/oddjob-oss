import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Save, Key, Link as LinkIcon, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { FieldDefinition, JobInputSchema, JobOutputSchema } from "@shared/schema/jobs/types";
import SchemaTreeView from '@domain-ui/core/ui/components/shared/SchemaTreeView';
import JobRunDialog from "@domain-ui/jobs/ui/modules/jobs/components/JobRunDialog";
import { SqlResultTable } from './SqlResultTable.js';



interface TestResponse {
  success: boolean;
  output?: string | object;
  error?: string;
  metadata?: {
    latency?: number;
    tokensUsed?: number;
    statusCode?: number;
    statusText?: string;
    schemaCapture?: {
      requested?: boolean;
      captureInput?: boolean;
      captureOutput?: boolean;
      hasInputSchema?: boolean;
      hasOutputSchema?: boolean;
      inputSchemaFields?: number;
      outputSchemaFields?: number;
      capturedAt?: string;
    };
  };
  inputSchema?: JobOutputSchema;
  outputSchema?: JobOutputSchema;
  schemaCaptureInfo?: {
    requested?: boolean;
    captureInput?: boolean;
    captureOutput?: boolean;
    hasInputSchema?: boolean;
    hasOutputSchema?: boolean;
    inputSchemaFields?: number;
    outputSchemaFields?: number;
    capturedAt?: string;
  };
  _debug?: any;
}

export interface TestAndCaptureProps {
  jobId: number;
  jobType: string;
  parameterSchema?: any;
  jobOverrides?: {
    config?: any;
    outputDatasetId?: number | null;
    outputKnowledgeTopicId?: number | null;
    enableKnowledgeStore?: boolean;
  };
}

export default function TestAndCapture({ jobId, jobType, parameterSchema, jobOverrides }: TestAndCaptureProps) {
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);

  const testMutation = useMutation({
    mutationFn: async (input: Record<string, any> = {}) => {
      setIsRunning(true);
      try {
        console.log('[TestAndCapture] Sending test request', { input, overrides: jobOverrides });
        const res = await apiRequest('POST', `/api/jobs/${jobId}/test`, {
          captureInputSchema: true,
          captureOutputSchema: true,
          input: Object.keys(input).length > 0 ? input : undefined,
          ...jobOverrides
        });
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || 'Test failed');
        }

        // Read response headers for schema capture info (fallback mechanism)
        const headerInfo = {
          requested: res.headers.get('X-Schema-Capture-Requested') === 'true',
          captureInput: res.headers.get('X-Schema-Capture-Input') === 'true',
          captureOutput: res.headers.get('X-Schema-Capture-Output') === 'true',
          hasInputSchema: res.headers.get('X-Schema-Capture-Has-Input-Schema') === 'true',
          hasOutputSchema: res.headers.get('X-Schema-Capture-Has-Output-Schema') === 'true',
          inputFields: parseInt(res.headers.get('X-Schema-Capture-Input-Fields') || '0', 10),
          outputFields: parseInt(res.headers.get('X-Schema-Capture-Output-Fields') || '0', 10),
        };
        console.log('[TestAndCapture] Schema capture info from response headers:', headerInfo);

        const data = await res.json();
        console.log('[TestAndCapture] Received response:', {
          keys: Object.keys(data),
          hasDebug: !!data._debug,
          hasOutputSchema: !!data.outputSchema,
          hasInputSchema: !!data.inputSchema,
          headerInfo,
        });

        // Attach header info to data for use in onSuccess
        (data as any)._headerInfo = headerInfo;

        return data;
      } finally {
        setIsRunning(false);
      }
    },
    onSuccess: (data) => {
      // Collect schema capture info from multiple sources (prioritized fallback approach)
      // Priority: 1. Schema objects' _captureInfo/captureInfo, 2. metadata.schemaCapture, 3. response headers, 4. top-level fields
      const inputCaptureInfo = (data.inputSchema as any)?._captureInfo || (data.inputSchema as any)?.captureInfo;
      const outputCaptureInfo = (data.outputSchema as any)?._captureInfo || (data.outputSchema as any)?.captureInfo;
      const metadataInfo = data.metadata?.schemaCapture;
      const headerInfo = (data as any)._headerInfo;
      const topLevelInfo = data.schemaCaptureInfo || data._debug;

      // Build comprehensive schema info from best available source
      const schemaInfo = outputCaptureInfo || inputCaptureInfo || metadataInfo || headerInfo || topLevelInfo || {};

      const inputFields = data.inputSchema ? Object.keys(data.inputSchema.schemaDef || {}).length : 0;
      const outputFields = data.outputSchema ? Object.keys(data.outputSchema.schemaDef || {}).length : 0;

      console.log('[TestAndCapture] Test response received:', {
        success: data.success,
        hasInputSchema: !!data.inputSchema,
        hasOutputSchema: !!data.outputSchema,
        inputSchemaFields: inputFields,
        outputSchemaFields: outputFields,
        responseKeys: Object.keys(data),
      });

      // Log all available sources of schema capture info
      console.log('[TestAndCapture] Schema capture info sources:', {
        fromInputSchema: inputCaptureInfo,
        fromOutputSchema: outputCaptureInfo,
        fromMetadata: metadataInfo,
        fromHeaders: headerInfo,
        fromTopLevel: topLevelInfo,
        finalCombined: schemaInfo,
      });

      // Warn if schema capture was requested but not successful
      const captureRequested = schemaInfo.requested || schemaInfo.captureOutput || schemaInfo.captureInput;
      const captureOutputRequested = schemaInfo.captureOutput || schemaInfo.requested;
      if (captureOutputRequested && !data.outputSchema && !schemaInfo.hasOutputSchema) {
        console.warn('[TestAndCapture] ⚠️ Schema capture was requested but output schema is missing:', {
          captureRequested,
          captureOutput: schemaInfo.captureOutput,
          hasOutputSchema: !!data.outputSchema,
          hasOutput: schemaInfo.hasOutput,
          outputType: schemaInfo.outputType,
          resultSuccess: schemaInfo.resultSuccess,
          responseOk: schemaInfo.responseOk,
        });
      }

      // Log detailed capture info from schema objects (most reliable source)
      if (inputCaptureInfo) {
        console.log('[TestAndCapture] ✅ Input schema capture info (from schema object):', inputCaptureInfo);
      } else if (data.inputSchema) {
        console.warn('[TestAndCapture] ⚠️ Input schema exists but has no capture info. Schema keys:', Object.keys(data.inputSchema));
      }
      if (outputCaptureInfo) {
        console.log('[TestAndCapture] ✅ Output schema capture info (from schema object):', outputCaptureInfo);
      } else if (data.outputSchema) {
        console.warn('[TestAndCapture] ⚠️ Output schema exists but has no capture info. Schema keys:', Object.keys(data.outputSchema));
      }

      setTestResult(data);
      toast({
        title: 'Test completed',
        description: data.success ? 'Job executed successfully' : 'Job execution failed',
        variant: data.success ? 'default' : 'destructive',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Test failed',
        description: error.message || 'Failed to run test',
        variant: 'destructive',
      });
    },
  });

  const saveSchemaMutation = useMutation({
    mutationFn: async (schemaType: 'input' | 'output') => {
      if (!testResult) throw new Error('No test result available');

      const schema = schemaType === 'input' ? testResult.inputSchema : testResult.outputSchema;
      if (!schema) throw new Error(`No ${schemaType} schema to save`);

      // Clean the schema object - remove debug fields that shouldn't be stored
      const cleanedSchema = {
        capturedAt: schema.capturedAt,
        [schemaType === 'input' ? 'sampleInput' : 'sampleOutput']: (schema as any)[schemaType === 'input' ? 'sampleInput' : 'sampleOutput'],
        schemaDef: schema.schemaDef,
      };

      console.log(`[TestAndCapture] Saving ${schemaType} schema:`, {
        jobId,
        schemaKeys: Object.keys(cleanedSchema),
        schemaDefFields: Object.keys(cleanedSchema.schemaDef || {}).length,
      });

      const res = await apiRequest('POST', `/api/jobs/${jobId}/schemas`, {
        [schemaType === 'input' ? 'inputSchema' : 'outputSchema']: cleanedSchema,
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: `HTTP ${res.status}: ${res.statusText}` }));
        console.error(`[TestAndCapture] Failed to save ${schemaType} schema:`, error);
        throw new Error(error.message || 'Failed to save schema');
      }

      const result = await res.json();
      console.log(`[TestAndCapture] Successfully saved ${schemaType} schema:`, result);
      return result;
    },
    onSuccess: (_, schemaType) => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId.toString()] });
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId.toString(), 'schemas'] });
      toast({
        title: 'Schema saved',
        description: `${schemaType === 'input' ? 'Input' : 'Output'} schema saved successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to save schema',
        description: error.message || 'Failed to save schema',
        variant: 'destructive',
      });
    },
  });

  const formatJSON = (data: any): string => {
    if (typeof data === 'string') {
      try {
        return JSON.stringify(JSON.parse(data), null, 2);
      } catch {
        return data;
      }
    }
    return JSON.stringify(data, null, 2);
  };

  const renderSchemaPreview = (schema: JobOutputSchema | undefined, title: string) => {
    if (!schema || !schema.schemaDef) return null;

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <SchemaTreeView schema={schema} />
      </div>
    );
  };

  const handleRunClick = () => {
    if (parameterSchema?.parameters?.length > 0) {
      setShowRunDialog(true);
    } else {
      testMutation.mutate({});
    }
  };

  return (
    <div className="space-y-4">
      <JobRunDialog
        open={showRunDialog}
        onOpenChange={setShowRunDialog}
        parameterSchema={parameterSchema}
        onRun={(inputs: any) => testMutation.mutate(inputs)}
      />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Test & Capture</h3>
          <p className="text-sm text-muted-foreground">
            Run a test execution and capture input/output schemas
          </p>
        </div>
        <Button
          onClick={handleRunClick}
          disabled={isRunning || testMutation.isPending}
          data-testid="button-run-step-dry"
        >
          {isRunning || testMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Run Step (Dry)
            </>
          )}
        </Button>
      </div>

      {testResult && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Test Result</CardTitle>
                <Badge variant={testResult.success ? 'default' : 'destructive'}>
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Success
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 mr-1" />
                      Failed
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {testResult.error && (
                <div className="p-3 rounded bg-destructive/10 border border-destructive/20">
                  <p className="text-sm font-semibold text-destructive mb-1">Error</p>
                  <p className="text-sm text-destructive">{testResult.error}</p>
                </div>
              )}

              {testResult.metadata && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {testResult.metadata.latency && (
                    <div>
                      <span className="text-muted-foreground">Latency:</span>{' '}
                      <span className="font-semibold">{testResult.metadata.latency}ms</span>
                    </div>
                  )}
                  {testResult.metadata.tokensUsed && (
                    <div>
                      <span className="text-muted-foreground">Tokens:</span>{' '}
                      <span className="font-semibold">{testResult.metadata.tokensUsed}</span>
                    </div>
                  )}
                  {testResult.metadata.statusCode && (
                    <div>
                      <span className="text-muted-foreground">Status:</span>{' '}
                      <span className="font-semibold">
                        {testResult.metadata.statusCode} {testResult.metadata.statusText}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Schema Capture Information Section */}
              {(() => {
                const inputCaptureInfo = (testResult.inputSchema as any)?._captureInfo || (testResult.inputSchema as any)?.captureInfo;
                const outputCaptureInfo = (testResult.outputSchema as any)?._captureInfo || (testResult.outputSchema as any)?.captureInfo;
                const metadataInfo = testResult.metadata?.schemaCapture;
                const headerInfo = (testResult as any)._headerInfo;
                const schemaInfo = outputCaptureInfo || inputCaptureInfo || metadataInfo || headerInfo || testResult.schemaCaptureInfo || {};

                const hasInputSchema = !!testResult.inputSchema;
                const hasOutputSchema = !!testResult.outputSchema;
                const inputFields = testResult.inputSchema ? Object.keys(testResult.inputSchema.schemaDef || {}).length : 0;
                const outputFields = testResult.outputSchema ? Object.keys(testResult.outputSchema.schemaDef || {}).length : 0;
                const captureRequested = schemaInfo.requested || schemaInfo.captureOutput || schemaInfo.captureInput;

                if (!captureRequested && !hasInputSchema && !hasOutputSchema) {
                  return null;
                }

                return (
                  <div className="space-y-2 p-4 rounded-lg border bg-muted/30">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      Schema Capture Status
                      {hasInputSchema || hasOutputSchema ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-yellow-600" />
                      )}
                    </h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Input Schema:</span>{' '}
                        {hasInputSchema ? (
                          <span className="font-semibold text-green-600">
                            Captured ({inputFields} fields)
                          </span>
                        ) : (
                          <span className="font-semibold text-muted-foreground">
                            {schemaInfo.captureInput ? 'Not captured' : 'Not requested'}
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Output Schema:</span>{' '}
                        {hasOutputSchema ? (
                          <span className="font-semibold text-green-600">
                            Captured ({outputFields} fields)
                          </span>
                        ) : (
                          <span className="font-semibold text-muted-foreground">
                            {schemaInfo.captureOutput ? 'Not captured' : 'Not requested'}
                          </span>
                        )}
                      </div>
                      {schemaInfo.capturedAt && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Captured At:</span>{' '}
                          <span className="font-semibold">
                            {new Date(schemaInfo.capturedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                      {schemaInfo.outputType && (
                        <div>
                          <span className="text-muted-foreground">Output Type:</span>{' '}
                          <span className="font-semibold">{schemaInfo.outputType}</span>
                        </div>
                      )}
                      {schemaInfo.responseOk !== undefined && (
                        <div>
                          <span className="text-muted-foreground">Response Status:</span>{' '}
                          <span className={`font-semibold ${schemaInfo.responseOk ? 'text-green-600' : 'text-red-600'}`}>
                            {schemaInfo.responseOk ? 'OK' : 'Failed'}
                          </span>
                        </div>
                      )}
                    </div>
                    {!hasOutputSchema && schemaInfo.captureOutput && (
                      <div className="mt-2 p-2 rounded bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800">
                        <p className="text-xs text-yellow-800 dark:text-yellow-200">
                          ⚠️ Output schema capture was requested but no schema was generated.
                          {schemaInfo.hasOutput === false && ' The response had no output data.'}
                          {schemaInfo.outputType && ` Output type: ${schemaInfo.outputType}`}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {testResult.output !== undefined && (
                <div className="space-y-2">
                  {jobType === 'sql_query' ? (
                    <SqlResultTable data={testResult.output} />
                  ) : (
                    <>
                      <h4 className="text-sm font-semibold">Live JSON Response</h4>
                      <ScrollArea className="h-96 rounded-md border bg-muted p-4">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                          {formatJSON(testResult.output)}
                        </pre>
                      </ScrollArea>
                    </>
                  )}
                </div>
              )}

              <Separator />

              {testResult.outputSchema && (
                <div className="space-y-2">
                  {renderSchemaPreview(testResult.outputSchema, 'Schema Preview')}
                  <Button
                    onClick={() => saveSchemaMutation.mutate('output')}
                    disabled={saveSchemaMutation.isPending}
                    size="sm"
                    data-testid="button-save-output-schema"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveSchemaMutation.isPending ? 'Saving...' : 'Save Output Schema'}
                  </Button>
                </div>
              )}

              {testResult.inputSchema && (
                <div className="space-y-2">
                  {renderSchemaPreview(testResult.inputSchema, 'Input Schema Preview')}
                  <Button
                    onClick={() => saveSchemaMutation.mutate('input')}
                    disabled={saveSchemaMutation.isPending}
                    size="sm"
                    variant="outline"
                    data-testid="button-save-input-schema"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {saveSchemaMutation.isPending ? 'Saving...' : 'Save Input Schema'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!testResult && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Click "Run Step (Dry)" to execute a test run and capture schemas</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

