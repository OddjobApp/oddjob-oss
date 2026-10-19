import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import { ExternalLink } from 'lucide-react';

interface KnowledgeNode {
  id: number;
  entityType: string;
  label: string;
  data: Record<string, any>;
  extractionSources: Array<{
    source: 'job' | 'pipeline';
    jobId?: number;
    pipelineExecutionId?: number;
    stepOrder?: number;
  }>;
}

interface KnowledgeDocumentNodeLinksProps {
  knowledgeDocumentId: number;
}

export default function KnowledgeDocumentNodeLinks({ knowledgeDocumentId }: KnowledgeDocumentNodeLinksProps) {
  const { data: nodes, isLoading } = useQuery<KnowledgeNode[]>({
    queryKey: ['/api/knowledge-documents', knowledgeDocumentId, 'nodes'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/knowledge-documents/${knowledgeDocumentId}/nodes`);
      return res.json();
    },
    enabled: !!knowledgeDocumentId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Linked Knowledge Graph Nodes</CardTitle>
          <CardDescription>Knowledge graph nodes extracted from this document</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Linked Knowledge Graph Nodes</CardTitle>
          <CardDescription>Knowledge graph nodes extracted from this document</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No knowledge graph nodes are linked to this document.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Knowledge Graph Nodes</CardTitle>
        <CardDescription>Knowledge graph nodes extracted from this document</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {nodes.map((node) => (
            <div key={node.id} className="p-3 border rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{node.entityType}</Badge>
                  <span className="font-medium">{node.label}</span>
                </div>
                <Link href={`/knowledge-graph/nodes/${node.id}`}>
                  <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </Link>
              </div>

              {node.extractionSources && node.extractionSources.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Extraction Sources:</p>
                  <div className="flex flex-wrap gap-1">
                    {node.extractionSources.map((source, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {source.source === 'job' ? (
                          <>Job #{source.jobId}</>
                        ) : (
                          <>Pipeline Execution #{source.pipelineExecutionId}</>
                        )}
                        {source.stepOrder !== undefined && ` (Step ${source.stepOrder + 1})`}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {node.data && Object.keys(node.data).length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    View data ({Object.keys(node.data).length} fields)
                  </summary>
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                    {JSON.stringify(node.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

