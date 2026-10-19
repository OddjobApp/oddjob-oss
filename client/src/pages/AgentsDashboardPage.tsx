import React, { useEffect, useState } from 'react';
import { DataTable, Column } from '@/components/ui/data-table';

// Define the type for our dashboard data
export type AgentStats = {
    agentId: string;
    totalRuns: number;
    successfulRuns: number;
    averageDurationMs: number;
};

// Define the columns for the data table
export const columns: Column<AgentStats>[] = [
    {
        accessorKey: "agentId",
        header: "Agent ID",
    },
    {
        accessorKey: "totalRuns",
        header: "Total Runs",
    },
    {
        accessorKey: "successfulRuns",
        header: "Successful Runs",
    },
    {
        key: "successRate",
        header: "Success Rate",
        cell: (row) => {
            const { totalRuns, successfulRuns } = row;
            const rate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;
            return <div>{rate.toFixed(1)}%</div>;
        },
    },
    {
        accessorKey: "averageDurationMs",
        header: "Avg. Duration",
        cell: (row) => {
            const duration = row.averageDurationMs;
            return <div>{duration ? `${(duration / 1000).toFixed(2)}s` : "N/A"}</div>;
        },
    },
];

const AgentsDashboardPage: React.FC = () => {
    const [data, setData] = useState<AgentStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/agents/dashboard')
            .then(res => {
                if (!res.ok) {
                    throw new Error('Failed to fetch agent dashboard data');
                }
                return res.json();
            })
            .then(data => {
                setData(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return <div>Loading agent dashboard...</div>;
    }

    if (error) {
        return <div style={{ color: 'red' }}>Error: {error}</div>;
    }

    return (
        <div className="container mx-auto py-10">
            <h1 className="text-3xl font-bold mb-6">Agents Dashboard</h1>
            <DataTable columns={columns} data={data} />
        </div>
    );
};

export default AgentsDashboardPage;
