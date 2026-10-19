
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

interface PipelineStatusBadgeProps {
    status: string;
    className?: string;
}

export function PipelineStatusBadge({ status, className }: PipelineStatusBadgeProps) {
    const getStatusColor = (s: string) => {
        switch (s) {
            case 'completed': return 'bg-green-100 text-green-800 border-green-200';
            case 'failed': return 'bg-red-100 text-red-800 border-red-200';
            case 'running': return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'waiting_async': return 'bg-amber-100 text-amber-800 border-amber-200';
            case 'stopped': return 'bg-muted text-foreground border-border';
            default: return 'bg-muted text-muted-foreground border-border';
        }
    };

    return (
        <Badge variant="outline" className={`${getStatusColor(status)} ${className || ''} capitalize`}>
            {status.replace('_', ' ')}
        </Badge>
    );
}

export default PipelineStatusBadge;
