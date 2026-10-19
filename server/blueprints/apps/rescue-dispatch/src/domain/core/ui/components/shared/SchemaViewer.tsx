import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Key, Link as LinkIcon, Save, CheckCircle2 } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { FieldDefinition, JobInputSchema, JobOutputSchema } from "@shared/schema/jobs/types";
import SchemaTreeView from '@domain-ui/core/ui/components/shared/SchemaTreeView';

interface SchemaViewerProps {
  jobId: number;
}

interface SchemasResponse {
  inputSchema: JobInputSchema | null;
  outputSchema: JobOutputSchema | null;
}

export default function SchemaViewer({ jobId }: SchemaViewerProps) {
  const { toast } = useToast();
  const [editingField, setEditingField] = useState<{ schema: 'input' | 'output'; path: string } | null>(null);
  const [editedSchemas, setEditedSchemas] = useState<SchemasResponse | null>(null);

  const { data: schemas, isLoading } = useQuery<SchemasResponse>({
    queryKey: ['/api/jobs', jobId.toString(), 'schemas'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/jobs/${jobId}/schemas`);
      if (!res.ok) {
        throw new Error('Failed to fetch schemas');
      }
      return await res.json();
    },
  });

  const saveSchemaMutation = useMutation({
    mutationFn: async (schemaType: 'input' | 'output') => {
      if (!editedSchemas) throw new Error('No schema changes to save');

      const schema = schemaType === 'input' ? editedSchemas.inputSchema : editedSchemas.outputSchema;
      if (!schema) throw new Error(`No ${schemaType} schema to save`);

      const res = await apiRequest('POST', `/api/jobs/${jobId}/schemas`, {
        body: JSON.stringify({
          [schemaType === 'input' ? 'inputSchema' : 'outputSchema']: schema,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save schema');
      }
      return await res.json();
    },
    onSuccess: (_, schemaType) => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId.toString(), 'schemas'] });
      setEditingField(null);
      setEditedSchemas(null);
      toast({
        title: 'Schema updated',
        description: `${schemaType === 'input' ? 'Input' : 'Output'} schema updated successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to update schema',
        description: error.message || 'Failed to update schema',
        variant: 'destructive',
      });
    },
  });

  const updateFieldAnnotation = (
    schemaType: 'input' | 'output',
    path: string,
    updates: Partial<FieldDefinition>
  ) => {
    const currentSchemas = editedSchemas || schemas || { inputSchema: null, outputSchema: null };
    const schema = schemaType === 'input' ? currentSchemas.inputSchema : currentSchemas.outputSchema;

    if (!schema || !schema.schemaDef) return;

    const updatedSchema = {
      ...schema,
      schemaDef: {
        ...schema.schemaDef,
        [path]: {
          ...schema.schemaDef[path],
          ...updates,
        },
      },
    };

    setEditedSchemas({
      ...currentSchemas,
      [schemaType === 'input' ? 'inputSchema' : 'outputSchema']: updatedSchema,
    });
  };

  const renderSchema = (schema: JobInputSchema | JobOutputSchema | null | undefined, title: string, schemaType: 'input' | 'output') => {
    if (!schema || !schema.schemaDef) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>No schema captured yet</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use the "Test & Capture" tab to capture a schema for this job.
            </p>
          </CardContent>
        </Card>
      );
    }

    const fields = Object.entries(schema.schemaDef);
    const displaySchema = editedSchemas?.[schemaType === 'input' ? 'inputSchema' : 'outputSchema'] || schema;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>
                Captured at {new Date(schema.capturedAt).toLocaleString()}
              </CardDescription>
            </div>
            {editedSchemas && editedSchemas[schemaType === 'input' ? 'inputSchema' : 'outputSchema'] && (
              <Button
                onClick={() => saveSchemaMutation.mutate(schemaType)}
                disabled={saveSchemaMutation.isPending}
                size="sm"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground mb-4">
              {fields.length} field{fields.length !== 1 ? 's' : ''} detected
            </div>
            <ScrollArea className="h-96">
              <SchemaTreeView
                schema={displaySchema}
                editable={true}
                editingPath={editingField?.schema === schemaType ? editingField.path : null}
                onEdit={(path) => setEditingField(path ? { schema: schemaType, path } : null)}
                onUpdateField={(path, updates) => updateFieldAnnotation(schemaType, path, updates)}
              />
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading schemas...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderSchema(schemas?.inputSchema, 'Input Schema', 'input')}
      {renderSchema(schemas?.outputSchema, 'Output Schema', 'output')}
    </div>
  );
}


