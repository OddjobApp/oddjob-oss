import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ExecutionExplorer, ExecutionGroup } from '@/components/execution/ExecutionExplorer';
import { fetchCycleRunHistory } from '@/services/CycleRunHistoryService';

const CycleRunHistoryPage: React.FC = () => {
    const { runId } = useParams<{ runId: string }>();
    const [groups, setGroups] = useState<ExecutionGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<{ status?: string; stepCode?: string }>({});

    const loadHistory = useCallback(() => {
        if (runId) {
            setLoading(true);
            const id = parseInt(runId, 10);
            fetchCycleRunHistory(id, filters)
                .then(data => {
                    setGroups(data);
                })
                .catch(err => {
                    setError(err.message);
                })
                .finally(() => {
                    setLoading(false);
                });
        }
    }, [runId, filters]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const handleFilterChange = (newFilters: { status?: string; stepCode?: string }) => {
        setFilters(prev => ({ ...prev, ...newFilters }));
    };

    if (error) {
        return <div style={{ color: 'red' }}>Error: {error}</div>;
    }

    return (
        <div style={{ padding: '20px' }}>
            <ExecutionExplorer
                title={`Execution History for Run #${runId}`}
                description="A detailed log of all steps executed in this cycle run."
                groups={groups}
                isLoading={loading}
                onFilterChange={handleFilterChange}
                defaultView="timeline"
            />
        </div>
    );
};

export default CycleRunHistoryPage;
