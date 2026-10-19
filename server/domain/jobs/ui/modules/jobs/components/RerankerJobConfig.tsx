/**
 * RerankerJobConfig
 * 
 * Configuration component for Reranker job type.
 */

import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import type { RerankerConfig, Credential } from '@shared/schema/index.js';

interface RerankerJobConfigProps {
    config: RerankerConfig;
    onChange: (config: RerankerConfig) => void;
    credentials: Credential[];
}

export default function RerankerJobConfig({ config, onChange, credentials }: RerankerJobConfigProps) {
    const aiCredentials = credentials.filter(c =>
        c.type === 'ai_provider' || c.type === 'openai' || c.type === 'anthropic'
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>AI Credential *</Label>
                    <Select
                        value={config.credentialId?.toString() || undefined}
                        onValueChange={(value) => onChange({ ...config, credentialId: parseInt(value) })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select credential" />
                        </SelectTrigger>
                        <SelectContent>
                            {aiCredentials.map((cred) => (
                                <SelectItem key={cred.id} value={cred.id.toString()}>
                                    {cred.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Model</Label>
                    <Input
                        value={config.model || 'BAAI/bge-reranker-v2-m3'}
                        onChange={(e) => onChange({ ...config, model: e.target.value })}
                        placeholder="BAAI/bge-reranker-v2-m3"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Query *</Label>
                <Input
                    value={config.query || ''}
                    onChange={(e) => onChange({ ...config, query: e.target.value })}
                    placeholder="{{input}} or search query"
                    className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                    The search query to rank documents against
                </p>
            </div>

            <div className="space-y-2">
                <Label>Documents Source *</Label>
                <Input
                    value={config.documents || ''}
                    onChange={(e) => onChange({ ...config, documents: e.target.value })}
                    placeholder="{{step.0.output}}"
                    className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                    Variable reference to the documents array to rerank
                </p>
            </div>

            <div className="space-y-2">
                <Label>Top K</Label>
                <Input
                    type="number"
                    value={config.topK || 5}
                    onChange={(e) => onChange({ ...config, topK: parseInt(e.target.value) })}
                    min={1}
                    max={100}
                />
                <p className="text-xs text-muted-foreground">
                    Number of top results to return after reranking
                </p>
            </div>
        </div>
    );
}
