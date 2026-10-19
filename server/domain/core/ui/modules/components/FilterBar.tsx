import { Calendar, Filter, Search } from 'lucide-react';
import { useState } from 'react';

export interface DashboardFilters {
    timeRange: 'hour' | 'day' | 'week' | 'month' | 'custom';
    organizationId?: number;
    pipelineIds?: number[];
    status?: ('running' | 'completed' | 'failed' | 'pending')[];
    searchQuery?: string;
}

interface FilterBarProps {
    onFilterChange: (filters: DashboardFilters) => void;
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
    const [filters, setFilters] = useState<DashboardFilters>({
        timeRange: 'day',
    });

    const handleTimeRangeChange = (timeRange: DashboardFilters['timeRange']) => {
        const newFilters = { ...filters, timeRange };
        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    const handleSearchChange = (searchQuery: string) => {
        const newFilters = { ...filters, searchQuery };
        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    const handleStatusToggle = (status: string) => {
        const currentStatuses = filters.status || [];
        const newStatuses = currentStatuses.includes(status as any)
            ? currentStatuses.filter(s => s !== status)
            : [...currentStatuses, status as any];

        const newFilters = { ...filters, status: newStatuses };
        setFilters(newFilters);
        onFilterChange(newFilters);
    };

    return (
        <div className="filter-bar">
            {/* Search */}
            <div className="filter-search">
                <Search className="w-4 h-4 search-icon" />
                <input
                    type="text"
                    placeholder="Search pipelines..."
                    value={filters.searchQuery || ''}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="search-input"
                />
            </div>

            {/* Time Range */}
            <div className="filter-group">
                <Calendar className="w-4 h-4" />
                <select
                    value={filters.timeRange}
                    onChange={(e) => handleTimeRangeChange(e.target.value as any)}
                    className="filter-select"
                    title="Time Range"
                    aria-label="Select time range"
                >
                    <option value="hour">Last Hour</option>
                    <option value="day">Last 24 Hours</option>
                    <option value="week">Last Week</option>
                    <option value="month">Last Month</option>
                    <option value="custom">Custom Range</option>
                </select>
            </div>

            {/* Status Filters */}
            <div className="filter-group">
                <Filter className="w-4 h-4" />
                <div className="status-filters">
                    {['running', 'completed', 'failed', 'pending'].map(status => (
                        <button
                            key={status}
                            onClick={() => handleStatusToggle(status)}
                            className={`status-filter ${filters.status?.includes(status as any) ? 'active' : ''}`}
                        >
                            <span className={`status-dot status-${status}`} />
                            {status}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
