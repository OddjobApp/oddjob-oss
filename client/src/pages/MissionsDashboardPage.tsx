import React, { useEffect, useState } from 'react';
import { DataTable, Column } from '@/components/ui/data-table';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Define the type for our dashboard data
export type MissionStats = {
    missionId: number;
    missionName: string;
    totalRuns: number;
    successfulRuns: number;
    averageDurationMs: number;
};

// Define the columns for the data table
export const columns: Column<MissionStats>[] = [
    {
        accessorKey: "missionName",
        header: "Mission",
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
    {
        key: "actions",
        header: "",
        cell: (row) => {
            return (
                <Button variant="outline" size="sm" asChild>
                    <a href={`/missions/${row.missionId}`}>
                        View Details <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                </Button>
            );
        },
    },
];

const MissionsDashboardPage: React.FC = () => {
    const [data, setData] = useState<MissionStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/missions/dashboard')
            .then(res => {
                if (!res.ok) {
                    throw new Error('Failed to fetch dashboard data');
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
        return <div>Loading dashboard...</div>;
    }

    if (error) {
        return <div style={{ color: 'red' }}>Error: {error}</div>;
    }

    return (
        <div className="container mx-auto py-10">
            <h1 className="text-3xl font-bold mb-6">Missions Dashboard</h1>
            <DataTable columns={columns} data={data} />
        </div>
    );
};

export default MissionsDashboardPage;
