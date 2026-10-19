"""
Resource Optimizer
Intelligent resource allocation and predictive scaling based on usage patterns
"""

import asyncio
import psutil
import threading
from typing import Dict, List, Any, Optional, Tuple, Union
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import statistics
import math

from core.service_base import BaseService, ServiceConfig
from core.structured_logging import get_structured_logger
from core.predictive_analytics import predictive_engine, PredictionResult, PredictionType

logger = get_structured_logger("resource_optimizer")


class ResourceType(Enum):
    """Types of resources that can be optimized."""
    CPU = "cpu"
    MEMORY = "memory"
    DISK = "disk"
    NETWORK = "network"
    DATABASE_CONNECTIONS = "database_connections"
    THREAD_POOL = "thread_pool"
    CACHE_SIZE = "cache_size"


class ScalingStrategy(Enum):
    """Strategies for scaling resources."""
    PREDICTIVE = "predictive"      # Scale based on predictions
    REACTIVE = "reactive"          # Scale based on current usage
    SCHEDULED = "scheduled"        # Scale based on time patterns
    HYBRID = "hybrid"             # Combination of strategies


class ResourceThreshold:
    """Threshold configuration for resource scaling."""

    def __init__(
        self,
        warning_threshold: float,
        critical_threshold: float,
        scale_up_threshold: float,
        scale_down_threshold: float,
        min_capacity: Union[int, float],
        max_capacity: Union[int, float]
    ):
        self.warning_threshold = warning_threshold      # Warning level (e.g., 70%)
        self.critical_threshold = critical_threshold    # Critical level (e.g., 85%)
        self.scale_up_threshold = scale_up_threshold    # When to scale up (e.g., 80%)
        self.scale_down_threshold = scale_down_threshold # When to scale down (e.g., 30%)
        self.min_capacity = min_capacity               # Minimum capacity
        self.max_capacity = max_capacity               # Maximum capacity

    def should_scale_up(self, current_usage: float) -> bool:
        """Check if resource should scale up."""
        return current_usage >= self.scale_up_threshold

    def should_scale_down(self, current_usage: float) -> bool:
        """Check if resource should scale down."""
        return current_usage <= self.scale_down_threshold

    def is_critical(self, current_usage: float) -> bool:
        """Check if usage is at critical level."""
        return current_usage >= self.critical_threshold

    def is_warning(self, current_usage: float) -> bool:
        """Check if usage is at warning level."""
        return current_usage >= self.warning_threshold


@dataclass
class ResourceMetrics:
    """Current resource usage metrics."""
    resource_type: ResourceType
    current_usage: float  # Percentage (0-100)
    absolute_usage: Union[int, float]  # Absolute value
    capacity: Union[int, float]  # Total capacity
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Additional metrics
    utilization_trend: float = 0.0  # Trend direction (-1 to 1)
    prediction_confidence: float = 0.0  # Confidence in predictions
    recommended_capacity: Optional[Union[int, float]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "resource_type": self.resource_type.value,
            "current_usage": self.current_usage,
            "absolute_usage": self.absolute_usage,
            "capacity": self.capacity,
            "timestamp": self.timestamp.isoformat(),
            "utilization_trend": self.utilization_trend,
            "prediction_confidence": self.prediction_confidence,
            "recommended_capacity": self.recommended_capacity
        }


@dataclass
class ScalingRecommendation:
    """Recommendation for resource scaling."""
    resource_type: ResourceType
    action: str  # "scale_up", "scale_down", "maintain"
    current_capacity: Union[int, float]
    recommended_capacity: Union[int, float]
    confidence: float
    reasoning: List[str]
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Cost and performance impact
    cost_impact: Optional[float] = None  # Cost change in currency units
    performance_impact: Optional[float] = None  # Performance impact (-1 to 1)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "resource_type": self.resource_type.value,
            "action": self.action,
            "current_capacity": self.current_capacity,
            "recommended_capacity": self.recommended_capacity,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "timestamp": self.timestamp.isoformat(),
            "cost_impact": self.cost_impact,
            "performance_impact": self.performance_impact
        }


class ResourceOptimizer(BaseService):
    """Intelligent resource optimization and predictive scaling."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.logger = get_structured_logger("resource_optimizer")

        # Resource thresholds (default configurations)
        self.thresholds = {
            ResourceType.CPU: ResourceThreshold(
                warning_threshold=70.0,
                critical_threshold=85.0,
                scale_up_threshold=80.0,
                scale_down_threshold=30.0,
                min_capacity=1,  # Minimum CPU cores
                max_capacity=psutil.cpu_count() * 2  # Max cores (allowing oversubscription)
            ),
            ResourceType.MEMORY: ResourceThreshold(
                warning_threshold=75.0,
                critical_threshold=90.0,
                scale_up_threshold=85.0,
                scale_down_threshold=40.0,
                min_capacity=512,  # Minimum MB
                max_capacity=psutil.virtual_memory().total // (1024 * 1024)  # Max MB
            ),
            ResourceType.DISK: ResourceThreshold(
                warning_threshold=80.0,
                critical_threshold=95.0,
                scale_up_threshold=90.0,
                scale_down_threshold=50.0,
                min_capacity=1024,  # Minimum MB
                max_capacity=100 * 1024,  # Max MB (100GB)
            ),
            ResourceType.DATABASE_CONNECTIONS: ResourceThreshold(
                warning_threshold=60.0,
                critical_threshold=80.0,
                scale_up_threshold=70.0,
                scale_down_threshold=25.0,
                min_capacity=5,
                max_capacity=1000
            ),
            ResourceType.THREAD_POOL: ResourceThreshold(
                warning_threshold=70.0,
                critical_threshold=85.0,
                scale_up_threshold=80.0,
                scale_down_threshold=30.0,
                min_capacity=4,
                max_capacity=200
            )
        }

        # Current resource metrics
        self.current_metrics: Dict[ResourceType, ResourceMetrics] = {}

        # Scaling strategies
        self.scaling_strategies: Dict[ResourceType, ScalingStrategy] = {
            resource: ScalingStrategy.PREDICTIVE for resource in ResourceType
        }

        # Monitoring configuration
        self.monitoring_interval = 60  # seconds
        self.prediction_horizon = timedelta(hours=1)
        self.cooldown_period = timedelta(minutes=5)  # Minimum time between scaling actions

        # Scaling history
        self.scaling_history: List[ScalingRecommendation] = []
        self.last_scaling_actions: Dict[ResourceType, datetime] = {}

        # Monitoring thread
        self.monitoring_thread: Optional[threading.Thread] = None
        self.monitoring_active = False

    async def _perform_health_check(self) -> None:
        """Perform health check."""
        # Check if we can monitor system resources
        try:
            psutil.cpu_percent()
            psutil.virtual_memory()
        except Exception as e:
            raise Exception(f"Resource monitoring unavailable: {e}")

    async def start_monitoring(self) -> None:
        """Start resource monitoring."""
        if self.monitoring_active:
            return

        self.monitoring_active = True
        self.monitoring_thread = threading.Thread(target=self._monitoring_loop, daemon=True)
        self.monitoring_thread.start()

        self.logger.info("Resource monitoring started")

    def stop_monitoring(self) -> None:
        """Stop resource monitoring."""
        self.monitoring_active = False
        if self.monitoring_thread:
            self.monitoring_thread.join(timeout=5)
        self.logger.info("Resource monitoring stopped")

    def _monitoring_loop(self) -> None:
        """Main monitoring loop (runs in separate thread)."""
        while self.monitoring_active:
            try:
                # Collect metrics
                metrics = self._collect_system_metrics()

                # Update current metrics
                for metric in metrics:
                    self.current_metrics[metric.resource_type] = metric

                    # Record observation for predictive analytics
                    asyncio.run(self._record_metric_observation(metric))

                # Generate scaling recommendations
                recommendations = asyncio.run(self._generate_scaling_recommendations())

                # Execute automatic scaling if enabled
                if self.config.get("auto_scaling", False):
                    asyncio.run(self._execute_scaling_recommendations(recommendations))

                # Sleep until next monitoring cycle
                threading.Event().wait(self.monitoring_interval)

            except Exception as e:
                self.logger.error(f"Monitoring loop error: {e}")
                threading.Event().wait(10)  # Wait before retrying

    def _collect_system_metrics(self) -> List[ResourceMetrics]:
        """Collect current system resource metrics."""
        metrics = []

        try:
            # CPU metrics
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_count = psutil.cpu_count()
            metrics.append(ResourceMetrics(
                resource_type=ResourceType.CPU,
                current_usage=cpu_percent,
                absolute_usage=cpu_count,
                capacity=cpu_count
            ))

            # Memory metrics
            memory = psutil.virtual_memory()
            memory_usage_mb = (memory.total - memory.available) // (1024 * 1024)
            memory_total_mb = memory.total // (1024 * 1024)
            metrics.append(ResourceMetrics(
                resource_type=ResourceType.MEMORY,
                current_usage=memory.percent,
                absolute_usage=memory_usage_mb,
                capacity=memory_total_mb
            ))

            # Disk metrics (root filesystem)
            disk = psutil.disk_usage('/')
            disk_usage_mb = disk.used // (1024 * 1024)
            disk_total_mb = disk.total // (1024 * 1024)
            metrics.append(ResourceMetrics(
                resource_type=ResourceType.DISK,
                current_usage=disk.percent,
                absolute_usage=disk_usage_mb,
                capacity=disk_total_mb
            ))

            # Network metrics (simplified - could be enhanced)
            net = psutil.net_io_counters()
            if net:
                # Calculate network utilization as a percentage (simplified)
                network_usage = min(100.0, (net.bytes_sent + net.bytes_recv) / (1024 * 1024))  # MB transferred
                metrics.append(ResourceMetrics(
                    resource_type=ResourceType.NETWORK,
                    current_usage=network_usage,
                    absolute_usage=net.bytes_sent + net.bytes_recv,
                    capacity=100 * 1024 * 1024  # 100MB as reference
                ))

        except Exception as e:
            self.logger.error(f"Failed to collect system metrics: {e}")

        return metrics

    async def _record_metric_observation(self, metric: ResourceMetrics) -> None:
        """Record metric observation for predictive analytics."""
        try:
            await predictive_engine.record_observation(
                entity=f"resource:{metric.resource_type.value}",
                value=metric.current_usage,
                context={
                    "resource_type": metric.resource_type.value,
                    "absolute_usage": metric.absolute_usage,
                    "capacity": metric.capacity
                },
                metadata={
                    "utilization_trend": metric.utilization_trend,
                    "prediction_confidence": metric.prediction_confidence
                }
            )
        except Exception as e:
            self.logger.warning(f"Failed to record metric observation: {e}")

    async def _generate_scaling_recommendations(self) -> List[ScalingRecommendation]:
        """Generate scaling recommendations based on current metrics and predictions."""
        recommendations = []

        for resource_type, metrics in self.current_metrics.items():
            try:
                threshold = self.thresholds.get(resource_type)
                if not threshold:
                    continue

                strategy = self.scaling_strategies.get(resource_type, ScalingStrategy.REACTIVE)

                if strategy == ScalingStrategy.PREDICTIVE:
                    recommendation = await self._predictive_scaling_recommendation(
                        resource_type, metrics, threshold
                    )
                elif strategy == ScalingStrategy.REACTIVE:
                    recommendation = self._reactive_scaling_recommendation(
                        resource_type, metrics, threshold
                    )
                elif strategy == ScalingStrategy.SCHEDULED:
                    recommendation = await self._scheduled_scaling_recommendation(
                        resource_type, metrics, threshold
                    )
                else:  # HYBRID
                    recommendation = await self._hybrid_scaling_recommendation(
                        resource_type, metrics, threshold
                    )

                if recommendation:
                    recommendations.append(recommendation)
                    self.scaling_history.append(recommendation)

            except Exception as e:
                self.logger.error(f"Failed to generate recommendation for {resource_type.value}: {e}")

        # Keep only recent history
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
        self.scaling_history = [
            rec for rec in self.scaling_history
            if rec.timestamp > cutoff_time
        ]

        return recommendations

    async def _predictive_scaling_recommendation(
        self,
        resource_type: ResourceType,
        metrics: ResourceMetrics,
        threshold: ResourceThreshold
    ) -> Optional[ScalingRecommendation]:
        """Generate predictive scaling recommendation."""
        entity = f"resource:{resource_type.value}"

        # Get prediction for resource usage
        prediction = await predictive_engine.predict_performance(
            entity=entity,
            metric="usage_percentage",
            prediction_horizon=self.prediction_horizon
        )

        if not prediction:
            # Fall back to reactive scaling
            return self._reactive_scaling_recommendation(resource_type, metrics, threshold)

        predicted_usage = prediction.predicted_value
        confidence = prediction.confidence

        # Calculate recommended capacity
        current_capacity = metrics.capacity
        recommended_capacity = current_capacity

        reasoning = []

        if predicted_usage >= threshold.scale_up_threshold and confidence > 0.6:
            # Scale up to handle predicted load
            scale_factor = predicted_usage / 100.0
            recommended_capacity = min(
                threshold.max_capacity,
                max(current_capacity, math.ceil(current_capacity * scale_factor))
            )
            action = "scale_up"
            reasoning.append(".1f")
        elif predicted_usage <= threshold.scale_down_threshold and confidence > 0.6:
            # Scale down to save resources
            scale_factor = predicted_usage / 100.0
            recommended_capacity = max(
                threshold.min_capacity,
                max(1, math.floor(current_capacity * scale_factor))
            )
            action = "scale_down"
            reasoning.append(".1f")
        else:
            action = "maintain"
            reasoning.append(".1f")

        return ScalingRecommendation(
            resource_type=resource_type,
            action=action,
            current_capacity=current_capacity,
            recommended_capacity=recommended_capacity,
            confidence=confidence,
            reasoning=reasoning
        )

    def _reactive_scaling_recommendation(
        self,
        resource_type: ResourceType,
        metrics: ResourceMetrics,
        threshold: ResourceThreshold
    ) -> Optional[ScalingRecommendation]:
        """Generate reactive scaling recommendation based on current usage."""
        current_usage = metrics.current_usage
        current_capacity = metrics.capacity
        recommended_capacity = current_capacity

        reasoning = []

        if threshold.should_scale_up(current_usage):
            # Scale up immediately
            scale_factor = current_usage / 100.0
            recommended_capacity = min(
                threshold.max_capacity,
                max(current_capacity, math.ceil(current_capacity * scale_factor))
            )
            action = "scale_up"
            reasoning.append(".1f")
        elif threshold.should_scale_down(current_usage):
            # Scale down to save resources
            recommended_capacity = max(
                threshold.min_capacity,
                math.floor(current_capacity * 0.8)  # Reduce by 20%
            )
            action = "scale_down"
            reasoning.append(".1f")
        else:
            action = "maintain"
            reasoning.append(".1f")

        # Only recommend if there's a meaningful change
        if abs(recommended_capacity - current_capacity) / current_capacity > 0.1:
            return ScalingRecommendation(
                resource_type=resource_type,
                action=action,
                current_capacity=current_capacity,
                recommended_capacity=recommended_capacity,
                confidence=0.8,  # High confidence for reactive scaling
                reasoning=reasoning
            )

        return None

    async def _scheduled_scaling_recommendation(
        self,
        resource_type: ResourceType,
        metrics: ResourceMetrics,
        threshold: ResourceThreshold
    ) -> Optional[ScalingRecommendation]:
        """Generate scheduled scaling recommendation based on time patterns."""
        # This would analyze historical usage patterns by time of day/week
        # For now, return None (placeholder for future implementation)
        return None

    async def _hybrid_scaling_recommendation(
        self,
        resource_type: ResourceType,
        metrics: ResourceMetrics,
        threshold: ResourceThreshold
    ) -> Optional[ScalingRecommendation]:
        """Generate hybrid scaling recommendation combining multiple strategies."""
        # Get predictive recommendation
        predictive_rec = await self._predictive_scaling_recommendation(
            resource_type, metrics, threshold
        )

        # Get reactive recommendation
        reactive_rec = self._reactive_scaling_recommendation(
            resource_type, metrics, threshold
        )

        # Combine recommendations
        if predictive_rec and reactive_rec:
            # If both agree, use higher confidence
            if predictive_rec.action == reactive_rec.action:
                confidence = min(1.0, predictive_rec.confidence + reactive_rec.confidence)
                return ScalingRecommendation(
                    resource_type=resource_type,
                    action=predictive_rec.action,
                    current_capacity=metrics.capacity,
                    recommended_capacity=predictive_rec.recommended_capacity,
                    confidence=confidence,
                    reasoning=predictive_rec.reasoning + reactive_rec.reasoning
                )
            # If they disagree, prefer reactive for immediate issues
            elif reactive_rec.action != "maintain":
                return reactive_rec
            else:
                return predictive_rec

        # Return whichever one we have
        return predictive_rec or reactive_rec

    async def _execute_scaling_recommendations(self, recommendations: List[ScalingRecommendation]) -> None:
        """Execute scaling recommendations."""
        for recommendation in recommendations:
            try:
                # Check cooldown period
                last_action = self.last_scaling_actions.get(recommendation.resource_type)
                if last_action and datetime.now(timezone.utc) - last_action < self.cooldown_period:
                    continue

                # Execute scaling
                await self._execute_scaling_action(recommendation)

                # Record the action
                self.last_scaling_actions[recommendation.resource_type] = datetime.now(timezone.utc)

            except Exception as e:
                self.logger.error(f"Failed to execute scaling recommendation: {e}")

    async def _execute_scaling_action(self, recommendation: ScalingRecommendation) -> None:
        """Execute a specific scaling action."""
        # This is where you would integrate with your actual scaling mechanisms
        # (Docker, Kubernetes, cloud provider APIs, etc.)

        resource_type = recommendation.resource_type
        action = recommendation.action
        new_capacity = recommendation.recommended_capacity

        self.logger.info(
            f"Executing scaling action: {action} {resource_type.value} to {new_capacity}"
        )

        # Placeholder - actual implementation would depend on your infrastructure
        if resource_type == ResourceType.CPU:
            # Would integrate with container orchestration
            pass
        elif resource_type == ResourceType.MEMORY:
            # Would adjust memory limits
            pass
        elif resource_type == ResourceType.DATABASE_CONNECTIONS:
            # Would adjust connection pool size
            pass
        elif resource_type == ResourceType.THREAD_POOL:
            # Would adjust thread pool size
            pass

        # In a real implementation, you would:
        # 1. Call cloud provider APIs (AWS ECS, Kubernetes, etc.)
        # 2. Adjust container resource limits
        # 3. Update configuration files
        # 4. Restart services if necessary

    def get_resource_metrics(self) -> Dict[str, Dict[str, Any]]:
        """Get current resource metrics."""
        return {
            resource_type.value: metrics.to_dict()
            for resource_type, metrics in self.current_metrics.items()
        }

    def get_scaling_recommendations(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent scaling recommendations."""
        return [
            rec.to_dict() for rec in self.scaling_history[-limit:]
        ]

    def update_threshold(
        self,
        resource_type: ResourceType,
        threshold: ResourceThreshold
    ) -> None:
        """Update threshold configuration for a resource type."""
        self.thresholds[resource_type] = threshold
        self.logger.info(f"Updated thresholds for {resource_type.value}")

    def set_scaling_strategy(
        self,
        resource_type: ResourceType,
        strategy: ScalingStrategy
    ) -> None:
        """Set scaling strategy for a resource type."""
        self.scaling_strategies[resource_type] = strategy
        self.logger.info(f"Set scaling strategy for {resource_type.value} to {strategy.value}")

    def get_resource_efficiency_score(self) -> Dict[str, float]:
        """Calculate resource efficiency scores."""
        efficiency_scores = {}

        for resource_type, metrics in self.current_metrics.items():
            threshold = self.thresholds.get(resource_type)
            if threshold:
                usage = metrics.current_usage
                # Efficiency score based on optimal utilization range
                if usage < threshold.scale_down_threshold:
                    # Under-utilized
                    efficiency = usage / threshold.scale_down_threshold
                elif usage <= threshold.scale_up_threshold:
                    # Optimal range
                    efficiency = 1.0
                else:
                    # Over-utilized
                    efficiency = threshold.scale_up_threshold / usage

                efficiency_scores[resource_type.value] = efficiency

        return efficiency_scores

    def get_cost_optimization_recommendations(self) -> List[Dict[str, Any]]:
        """Get cost optimization recommendations."""
        recommendations = []

        efficiency_scores = self.get_resource_efficiency_score()

        for resource_type_str, efficiency in efficiency_scores.items():
            resource_type = ResourceType(resource_type_str)
            metrics = self.current_metrics.get(resource_type)

            if efficiency < 0.7 and metrics:  # Under-utilized
                recommendations.append({
                    "resource_type": resource_type_str,
                    "recommendation": "rightsizing",
                    "current_usage": metrics.current_usage,
                    "efficiency_score": efficiency,
                    "potential_savings": f"Could reduce capacity by {int((1 - efficiency) * 100)}%"
                })
            elif efficiency > 1.2 and metrics:  # Over-utilized
                recommendations.append({
                    "resource_type": resource_type_str,
                    "recommendation": "scale_up",
                    "current_usage": metrics.current_usage,
                    "efficiency_score": efficiency,
                    "reason": "Resource is over-utilized"
                })

        return recommendations

    async def initialize(self) -> None:
        """Initialize the resource optimizer."""
        self.logger.info("Resource optimizer initialized")

    async def shutdown(self) -> None:
        """Shutdown the resource optimizer."""
        self.stop_monitoring()
        self.logger.info("Resource optimizer shutdown")


# Global resource optimizer instance
resource_optimizer = ResourceOptimizer(
    ServiceConfig(name="resource_optimizer", enabled=True)
)