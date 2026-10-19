import { Activity } from 'lucide-react';

export function PipelineStatusWidget() {
    // This would fetch real data from API
    const stats = {
        running: 5,
        completed: 42,
        failed: 3,
        pending: 8,
    };

    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    return (
        <div className="widget-content">
            <div className="stat-grid">
                <div className="stat-item">
                    <div className="stat-label">Running</div>
                    <div className="stat-value status-running">{stats.running}</div>
                    <div className="stat-percentage">
                        {Math.round((stats.running / total) * 100)}%
                    </div>
                </div>

                <div className="stat-item">
                    <div className="stat-label">Completed</div>
                    <div className="stat-value status-completed">{stats.completed}</div>
                    <div className="stat-percentage">
                        {Math.round((stats.completed / total) * 100)}%
                    </div>
                </div>

                <div className="stat-item">
                    <div className="stat-label">Failed</div>
                    <div className="stat-value status-failed">{stats.failed}</div>
                    <div className="stat-percentage">
                        {Math.round((stats.failed / total) * 100)}%
                    </div>
                </div>

                <div className="stat-item">
                    <div className="stat-label">Pending</div>
                    <div className="stat-value status-pending">{stats.pending}</div>
                    <div className="stat-percentage">
                        {Math.round((stats.pending / total) * 100)}%
                    </div>
                </div>
            </div>
        </div>
    );
}
