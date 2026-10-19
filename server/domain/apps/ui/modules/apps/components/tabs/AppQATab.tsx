import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@domain-ui/core/ui/components/ui/card';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@domain-ui/core/ui/components/ui/accordion';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { AppAudit } from '@shared/schema'; // Assuming AppAudit type is exported from schema

interface AppQATabProps {
  appId: number;
}

export function AppQATab({ appId }: AppQATabProps) {
  const { data: audits, isLoading, isError } = useQuery<AppAudit[]>({ // Assuming AppAudit is the correct type
    queryKey: ['/api/apps', appId, 'audits'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/apps/${appId}/audits`);
      return res.json();
    },
    enabled: !!appId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !audits) {
    return <p className="text-destructive">Failed to load QA audit results.</p>;
  }

  if (audits.length === 0) {
    return <p className="text-muted-foreground">No QA audit results found for this application.</p>;
  }

  return (
    <div className="space-y-6">
      {audits.map((audit) => (
        <Card key={audit.id} className={audit.success ? 'border-green-500/30' : 'border-red-500/30'}>
          <CardHeader>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {audit.success ? (
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                    ) : (
                        <XCircle className="w-6 h-6 text-red-500" />
                    )}
                    <CardTitle>{audit.summary}</CardTitle>
                </div>
                <Badge variant={audit.success ? 'default' : 'destructive'}>
                    {audit.success ? 'Passed' : 'Failed'}
                </Badge>
            </div>
            <CardDescription className="pt-2">
              Audit performed at {new Date(audit.createdAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible>
              <AccordionItem value="output">
                <AccordionTrigger>View Full Log</AccordionTrigger>
                <AccordionContent>
                  <pre className="bg-background text-foreground/80 text-xs rounded-lg p-4 h-[400px] overflow-y-auto font-mono whitespace-pre-wrap">
                    {audit.output}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
