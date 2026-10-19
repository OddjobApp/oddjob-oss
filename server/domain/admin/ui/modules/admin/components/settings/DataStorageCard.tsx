/**
 * "Data & Storage" section of the admin Settings page.
 * Log retention and execution-history limits.
 *
 * Extracted from Settings.tsx with its JSX unchanged; the identifiers it used
 * to close over are now props of the same names.
 */
import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Separator } from '@domain-ui/core/ui/components/ui/separator';
import { Database } from 'lucide-react';

interface DataStorageCardProps {
  executionHistoryLimit: string;
  logRetentionDays: string;
  setExecutionHistoryLimit: React.Dispatch<React.SetStateAction<string>>;
  setLogRetentionDays: React.Dispatch<React.SetStateAction<string>>;
}

export function DataStorageCard({
  executionHistoryLimit,
  logRetentionDays,
  setExecutionHistoryLimit,
  setLogRetentionDays,
}: DataStorageCardProps) {
  return (
    <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-primary" />
                      <CardTitle>Data & Storage</CardTitle>
                    </div>
                    <CardDescription>Manage data retention and storage policies</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="log-retention">Log Retention Period (Days)</Label>
                      <Input
                        id="log-retention"
                        type="number"
                        value={logRetentionDays}
                        onChange={(e) => setLogRetentionDays(e.target.value)}
                        min="1"
                        max="365"
                        data-testid="input-log-retention"
                      />
                      <p className="text-xs text-muted-foreground">
                        Logs older than this will be automatically deleted
                      </p>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label htmlFor="execution-history">Execution History Limit</Label>
                      <Select
                        value={executionHistoryLimit}
                        onValueChange={setExecutionHistoryLimit}
                      >
                        <SelectTrigger id="execution-history" data-testid="select-execution-history">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="500">500 executions</SelectItem>
                          <SelectItem value="1000">1,000 executions</SelectItem>
                          <SelectItem value="5000">5,000 executions</SelectItem>
                          <SelectItem value="unlimited">Unlimited</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Maximum number of execution records to retain
                      </p>
                    </div>
                  </CardContent>
                </Card>
  );
}
