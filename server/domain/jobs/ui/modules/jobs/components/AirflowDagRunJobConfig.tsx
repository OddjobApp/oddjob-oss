/**
 * AirflowDagRunConfig
 * 
 * Configuration component for Airflow DAG Run job type.
 */

import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Switch } from '@domain-ui/core/ui/components/ui/switch';
import type { AirflowDagRunConfig } from '@shared/schema/index.js';

interface AirflowDagRunConfigProps {
    config: AirflowDagRunConfig;
    onChange: (config: AirflowDagRunConfig) => void;
}

export default function AirflowDagRunJobConfig({ config, onChange }: AirflowDagRunConfigProps) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Connection ID *</Label>
                    <Input
                        value={config.connectionId || ''}
                        onChange={(e) => onChange({ ...config, connectionId: e.target.value })}
                        placeholder="airflow_default"
                    />
                </div>
                <div className="space-y-2">
                    <Label>DAG ID *</Label>
                    <Input
                        value={config.dagId || ''}
                        onChange={(e) => onChange({ ...config, dagId: e.target.value })}
                        placeholder="my_etl_dag"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>DAG Run Configuration (JSON)</Label>
                <Textarea
                    value={JSON.stringify(config.dagRunConf || {}, null, 2)}
                    onChange={(e) => {
                        try {
                            onChange({ ...config, dagRunConf: JSON.parse(e.target.value) });
                        } catch { /* ignore */ }
                    }}
                    placeholder='{"param1": "value1"}'
                    className="font-mono min-h-[80px]"
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Timeout (seconds)</Label>
                    <Input
                        type="number"
                        value={config.timeoutSeconds || 3600}
                        onChange={(e) => onChange({ ...config, timeoutSeconds: parseInt(e.target.value) })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Poll Interval (seconds)</Label>
                    <Input
                        type="number"
                        value={config.pollIntervalSeconds || 30}
                        onChange={(e) => onChange({ ...config, pollIntervalSeconds: parseInt(e.target.value) })}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div>
                    <Label>Wait for Completion</Label>
                    <p className="text-xs text-muted-foreground">Block until the DAG run completes</p>
                </div>
                <Switch
                    checked={config.waitForCompletion !== false}
                    onCheckedChange={(checked) => onChange({ ...config, waitForCompletion: checked })}
                />
            </div>
        </div>
    );
}
