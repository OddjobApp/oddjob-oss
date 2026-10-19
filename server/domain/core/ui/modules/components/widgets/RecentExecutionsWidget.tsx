import { Clock, CheckCircle, XCircle } from 'lucide-react';

export function RecentExecutionsWidget() {
    // This would fetch real data from API
    const executions = [
        { id: 1, pipeline: 'Data Sync', status: 'completed', duration: '2m 34s', time: '5 min ago' },
        { id: 2, pipeline: 'AI Analysis', status: 'running', duration: '1m 12s', time: '10 min ago' },
        { id: 3, pipeline: 'Report Generation', status: 'failed', duration: '45s', time: '15 min ago' },
        { id: 4, pipeline: 'Email Notification', status: 'completed', duration: '12s', time: '20 min ago' },
    ];

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed':
                return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'failed':
                return <XCircle className="w-4 h-4 text-red-500" />;
            case 'running':
                return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
            default:
                return <Clock className="w-4 h-4" />;
        }
    };

    return (
        <div className="widget-content">
            <div className="recent-executions-list">
                {executions.map(exec => (
                    <div key={exec.id} className="execution-item">
                        <div className="execution-status">
                            {getStatusIcon(exec.status)}
                        </div>
                        <div className="execution-info">
                            <div className="execution-name">{exec.pipeline}</div>
                            <div className="execution-meta">
                                <span>{exec.duration}</span>
                                <span className="separator">•</span>
                                <span>{exec.time}</span>
                            </div>
                        </div>
                        <div className={`status-badge status-${exec.status}`}>
                            {exec.status}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
