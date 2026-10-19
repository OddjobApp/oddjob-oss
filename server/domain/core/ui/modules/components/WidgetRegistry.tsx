import {
    Activity,
    BarChart3,
    DollarSign,
    GitBranch,
    TrendingUp,
    Clock,
    AlertCircle,
    CheckCircle
} from 'lucide-react';
import { Widget } from '../types/index.js';
import { PipelineStatusWidget } from './widgets/PipelineStatusWidget.js';
import { RecentExecutionsWidget } from './widgets/RecentExecutionsWidget.js';
import { CostSummaryWidget } from './widgets/CostSummaryWidget.js';
import { AgentPerformanceWidget } from './widgets/AgentPerformanceWidget.js';
import { KnowledgeGraphStatsWidget } from './widgets/KnowledgeGraphStatsWidget.js';
import { ExecutionTimelineWidget } from './widgets/ExecutionTimelineWidget.js';
import { FailureRateWidget } from './widgets/FailureRateWidget.js';
import { SuccessRateWidget } from './widgets/SuccessRateWidget.js';

export const AVAILABLE_WIDGETS: Record<string, Widget> = {
    'pipeline-status': {
        id: 'pipeline-status',
        name: 'Pipeline Status',
        description: 'Overview of pipeline execution statuses',
        icon: Activity,
        component: PipelineStatusWidget,
        defaultSize: { width: 2, height: 1 },
        minSize: { width: 1, height: 1 },
    },

    'recent-executions': {
        id: 'recent-executions',
        name: 'Recent Executions',
        description: 'Latest pipeline executions',
        icon: Clock,
        component: RecentExecutionsWidget,
        defaultSize: { width: 2, height: 2 },
        minSize: { width: 2, height: 1 },
    },

    'cost-summary': {
        id: 'cost-summary',
        name: 'Cost Summary',
        description: 'AI API cost tracking',
        icon: DollarSign,
        component: CostSummaryWidget,
        defaultSize: { width: 1, height: 1 },
        configurable: true,
    },

    'agent-performance': {
        id: 'agent-performance',
        name: 'Agent Performance',
        description: 'AI agent success metrics',
        icon: TrendingUp,
        component: AgentPerformanceWidget,
        defaultSize: { width: 2, height: 2 },
        minSize: { width: 2, height: 1 },
    },

    'knowledge-graph-stats': {
        id: 'knowledge-graph-stats',
        name: 'Knowledge Graph',
        description: 'Graph statistics and growth',
        icon: GitBranch,
        component: KnowledgeGraphStatsWidget,
        defaultSize: { width: 1, height: 1 },
    },

    'execution-timeline': {
        id: 'execution-timeline',
        name: 'Execution Timeline',
        description: 'Timeline of executions over time',
        icon: BarChart3,
        component: ExecutionTimelineWidget,
        defaultSize: { width: 3, height: 2 },
        minSize: { width: 2, height: 1 },
    },

    'failure-rate': {
        id: 'failure-rate',
        name: 'Failure Rate',
        description: 'Pipeline failure statistics',
        icon: AlertCircle,
        component: FailureRateWidget,
        defaultSize: { width: 1, height: 1 },
    },

    'success-rate': {
        id: 'success-rate',
        name: 'Success Rate',
        description: 'Pipeline success statistics',
        icon: CheckCircle,
        component: SuccessRateWidget,
        defaultSize: { width: 1, height: 1 },
    },
};

export const DEFAULT_LAYOUT_WIDGETS = [
    'pipeline-status',
    'recent-executions',
    'cost-summary',
    'agent-performance',
];
