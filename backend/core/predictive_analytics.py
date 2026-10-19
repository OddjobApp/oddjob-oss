"""
Predictive Analytics Engine
AI-powered failure prediction, resource optimization, and workflow improvement
"""

import asyncio
from typing import Dict, List, Any, Optional, Tuple, Union
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import statistics
import json

from core.structured_logging import get_structured_logger
from core.memory_store import memory_store, MemoryType, MemoryQuery
from core.service_base import BaseService, ServiceConfig

logger = get_structured_logger("predictive_analytics")


class PredictionModel(Enum):
    """Types of prediction models."""
    LINEAR_REGRESSION = "linear_regression"
    EXPONENTIAL_SMOOTHING = "exponential_smoothing"
    STATISTICAL_PROCESS_CONTROL = "statistical_process_control"
    MACHINE_LEARNING = "machine_learning"
    TIME_SERIES_ANALYSIS = "time_series_analysis"


class PredictionType(Enum):
    """Types of predictions."""
    FAILURE = "failure"
    PERFORMANCE = "performance"
    RESOURCE_USAGE = "resource_usage"
    WORKFLOW_EFFICIENCY = "workflow_efficiency"
    USER_BEHAVIOR = "user_behavior"


class RiskLevel(Enum):
    """Risk assessment levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class PredictionFeature:
    """A feature used for prediction."""
    name: str
    value: Union[float, int, str, bool]
    weight: float = 1.0
    importance: float = 0.5  # 0.0 to 1.0

    def to_numeric(self) -> float:
        """Convert feature to numeric value."""
        if isinstance(self.value, (int, float)):
            return float(self.value)
        elif isinstance(self.value, bool):
            return 1.0 if self.value else 0.0
        elif isinstance(self.value, str):
            # Simple string hashing for categorical data
            return hash(self.value) % 1000 / 1000.0
        else:
            return 0.0


@dataclass
class PredictionResult:
    """Result of a prediction."""
    prediction_type: PredictionType
    target_entity: str  # service, workflow, user, etc.
    predicted_value: Union[float, str, bool]
    confidence: float  # 0.0 to 1.0
    risk_level: RiskLevel
    prediction_horizon: timedelta  # How far into the future
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Supporting data
    features_used: List[PredictionFeature] = field(default_factory=list)
    historical_data_points: int = 0
    model_used: PredictionModel = PredictionModel.STATISTICAL_PROCESS_CONTROL

    # Recommendations
    recommendations: List[str] = field(default_factory=list)
    preventive_actions: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "prediction_type": self.prediction_type.value,
            "target_entity": self.target_entity,
            "predicted_value": self.predicted_value,
            "confidence": self.confidence,
            "risk_level": self.risk_level.value,
            "prediction_horizon_hours": self.prediction_horizon.total_seconds() / 3600,
            "timestamp": self.timestamp.isoformat(),
            "features_used": [
                {
                    "name": f.name,
                    "value": f.value,
                    "weight": f.weight,
                    "importance": f.importance
                }
                for f in self.features_used
            ],
            "historical_data_points": self.historical_data_points,
            "model_used": self.model_used.value,
            "recommendations": self.recommendations,
            "preventive_actions": self.preventive_actions
        }


@dataclass
class HistoricalDataPoint:
    """A point of historical data for training predictions."""
    timestamp: datetime
    value: Union[float, int, str, bool]
    context: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "timestamp": self.timestamp.isoformat(),
            "value": self.value,
            "context": self.context,
            "metadata": self.metadata
        }


class PredictiveAnalyticsEngine(BaseService):
    """Core engine for predictive analytics and failure prediction."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.logger = get_structured_logger("predictive_engine")

        # Prediction models and data
        self.historical_data: Dict[str, List[HistoricalDataPoint]] = {}
        self.active_predictions: Dict[str, PredictionResult] = {}

        # Configuration
        self.min_data_points = 10  # Minimum data points needed for prediction
        self.prediction_horizon = timedelta(hours=24)  # Default prediction window
        self.confidence_threshold = 0.7  # Minimum confidence for alerts

        # Model parameters
        self.ewma_alpha = 0.3  # Exponential weighted moving average parameter
        self.control_limits_sigma = 3  # Standard deviations for control limits

    async def _perform_health_check(self) -> None:
        """Perform health check."""
        # Check if we have enough historical data
        total_data_points = sum(len(data) for data in self.historical_data.values())
        if total_data_points < self.min_data_points:
            raise Exception(f"Insufficient historical data: {total_data_points} points")

    async def record_observation(
        self,
        entity: str,
        value: Union[float, int, str, bool],
        context: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Record an observation for predictive analysis."""
        data_point = HistoricalDataPoint(
            timestamp=datetime.now(timezone.utc),
            value=value,
            context=context or {},
            metadata=metadata or {}
        )

        if entity not in self.historical_data:
            self.historical_data[entity] = []

        self.historical_data[entity].append(data_point)

        # Keep only recent data (last 90 days)
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=90)
        self.historical_data[entity] = [
            dp for dp in self.historical_data[entity]
            if dp.timestamp > cutoff_date
        ]

        # Log the observation
        await self._log_observation_to_memory(entity, data_point)

    async def _log_observation_to_memory(self, entity: str, data_point: HistoricalDataPoint) -> None:
        """Log observation to memory store for long-term retention."""
        try:
            content = f"Observation: {entity} = {data_point.value}"
            context = {
                "entity": entity,
                "value": data_point.value,
                "timestamp": data_point.timestamp.isoformat(),
                "context": data_point.context,
                "metadata": data_point.metadata
            }

            await memory_store.store_memory(
                content=content,
                memory_type=MemoryType.SUCCESS if self._is_success_value(data_point.value) else MemoryType.ERROR,
                context=context,
                source="predictive_analytics"
            )
        except Exception as e:
            self.logger.warning(f"Failed to log observation to memory: {e}")

    def _is_success_value(self, value: Union[float, int, str, bool]) -> bool:
        """Determine if a value indicates success."""
        if isinstance(value, bool):
            return value
        elif isinstance(value, (int, float)):
            return value >= 0  # Assume positive values are good
        elif isinstance(value, str):
            return "success" in value.lower() or "ok" in value.lower()
        return True

    async def predict_failure(
        self,
        entity: str,
        prediction_horizon: Optional[timedelta] = None
    ) -> Optional[PredictionResult]:
        """Predict potential failure for an entity."""
        horizon = prediction_horizon or self.prediction_horizon
        data_points = self.historical_data.get(entity, [])

        if len(data_points) < self.min_data_points:
            self.logger.warning(f"Insufficient data for {entity}: {len(data_points)} points")
            return None

        # Extract numeric values for analysis
        values = [dp.value for dp in data_points if isinstance(dp.value, (int, float))]
        if len(values) < self.min_data_points:
            return None

        # Calculate features
        features = self._calculate_failure_features(entity, values, data_points)

        # Perform statistical process control analysis
        prediction = self._statistical_process_control_prediction(values, features)

        # Create prediction result
        result = PredictionResult(
            prediction_type=PredictionType.FAILURE,
            target_entity=entity,
            predicted_value=prediction["will_fail"],
            confidence=prediction["confidence"],
            risk_level=self._calculate_risk_level(prediction["confidence"], prediction["deviation"]),
            prediction_horizon=horizon,
            features_used=features,
            historical_data_points=len(data_points),
            model_used=PredictionModel.STATISTICAL_PROCESS_CONTROL
        )

        # Add recommendations
        result.recommendations = self._generate_failure_recommendations(entity, prediction, features)
        result.preventive_actions = self._generate_preventive_actions(entity, prediction)

        # Store active prediction
        self.active_predictions[f"{entity}_failure"] = result

        return result

    def _calculate_failure_features(
        self,
        entity: str,
        values: List[float],
        data_points: List[HistoricalDataPoint]
    ) -> List[PredictionFeature]:
        """Calculate features for failure prediction."""
        features = []

        if len(values) < 2:
            return features

        # Trend analysis
        recent_values = values[-10:]  # Last 10 data points
        trend = self._calculate_trend(recent_values)
        features.append(PredictionFeature(
            name="trend_direction",
            value=trend["direction"],
            weight=1.0,
            importance=0.8
        ))
        features.append(PredictionFeature(
            name="trend_slope",
            value=trend["slope"],
            weight=1.0,
            importance=0.7
        ))

        # Volatility
        volatility = statistics.stdev(values) / (statistics.mean(values) or 1)
        features.append(PredictionFeature(
            name="volatility",
            value=volatility,
            weight=1.0,
            importance=0.6
        ))

        # Recent anomalies
        anomalies = self._detect_anomalies(values)
        features.append(PredictionFeature(
            name="recent_anomalies",
            value=len(anomalies),
            weight=1.0,
            importance=0.9
        ))

        # Error patterns from context
        error_count = sum(1 for dp in data_points[-20:] if dp.context.get("error", False))
        features.append(PredictionFeature(
            name="error_frequency",
            value=error_count / max(1, len(data_points[-20:])),
            weight=1.0,
            importance=0.8
        ))

        return features

    def _calculate_trend(self, values: List[float]) -> Dict[str, Any]:
        """Calculate trend direction and slope."""
        if len(values) < 2:
            return {"direction": "stable", "slope": 0.0}

        # Simple linear regression
        x = list(range(len(values)))
        y = values

        n = len(x)
        sum_x = sum(x)
        sum_y = sum(y)
        sum_xy = sum(xi * yi for xi, yi in zip(x, y))
        sum_xx = sum(xi * xi for xi in x)

        slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x)
        intercept = (sum_y - slope * sum_x) / n

        direction = "increasing" if slope > 0.01 else "decreasing" if slope < -0.01 else "stable"

        return {
            "direction": direction,
            "slope": slope,
            "intercept": intercept
        }

    def _detect_anomalies(self, values: List[float]) -> List[int]:
        """Detect anomalous data points using statistical methods."""
        if len(values) < 5:
            return []

        mean = statistics.mean(values)
        stdev = statistics.stdev(values)

        anomalies = []
        for i, value in enumerate(values):
            z_score = abs(value - mean) / (stdev or 1)
            if z_score > 3:  # More than 3 standard deviations
                anomalies.append(i)

        return anomalies

    def _statistical_process_control_prediction(
        self,
        values: List[float],
        features: List[PredictionFeature]
    ) -> Dict[str, Any]:
        """Perform statistical process control analysis for failure prediction."""
        if len(values) < self.min_data_points:
            return {"will_fail": False, "confidence": 0.0, "deviation": 0.0}

        # Calculate control limits
        mean = statistics.mean(values)
        stdev = statistics.stdev(values)

        upper_control_limit = mean + (self.control_limits_sigma * stdev)
        lower_control_limit = mean - (self.control_limits_sigma * stdev)

        # Check recent values against control limits
        recent_values = values[-5:]  # Last 5 data points
        out_of_control = any(
            v > upper_control_limit or v < lower_control_limit
            for v in recent_values
        )

        # Calculate trend-based prediction
        trend = self._calculate_trend(values[-10:])
        projected_next = values[-1] + trend["slope"]

        # Determine if failure is likely
        will_fail = out_of_control or projected_next > upper_control_limit * 1.2

        # Calculate confidence based on various factors
        confidence_factors = [
            1.0 if out_of_control else 0.0,  # Out of control = high confidence
            min(1.0, abs(trend["slope"]) * 10),  # Strong trend = higher confidence
            len([f for f in features if f.name == "recent_anomalies" and f.value > 0]) / 5.0,
            min(1.0, len(values) / 50.0)  # More data = higher confidence
        ]

        confidence = statistics.mean(confidence_factors) if confidence_factors else 0.0
        deviation = abs(projected_next - mean) / (stdev or 1)

        return {
            "will_fail": will_fail,
            "confidence": confidence,
            "deviation": deviation,
            "mean": mean,
            "stdev": stdev,
            "upper_control_limit": upper_control_limit,
            "lower_control_limit": lower_control_limit
        }

    def _calculate_risk_level(self, confidence: float, deviation: float) -> RiskLevel:
        """Calculate risk level based on confidence and deviation."""
        risk_score = (confidence + deviation) / 2

        if risk_score >= 0.8:
            return RiskLevel.CRITICAL
        elif risk_score >= 0.6:
            return RiskLevel.HIGH
        elif risk_score >= 0.4:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW

    def _generate_failure_recommendations(
        self,
        entity: str,
        prediction: Dict[str, Any],
        features: List[PredictionFeature]
    ) -> List[str]:
        """Generate recommendations based on prediction analysis."""
        recommendations = []

        # Check for trends
        trend_feature = next((f for f in features if f.name == "trend_direction"), None)
        if trend_feature and trend_feature.value == "decreasing":
            recommendations.append("Monitor declining performance trend for entity")
        elif trend_feature and trend_feature.value == "increasing":
            recommendations.append("Positive performance trend detected - continue monitoring")

        # Check for anomalies
        anomaly_feature = next((f for f in features if f.name == "recent_anomalies"), None)
        if anomaly_feature and anomaly_feature.value > 0:
            recommendations.append(f"Investigate {anomaly_feature.value} recent anomalies")

        # Check for high volatility
        volatility_feature = next((f for f in features if f.name == "volatility"), None)
        if volatility_feature and volatility_feature.value > 0.5:
            recommendations.append("High performance volatility detected - consider stabilization measures")

        # General recommendations
        if prediction["will_fail"]:
            recommendations.append("Immediate attention recommended - failure predicted")
            recommendations.append("Review system logs and recent changes")
        else:
            recommendations.append("System appears stable - continue normal monitoring")

        return recommendations

    def _generate_preventive_actions(
        self,
        entity: str,
        prediction: Dict[str, Any]
    ) -> List[str]:
        """Generate preventive actions based on prediction."""
        actions = []

        if prediction["will_fail"] and prediction["confidence"] > 0.7:
            actions.append("Schedule immediate maintenance window")
            actions.append("Increase monitoring frequency")
            actions.append("Prepare rollback procedures")
        elif prediction["confidence"] > 0.5:
            actions.append("Schedule preventive maintenance")
            actions.append("Review and update monitoring thresholds")

        return actions

    async def predict_performance(
        self,
        entity: str,
        metric: str,
        prediction_horizon: Optional[timedelta] = None
    ) -> Optional[PredictionResult]:
        """Predict future performance metrics."""
        horizon = prediction_horizon or self.prediction_horizon
        data_points = self.historical_data.get(entity, [])

        # Filter by metric
        metric_data = [
            dp for dp in data_points
            if dp.context.get("metric") == metric and isinstance(dp.value, (int, float))
        ]

        if len(metric_data) < self.min_data_points:
            return None

        values = [dp.value for dp in metric_data]

        # Use exponential smoothing for prediction
        prediction = self._exponential_smoothing_prediction(values)

        result = PredictionResult(
            prediction_type=PredictionType.PERFORMANCE,
            target_entity=f"{entity}:{metric}",
            predicted_value=prediction["predicted_value"],
            confidence=prediction["confidence"],
            risk_level=self._calculate_risk_level(prediction["confidence"], 0.0),
            prediction_horizon=horizon,
            features_used=[],  # Could be enhanced
            historical_data_points=len(values),
            model_used=PredictionModel.EXPONENTIAL_SMOOTHING
        )

        result.recommendations = self._generate_performance_recommendations(
            entity, metric, prediction
        )

        return result

    def _exponential_smoothing_prediction(self, values: List[float]) -> Dict[str, Any]:
        """Perform exponential smoothing prediction."""
        if len(values) < 2:
            return {"predicted_value": values[0] if values else 0, "confidence": 0.0}

        # Simple exponential smoothing
        smoothed = [values[0]]
        for i in range(1, len(values)):
            smoothed_value = self.ewma_alpha * values[i] + (1 - self.ewma_alpha) * smoothed[-1]
            smoothed.append(smoothed_value)

        # Predict next value
        predicted_value = self.ewma_alpha * values[-1] + (1 - self.ewma_alpha) * smoothed[-1]

        # Calculate confidence based on trend stability
        recent_stability = 1.0 - min(1.0, statistics.stdev(values[-5:]) / (statistics.mean(values[-5:]) or 1))

        return {
            "predicted_value": predicted_value,
            "confidence": recent_stability,
            "smoothed_values": smoothed
        }

    def _generate_performance_recommendations(
        self,
        entity: str,
        metric: str,
        prediction: Dict[str, Any]
    ) -> List[str]:
        """Generate performance recommendations."""
        recommendations = []

        predicted_value = prediction["predicted_value"]
        confidence = prediction["confidence"]

        if confidence > 0.8:
            if predicted_value > 100:  # Assuming percentage metric
                recommendations.append(f"High {metric} expected - prepare for increased load")
            elif predicted_value < 20:
                recommendations.append(f"Low {metric} predicted - investigate potential issues")
        else:
            recommendations.append(f"Performance prediction uncertain - increase monitoring for {metric}")

        return recommendations

    async def initialize(self) -> None:
        """Initialize the predictive analytics engine."""
        self.logger.info("Predictive analytics engine initialized")

    async def shutdown(self) -> None:
        """Shutdown the predictive analytics engine."""
        self.logger.info("Predictive analytics engine shutdown")


# Global predictive analytics engine instance
predictive_engine = PredictiveAnalyticsEngine(
    ServiceConfig(name="predictive_analytics", enabled=True)
)

# Global predictive analytics engine instance
predictive_engine = PredictiveAnalyticsEngine(
    ServiceConfig(name="predictive_analytics", enabled=True)
)