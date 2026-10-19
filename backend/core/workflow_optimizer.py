"""
Workflow Optimizer
Automated workflow improvement system with self-improving algorithms
"""

import asyncio
from typing import Dict, List, Any, Optional, Tuple, Union, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import statistics
import networkx as nx
from collections import defaultdict, Counter

from core.service_base import BaseService, ServiceConfig
from core.structured_logging import get_structured_logger
from core.predictive_analytics import predictive_engine, PredictionResult, PredictionType
from core.memory_store import memory_store, MemoryEntry, MemoryType, MemoryQuery

logger = get_structured_logger("workflow_optimizer")


class WorkflowOptimizationStrategy(Enum):
    """Strategies for workflow optimization."""
    EFFICIENCY_MAXIMIZATION = "efficiency_maximization"
    COST_MINIMIZATION = "cost_minimization"
    QUALITY_IMPROVEMENT = "quality_improvement"
    TIME_OPTIMIZATION = "time_optimization"
    RESOURCE_OPTIMIZATION = "resource_optimization"


class WorkflowPattern(Enum):
    """Common workflow patterns that can be optimized."""
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    CONDITIONAL = "conditional"
    LOOP = "loop"
    BRANCHING = "branching"
    EVENT_DRIVEN = "event_driven"


@dataclass
class WorkflowStep:
    """A step in a workflow."""
    step_id: str
    name: str
    step_type: str
    execution_time: Optional[float] = None  # Average execution time in seconds
    success_rate: float = 1.0  # Success rate (0-1)
    resource_usage: Dict[str, float] = field(default_factory=dict)  # Resource usage metrics
    dependencies: List[str] = field(default_factory=list)  # Step IDs this depends on
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "step_id": self.step_id,
            "name": self.name,
            "step_type": self.step_type,
            "execution_time": self.execution_time,
            "success_rate": self.success_rate,
            "resource_usage": self.resource_usage,
            "dependencies": self.dependencies,
            "metadata": self.metadata
        }


@dataclass
class WorkflowMetrics:
    """Metrics for workflow performance."""
    workflow_id: str
    total_executions: int = 0
    average_execution_time: float = 0.0
    success_rate: float = 1.0
    average_resource_usage: Dict[str, float] = field(default_factory=dict)
    bottleneck_steps: List[str] = field(default_factory=list)
    error_patterns: Dict[str, int] = field(default_factory=dict)
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "workflow_id": self.workflow_id,
            "total_executions": self.total_executions,
            "average_execution_time": self.average_execution_time,
            "success_rate": self.success_rate,
            "average_resource_usage": self.average_resource_usage,
            "bottleneck_steps": self.bottleneck_steps,
            "error_patterns": self.error_patterns,
            "last_updated": self.last_updated.isoformat()
        }


@dataclass
class WorkflowOptimization:
    """A workflow optimization recommendation."""
    workflow_id: str
    optimization_type: WorkflowOptimizationStrategy
    priority: str  # "high", "medium", "low"
    confidence: float  # 0-1
    current_metrics: WorkflowMetrics
    proposed_changes: List[Dict[str, Any]]
    expected_improvements: Dict[str, float]
    implementation_complexity: str  # "low", "medium", "high"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "workflow_id": self.workflow_id,
            "optimization_type": self.optimization_type.value,
            "priority": self.priority,
            "confidence": self.confidence,
            "current_metrics": self.current_metrics.to_dict(),
            "proposed_changes": self.proposed_changes,
            "expected_improvements": self.expected_improvements,
            "implementation_complexity": self.implementation_complexity,
            "timestamp": self.timestamp.isoformat()
        }


class WorkflowOptimizer(BaseService):
    """Automated workflow improvement system with self-improving algorithms."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.logger = get_structured_logger("workflow_optimizer")

        # Workflow data
        self.workflow_definitions: Dict[str, List[WorkflowStep]] = {}
        self.workflow_metrics: Dict[str, WorkflowMetrics] = {}
        self.optimization_history: Dict[str, List[WorkflowOptimization]] = {}

        # Learning parameters
        self.min_executions_for_analysis = 10
        self.performance_window = timedelta(days=30)  # Analysis window
        self.optimization_interval = timedelta(hours=24)  # How often to optimize

        # Optimization thresholds
        self.bottleneck_threshold = 0.8  # 80% of total execution time
        self.efficiency_threshold = 0.7  # Minimum acceptable efficiency
        self.error_rate_threshold = 0.1  # Maximum acceptable error rate

        # Self-improvement tracking
        self.optimization_effectiveness: Dict[str, List[float]] = defaultdict(list)

    async def _perform_health_check(self) -> None:
        """Perform health check."""
        # Check if we have workflow data
        total_workflows = len(self.workflow_definitions)
        if total_workflows == 0:
            self.logger.warning("No workflow definitions loaded")

    async def register_workflow(self, workflow_id: str, steps: List[WorkflowStep]) -> None:
        """Register a workflow definition for optimization."""
        self.workflow_definitions[workflow_id] = steps
        self.workflow_metrics[workflow_id] = WorkflowMetrics(workflow_id=workflow_id)

        # Analyze workflow structure
        await self._analyze_workflow_structure(workflow_id)

        self.logger.info(f"Registered workflow {workflow_id} with {len(steps)} steps")

    async def record_workflow_execution(
        self,
        workflow_id: str,
        execution_time: float,
        success: bool,
        step_metrics: Optional[Dict[str, Dict[str, Any]]] = None,
        error_details: Optional[Dict[str, Any]] = None
    ) -> None:
        """Record a workflow execution for analysis."""
        if workflow_id not in self.workflow_metrics:
            self.workflow_metrics[workflow_id] = WorkflowMetrics(workflow_id=workflow_id)

        metrics = self.workflow_metrics[workflow_id]

        # Update execution counts
        metrics.total_executions += 1
        metrics.last_updated = datetime.now(timezone.utc)

        # Update execution time (moving average)
        if metrics.average_execution_time == 0:
            metrics.average_execution_time = execution_time
        else:
            metrics.average_execution_time = (
                metrics.average_execution_time * 0.9 + execution_time * 0.1
            )

        # Update success rate
        success_value = 1.0 if success else 0.0
        if metrics.total_executions == 1:
            metrics.success_rate = success_value
        else:
            metrics.success_rate = (
                metrics.success_rate * (metrics.total_executions - 1) + success_value
            ) / metrics.total_executions

        # Update step-specific metrics
        if step_metrics:
            await self._update_step_metrics(workflow_id, step_metrics)

        # Record error patterns
        if not success and error_details:
            await self._record_error_pattern(workflow_id, error_details)

        # Store execution data for predictive analytics
        await self._record_execution_observation(workflow_id, execution_time, success, step_metrics)

        # Check if optimization is needed
        if metrics.total_executions % 10 == 0:  # Every 10 executions
            await self._check_optimization_needed(workflow_id)

    async def _update_step_metrics(self, workflow_id: str, step_metrics: Dict[str, Dict[str, Any]]) -> None:
        """Update metrics for individual workflow steps."""
        metrics = self.workflow_metrics[workflow_id]

        for step_id, step_data in step_metrics.items():
            execution_time = step_data.get("execution_time")
            success = step_data.get("success", True)
            resource_usage = step_data.get("resource_usage", {})

            # Find the step definition
            steps = self.workflow_definitions.get(workflow_id, [])
            step_def = next((s for s in steps if s.step_id == step_id), None)

            if step_def:
                # Update execution time (moving average)
                if execution_time is not None:
                    if step_def.execution_time is None:
                        step_def.execution_time = execution_time
                    else:
                        step_def.execution_time = step_def.execution_time * 0.9 + execution_time * 0.1

                # Update success rate
                success_value = 1.0 if success else 0.0
                step_def.success_rate = step_def.success_rate * 0.95 + success_value * 0.05

                # Update resource usage
                for resource, usage in resource_usage.items():
                    if resource not in step_def.resource_usage:
                        step_def.resource_usage[resource] = usage
                    else:
                        step_def.resource_usage[resource] = (
                            step_def.resource_usage[resource] * 0.9 + usage * 0.1
                        )

        # Identify bottlenecks
        metrics.bottleneck_steps = await self._identify_bottlenecks(workflow_id)

    async def _record_error_pattern(self, workflow_id: str, error_details: Dict[str, Any]) -> None:
        """Record error patterns for analysis."""
        metrics = self.workflow_metrics[workflow_id]

        # Categorize error
        error_type = error_details.get("error_type", "unknown")
        error_step = error_details.get("step_id", "unknown")

        error_key = f"{error_step}:{error_type}"
        metrics.error_patterns[error_key] = metrics.error_patterns.get(error_key, 0) + 1

    async def _record_execution_observation(
        self,
        workflow_id: str,
        execution_time: float,
        success: bool,
        step_metrics: Optional[Dict[str, Dict[str, Any]]]
    ) -> None:
        """Record execution observation for predictive analytics."""
        try:
            await predictive_engine.record_observation(
                entity=f"workflow:{workflow_id}",
                value=execution_time,
                context={
                    "success": success,
                    "step_metrics": step_metrics or {}
                },
                metadata={
                    "workflow_id": workflow_id,
                    "total_steps": len(self.workflow_definitions.get(workflow_id, []))
                }
            )
        except Exception as e:
            self.logger.warning(f"Failed to record workflow execution observation: {e}")

    async def _check_optimization_needed(self, workflow_id: str) -> None:
        """Check if workflow optimization is needed."""
        metrics = self.workflow_metrics[workflow_id]

        # Check various optimization triggers
        needs_optimization = (
            metrics.success_rate < (1.0 - self.error_rate_threshold) or
            len(metrics.bottleneck_steps) > 0 or
            metrics.average_execution_time > self._calculate_optimal_execution_time(workflow_id)
        )

        if needs_optimization:
            await self.optimize_workflow(workflow_id)

    def _calculate_optimal_execution_time(self, workflow_id: str) -> float:
        """Calculate optimal execution time based on step benchmarks."""
        steps = self.workflow_definitions.get(workflow_id, [])
        if not steps:
            return float('inf')

        # Estimate optimal time as 80% of sum of individual step times
        total_step_time = sum(step.execution_time or 10 for step in steps)  # Default 10s per step
        return total_step_time * 0.8  # Allow for 20% parallelization/optimization

    async def optimize_workflow(
        self,
        workflow_id: str,
        strategy: Optional[WorkflowOptimizationStrategy] = None
    ) -> Optional[WorkflowOptimization]:
        """Optimize a workflow using self-improving algorithms."""
        if workflow_id not in self.workflow_definitions:
            return None

        metrics = self.workflow_metrics.get(workflow_id)
        if not metrics or metrics.total_executions < self.min_executions_for_analysis:
            return None

        # Determine optimization strategy
        if strategy is None:
            strategy = self._select_optimization_strategy(workflow_id, metrics)

        # Generate optimization recommendations
        optimization = await self._generate_optimization(workflow_id, strategy, metrics)

        if optimization:
            # Store optimization
            if workflow_id not in self.optimization_history:
                self.optimization_history[workflow_id] = []
            self.optimization_history[workflow_id].append(optimization)

            self.logger.info(f"Generated optimization for workflow {workflow_id}: {strategy.value}")

        return optimization

    def _select_optimization_strategy(
        self,
        workflow_id: str,
        metrics: WorkflowMetrics
    ) -> WorkflowOptimizationStrategy:
        """Select the best optimization strategy based on workflow characteristics."""
        # Analyze workflow issues
        has_bottlenecks = len(metrics.bottleneck_steps) > 0
        low_efficiency = metrics.success_rate < self.efficiency_threshold
        high_execution_time = metrics.average_execution_time > self._calculate_optimal_execution_time(workflow_id)

        # Select strategy based on issues
        if low_efficiency:
            return WorkflowOptimizationStrategy.QUALITY_IMPROVEMENT
        elif has_bottlenecks:
            return WorkflowOptimizationStrategy.EFFICIENCY_MAXIMIZATION
        elif high_execution_time:
            return WorkflowOptimizationStrategy.TIME_OPTIMIZATION
        else:
            return WorkflowOptimizationStrategy.RESOURCE_OPTIMIZATION

    async def _generate_optimization(
        self,
        workflow_id: str,
        strategy: WorkflowOptimizationStrategy,
        metrics: WorkflowMetrics
    ) -> WorkflowOptimization:
        """Generate workflow optimization recommendations."""
        proposed_changes = []
        expected_improvements = {}

        if strategy == WorkflowOptimizationStrategy.EFFICIENCY_MAXIMIZATION:
            proposed_changes, expected_improvements = await self._optimize_efficiency(workflow_id, metrics)
        elif strategy == WorkflowOptimizationStrategy.QUALITY_IMPROVEMENT:
            proposed_changes, expected_improvements = await self._optimize_quality(workflow_id, metrics)
        elif strategy == WorkflowOptimizationStrategy.TIME_OPTIMIZATION:
            proposed_changes, expected_improvements = await self._optimize_timing(workflow_id, metrics)
        elif strategy == WorkflowOptimizationStrategy.COST_MINIMIZATION:
            proposed_changes, expected_improvements = await self._optimize_cost(workflow_id, metrics)
        elif strategy == WorkflowOptimizationStrategy.RESOURCE_OPTIMIZATION:
            proposed_changes, expected_improvements = await self._optimize_resources(workflow_id, metrics)

        # Calculate confidence and priority
        confidence = self._calculate_optimization_confidence(workflow_id, proposed_changes)
        priority = self._calculate_optimization_priority(metrics, expected_improvements)

        return WorkflowOptimization(
            workflow_id=workflow_id,
            optimization_type=strategy,
            priority=priority,
            confidence=confidence,
            current_metrics=metrics,
            proposed_changes=proposed_changes,
            expected_improvements=expected_improvements,
            implementation_complexity=self._estimate_complexity(proposed_changes)
        )

    async def _optimize_efficiency(self, workflow_id: str, metrics: WorkflowMetrics) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """Optimize workflow efficiency by identifying and fixing bottlenecks."""
        changes = []
        improvements = {}

        # Identify bottleneck steps
        bottleneck_steps = await self._identify_bottlenecks(workflow_id)

        for step_id in bottleneck_steps:
            step = next((s for s in self.workflow_definitions[workflow_id] if s.step_id == step_id), None)
            if step and step.execution_time:
                # Suggest parallelization or optimization
                changes.append({
                    "type": "parallelize_step",
                    "step_id": step_id,
                    "reason": f"Step {step_id} is a bottleneck consuming {step.execution_time:.2f}s",
                    "suggestion": "Consider running this step in parallel or optimizing the implementation"
                })

                # Estimate improvement
                bottleneck_contribution = step.execution_time / metrics.average_execution_time
                improvements["execution_time"] = improvements.get("execution_time", 0) + bottleneck_contribution * 0.3

        # Check for sequential dependencies that could be parallelized
        parallel_opportunities = await self._find_parallelization_opportunities(workflow_id)
        for opportunity in parallel_opportunities:
            changes.append(opportunity)
            improvements["execution_time"] = improvements.get("execution_time", 0) + 0.1

        return changes, improvements

    async def _optimize_quality(self, workflow_id: str, metrics: WorkflowMetrics) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """Optimize workflow quality by reducing errors."""
        changes = []
        improvements = {}

        # Analyze error patterns
        error_patterns = metrics.error_patterns
        if error_patterns:
            most_common_error = max(error_patterns.items(), key=lambda x: x[1])

            changes.append({
                "type": "error_handling",
                "error_pattern": most_common_error[0],
                "occurrences": most_common_error[1],
                "suggestion": "Add retry logic and better error handling for this error pattern"
            })

            # Estimate improvement in success rate
            error_rate = most_common_error[1] / metrics.total_executions
            improvements["success_rate"] = min(0.2, error_rate * 0.5)  # Up to 20% improvement

        # Check for steps with low success rates
        steps = self.workflow_definitions.get(workflow_id, [])
        for step in steps:
            if step.success_rate < 0.9:  # Less than 90% success rate
                changes.append({
                    "type": "step_improvement",
                    "step_id": step.step_id,
                    "current_success_rate": step.success_rate,
                    "suggestion": "Improve error handling and validation for this step"
                })

                improvements["success_rate"] = improvements.get("success_rate", 0) + 0.05

        return changes, improvements

    async def _optimize_timing(self, workflow_id: str, metrics: WorkflowMetrics) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """Optimize workflow timing."""
        changes = []
        improvements = {}

        # Analyze step execution times
        steps = self.workflow_definitions.get(workflow_id, [])
        slow_steps = [s for s in steps if s.execution_time and s.execution_time > 30]  # Steps taking >30s

        for step in slow_steps:
            changes.append({
                "type": "performance_optimization",
                "step_id": step.step_id,
                "current_time": step.execution_time,
                "suggestion": "Optimize this step's performance or consider caching results"
            })

            # Estimate timing improvement
            step_contribution = step.execution_time / metrics.average_execution_time
            improvements["execution_time"] = improvements.get("execution_time", 0) + step_contribution * 0.4

        return changes, improvements

    async def _optimize_cost(self, workflow_id: str, metrics: WorkflowMetrics) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """Optimize workflow cost."""
        changes = []
        improvements = {}

        # Analyze resource usage
        steps = self.workflow_definitions.get(workflow_id, [])
        high_cost_steps = []

        for step in steps:
            total_resource_usage = sum(step.resource_usage.values())
            if total_resource_usage > 100:  # Arbitrary threshold
                high_cost_steps.append(step)

        for step in high_cost_steps:
            changes.append({
                "type": "resource_optimization",
                "step_id": step.step_id,
                "resource_usage": step.resource_usage,
                "suggestion": "Optimize resource usage or consider cheaper alternatives"
            })

            improvements["cost"] = improvements.get("cost", 0) + 0.15  # 15% cost reduction estimate

        return changes, improvements

    async def _optimize_resources(self, workflow_id: str, metrics: WorkflowMetrics) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """Optimize resource utilization."""
        changes = []
        improvements = {}

        # Check for resource contention
        steps = self.workflow_definitions.get(workflow_id, [])
        resource_usage_patterns = defaultdict(list)

        for step in steps:
            for resource, usage in step.resource_usage.items():
                resource_usage_patterns[resource].append((step.step_id, usage))

        # Identify resource bottlenecks
        for resource, usages in resource_usage_patterns.items():
            total_usage = sum(usage for _, usage in usages)
            if total_usage > 200:  # Arbitrary threshold
                changes.append({
                    "type": "resource_balancing",
                    "resource": resource,
                    "total_usage": total_usage,
                    "suggestion": "Balance resource usage across steps or add resource limits"
                })

                improvements["resource_efficiency"] = improvements.get("resource_efficiency", 0) + 0.1

        return changes, improvements

    async def _identify_bottlenecks(self, workflow_id: str) -> List[str]:
        """Identify bottleneck steps in a workflow."""
        steps = self.workflow_definitions.get(workflow_id, [])
        if not steps:
            return []

        bottlenecks = []
        total_time = sum(step.execution_time or 0 for step in steps)

        if total_time == 0:
            return []

        for step in steps:
            if step.execution_time and step.execution_time / total_time > self.bottleneck_threshold:
                bottlenecks.append(step.step_id)

        return bottlenecks

    async def _find_parallelization_opportunities(self, workflow_id: str) -> List[Dict[str, Any]]:
        """Find opportunities for parallel execution."""
        opportunities = []
        steps = self.workflow_definitions.get(workflow_id, [])

        # Build dependency graph
        graph = nx.DiGraph()
        for step in steps:
            graph.add_node(step.step_id)
            for dep in step.dependencies:
                graph.add_edge(dep, step.step_id)

        # Find independent steps that could run in parallel
        try:
            # Get nodes with no incoming edges (starting points)
            starts = [node for node in graph.nodes() if graph.in_degree(node) == 0]

            # For each level in the topological sort, check if there are multiple independent steps
            levels = {}
            for node in nx.topological_sort(graph):
                predecessors = list(graph.predecessors(node))
                if predecessors:
                    level = max(levels.get(pred, 0) for pred in predecessors) + 1
                else:
                    level = 0
                levels[node] = level

            # Group by level
            level_groups = defaultdict(list)
            for node, level in levels.items():
                level_groups[level].append(node)

            # Check for levels with multiple steps
            for level, nodes in level_groups.items():
                if len(nodes) > 1:
                    opportunities.append({
                        "type": "parallel_execution",
                        "steps": nodes,
                        "level": level,
                        "suggestion": f"Steps {nodes} can be executed in parallel"
                    })

        except nx.NetworkXError:
            # Graph has cycles or other issues
            pass

        return opportunities

    def _calculate_optimization_confidence(self, workflow_id: str, changes: List[Dict[str, Any]]) -> float:
        """Calculate confidence in optimization recommendations."""
        if not changes:
            return 0.0

        # Base confidence on amount of historical data
        metrics = self.workflow_metrics.get(workflow_id)
        data_confidence = min(1.0, metrics.total_executions / 100) if metrics else 0.0

        # Confidence based on number and type of changes
        change_confidence = min(1.0, len(changes) / 10)

        return (data_confidence + change_confidence) / 2

    def _calculate_optimization_priority(self, metrics: WorkflowMetrics, improvements: Dict[str, float]) -> str:
        """Calculate priority of optimization."""
        # High priority if success rate is very low or there are significant improvements possible
        if metrics.success_rate < 0.5:
            return "high"
        elif any(improvement > 0.3 for improvement in improvements.values()):
            return "high"
        elif metrics.success_rate < 0.8 or any(improvement > 0.1 for improvement in improvements.values()):
            return "medium"
        else:
            return "low"

    def _estimate_complexity(self, changes: List[Dict[str, Any]]) -> str:
        """Estimate implementation complexity of changes."""
        if not changes:
            return "low"

        # Count different types of changes
        change_types = Counter(change["type"] for change in changes)

        # Complex changes
        complex_changes = change_types.get("parallel_execution", 0) + change_types.get("resource_balancing", 0)

        if complex_changes > 2:
            return "high"
        elif complex_changes > 0 or len(changes) > 5:
            return "medium"
        else:
            return "low"

    async def _analyze_workflow_structure(self, workflow_id: str) -> None:
        """Analyze the structure of a workflow."""
        steps = self.workflow_definitions.get(workflow_id, [])

        # Classify workflow pattern
        pattern = self._classify_workflow_pattern(steps)

        # Store analysis in memory
        await memory_store.store_memory(
            content=f"Workflow {workflow_id} analysis: {pattern.value} pattern with {len(steps)} steps",
            memory_type=MemoryType.SUCCESS,
            context={
                "workflow_id": workflow_id,
                "pattern": pattern.value,
                "step_count": len(steps),
                "steps": [step.step_id for step in steps]
            },
            source="workflow_optimizer"
        )

    def _classify_workflow_pattern(self, steps: List[WorkflowStep]) -> WorkflowPattern:
        """Classify the workflow pattern."""
        if not steps:
            return WorkflowPattern.SEQUENTIAL

        # Check for parallel execution opportunities
        has_parallel = any(len(step.dependencies) == 0 for step in steps if steps.index(step) > 0)

        # Check for loops (steps that depend on later steps - indicating cycles)
        has_cycles = False
        step_ids = {step.step_id for step in steps}
        for step in steps:
            if any(dep not in step_ids for dep in step.dependencies):
                has_cycles = True
                break

        # Check for conditional logic (steps with branching metadata)
        has_conditionals = any(
            step.metadata.get("conditional", False) or
            step.metadata.get("branches", [])
            for step in steps
        )

        if has_cycles:
            return WorkflowPattern.LOOP
        elif has_conditionals:
            return WorkflowPattern.CONDITIONAL
        elif has_parallel:
            return WorkflowPattern.PARALLEL
        else:
            return WorkflowPattern.SEQUENTIAL

    def get_workflow_metrics(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get metrics for a workflow."""
        metrics = self.workflow_metrics.get(workflow_id)
        return metrics.to_dict() if metrics else None

    def get_workflow_optimizations(self, workflow_id: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Get optimization history for a workflow."""
        optimizations = self.optimization_history.get(workflow_id, [])
        return [opt.to_dict() for opt in optimizations[-limit:]]

    def get_optimization_effectiveness(self) -> Dict[str, Dict[str, Any]]:
        """Get effectiveness metrics for optimizations."""
        effectiveness = {}

        for workflow_id, optimizations in self.optimization_history.items():
            if optimizations:
                # Calculate average confidence and success rate
                avg_confidence = statistics.mean(opt.confidence for opt in optimizations)
                recent_optimizations = optimizations[-5:]  # Last 5 optimizations
                avg_recent_confidence = statistics.mean(opt.confidence for opt in recent_optimizations)

                effectiveness[workflow_id] = {
                    "total_optimizations": len(optimizations),
                    "average_confidence": avg_confidence,
                    "recent_confidence": avg_recent_confidence,
                    "improvement_trend": "improving" if avg_recent_confidence > avg_confidence else "stable"
                }

        return effectiveness

    async def apply_optimization(self, workflow_id: str, optimization: WorkflowOptimization) -> bool:
        """Apply a workflow optimization (placeholder for actual implementation)."""
        # In a real implementation, this would modify the workflow definition
        # and update the workflow orchestration system

        self.logger.info(f"Applying optimization for workflow {workflow_id}: {len(optimization.proposed_changes)} changes")

        # Track optimization effectiveness (would be measured after application)
        self.optimization_effectiveness[workflow_id].append(optimization.confidence)

        return True

    async def initialize(self) -> None:
        """Initialize the workflow optimizer."""
        self.logger.info("Workflow optimizer initialized")

    async def shutdown(self) -> None:
        """Shutdown the workflow optimizer."""
        self.logger.info("Workflow optimizer shutdown")


# Global workflow optimizer instance
workflow_optimizer = WorkflowOptimizer(
    ServiceConfig(name="workflow_optimizer", enabled=True)
)