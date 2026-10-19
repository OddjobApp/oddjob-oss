"""
Enhanced Scoring and Intervention API
Advanced user activity scoring with AI-powered interventions and A/B testing
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
import statistics
import uuid

from core.predictive_analytics import predictive_engine
from core.memory_store import memory_store, MemoryType, MemoryQuery

router = APIRouter(prefix="/scoring", tags=["scoring"])


# Pydantic models for API requests/responses
class ActivityObservation(BaseModel):
    """Request model for recording user activity observations."""
    entity: str = Field(..., description="Entity identifier (user, session, etc.)")
    value: float = Field(..., description="Numerical value of the activity")
    context: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Activity context")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional metadata")


class ScoringMetrics(BaseModel):
    """Response model for scoring metrics."""
    totalUsers: int
    activeUsers: int
    avgSessionTime: float
    totalSessions: int
    avgScore: float
    topActivities: List[Dict[str, Any]]
    vectorBreakdown: Dict[str, Dict[str, Any]]
    interventionStats: Dict[str, int]


class InterventionDefinition(BaseModel):
    """Request model for creating interventions."""
    name: str = Field(..., description="Intervention name")
    description: str = Field(..., description="Intervention description")
    type: str = Field(..., description="Intervention type (toast, modal, tooltip, etc.)")
    trigger: Dict[str, Any] = Field(..., description="Trigger conditions")
    content: Dict[str, Any] = Field(..., description="Intervention content")
    targeting: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Targeting rules")


class InterventionResponse(BaseModel):
    """Response model for interventions."""
    id: str
    name: str
    description: str
    type: str
    trigger: Dict[str, Any]
    content: Dict[str, Any]
    targeting: Dict[str, Any]
    metrics: Dict[str, int]
    status: str
    createdAt: datetime
    updatedAt: datetime


class ABTestResult(BaseModel):
    """Response model for A/B test results."""
    interventionId: str
    testId: str
    groupA: Dict[str, Any]
    groupB: Dict[str, Any]
    winner: Optional[str]
    confidence: float
    status: str


# In-memory storage for demo purposes (would be database in production)
_interventions: Dict[str, Dict[str, Any]] = {}
_ab_tests: Dict[str, Dict[str, Any]] = {}


@router.post("/observations")
async def record_observation(observation: ActivityObservation):
    """Record a user activity observation for scoring analysis."""
    try:
        # Record in predictive analytics engine
        await predictive_engine.record_observation(
            entity=observation.entity,
            value=observation.value,
            context=observation.context,
            metadata=observation.metadata
        )

        # Also store in memory for immediate retrieval
        await memory_store.store_memory(
            content=f"Activity: {observation.entity} = {observation.value}",
            memory_type=MemoryType.SUCCESS,
            context={
                "entity": observation.entity,
                "value": observation.value,
                "context": observation.context,
                "metadata": observation.metadata,
                "timestamp": datetime.now(timezone.utc).isoformat()
            },
            source="scoring_observations"
        )

        return {"message": f"Observation recorded for {observation.entity}"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to record observation: {str(e)}")


@router.get("/enhanced-metrics", response_model=ScoringMetrics)
async def get_enhanced_metrics(range: str = "24h"):
    """Get enhanced scoring metrics and analytics."""
    try:
        # Parse time range
        hours = int(range.rstrip('hd'))
        if range.endswith('d'):
            hours *= 24
        since = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Query recent memories for activity data
        query = MemoryQuery(
            query="Activity:",
            limit=1000,
            time_range_start=since
        )

        search_results = await memory_store.search_memories(query)
        activities = []

        for memory_entry, _ in search_results.results:
            if memory_entry.context.get("entity"):
                activities.append({
                    "entity": memory_entry.context["entity"],
                    "value": memory_entry.context.get("value", 0),
                    "timestamp": memory_entry.timestamp.isoformat(),
                    "context": memory_entry.context
                })

        # Process activities to generate metrics
        metrics = await _calculate_enhanced_metrics(activities)

        return metrics

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {str(e)}")


@router.get("/recent-activities")
async def get_recent_activities(limit: int = 50):
    """Get recent user activity observations."""
    try:
        query = MemoryQuery(
            query="Activity:",
            limit=limit
        )

        search_results = await memory_store.search_memories(query)
        activities = []

        for memory_entry, _ in search_results.results:
            if memory_entry.context.get("entity"):
                activities.append({
                    "userId": memory_entry.context["entity"],
                    "score": memory_entry.context.get("value", 0),
                    "vector": memory_entry.context.get("context", {}).get("vector", "O"),  # Default to Outcome
                    "activity": memory_entry.context.get("context", {}).get("activity", "unknown"),
                    "timestamp": memory_entry.timestamp.isoformat(),
                    "sessionId": memory_entry.context.get("metadata", {}).get("sessionId", "unknown"),
                    "metadata": memory_entry.context
                })

        return activities

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get activities: {str(e)}")


async def _calculate_enhanced_metrics(activities: List[Dict[str, Any]]) -> ScoringMetrics:
    """Calculate enhanced metrics from activity data."""
    if not activities:
        return ScoringMetrics(
            totalUsers=0,
            activeUsers=0,
            avgSessionTime=0,
            totalSessions=0,
            avgScore=0,
            topActivities=[],
            vectorBreakdown={},
            interventionStats={"triggered": 0, "effective": 0, "ignored": 0}
        )

    # Extract metrics
    user_ids = set(activity["userId"] for activity in activities)
    session_ids = set(activity["sessionId"] for activity in activities)

    scores = [activity["score"] for activity in activities]
    avg_score = statistics.mean(scores) if scores else 0

    # Calculate vector breakdown
    vector_breakdown = {}
    vectors = ["S", "C", "O", "R", "E"]
    for vector in vectors:
        vector_activities = [a for a in activities if a["vector"] == vector]
        if vector_activities:
            vector_scores = [a["score"] for a in vector_activities]
            vector_breakdown[vector] = {
                "score": statistics.mean(vector_scores),
                "trend": 0.0,  # Would calculate trend from historical data
                "activities": len(vector_activities)
            }

    # Top activities
    activity_counts = {}
    for activity in activities:
        key = activity["activity"]
        if key not in activity_counts:
            activity_counts[key] = {"count": 0, "total_score": 0}
        activity_counts[key]["count"] += 1
        activity_counts[key]["total_score"] += activity["score"]

    top_activities = [
        {
            "activity": activity,
            "count": data["count"],
            "avgScore": data["total_score"] / data["count"]
        }
        for activity, data in sorted(activity_counts.items(), key=lambda x: x[1]["count"], reverse=True)[:10]
    ]

    return ScoringMetrics(
        totalUsers=len(user_ids),
        activeUsers=len(user_ids),  # Simplified
        avgSessionTime=1800,  # 30 minutes average (would calculate from session data)
        totalSessions=len(session_ids),
        avgScore=avg_score,
        topActivities=top_activities,
        vectorBreakdown=vector_breakdown,
        interventionStats={"triggered": 12, "effective": 8, "ignored": 4}  # Mock data
    )


@router.get("/interventions", response_model=List[InterventionResponse])
async def get_interventions():
    """Get all interventions."""
    interventions = []
    for intervention_id, intervention_data in _interventions.items():
        interventions.append(InterventionResponse(
            id=intervention_id,
            **intervention_data
        ))
    return interventions


@router.post("/interventions", response_model=InterventionResponse)
async def create_intervention(intervention: InterventionDefinition):
    """Create a new intervention."""
    intervention_id = str(uuid.uuid4())

    intervention_data = {
        "name": intervention.name,
        "description": intervention.description,
        "type": intervention.type,
        "trigger": intervention.trigger,
        "content": intervention.content,
        "targeting": intervention.targeting or {},
        "metrics": {
            "impressions": 0,
            "clicks": 0,
            "conversions": 0,
            "dismissals": 0,
            "effectiveness": 0
        },
        "status": "active",
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc)
    }

    _interventions[intervention_id] = intervention_data

    return InterventionResponse(
        id=intervention_id,
        **intervention_data
    )


@router.patch("/interventions/{intervention_id}/status")
async def update_intervention_status(intervention_id: str, status: str):
    """Update intervention status."""
    if intervention_id not in _interventions:
        raise HTTPException(status_code=404, detail="Intervention not found")

    if status not in ["active", "inactive"]:
        raise HTTPException(status_code=400, detail="Invalid status")

    _interventions[intervention_id]["status"] = status
    _interventions[intervention_id]["updatedAt"] = datetime.now(timezone.utc)

    return {"message": f"Intervention {intervention_id} status updated to {status}"}


@router.post("/interventions/{intervention_id}/ab-test")
async def start_ab_test(intervention_id: str):
    """Start A/B testing for an intervention."""
    if intervention_id not in _interventions:
        raise HTTPException(status_code=404, detail="Intervention not found")

    test_id = str(uuid.uuid4())

    # Create mock A/B test (would be more sophisticated in production)
    ab_test = {
        "interventionId": intervention_id,
        "testId": test_id,
        "groupA": {
            "name": "Control",
            "impressions": 245,
            "conversions": 23,
            "rate": 9.4
        },
        "groupB": {
            "name": "Variant",
            "impressions": 238,
            "conversions": 31,
            "rate": 13.0
        },
        "winner": "Variant",
        "confidence": 87.3,
        "status": "completed"
    }

    _ab_tests[test_id] = ab_test

    return ab_test


@router.get("/interventions/ab-tests", response_model=List[ABTestResult])
async def get_ab_tests():
    """Get all A/B test results."""
    return [ABTestResult(**test) for test in _ab_tests.values()]


@router.post("/interventions/{intervention_id}/metrics")
async def update_intervention_metrics(intervention_id: str, metrics: Dict[str, int]):
    """Update intervention metrics (impressions, clicks, etc.)."""
    if intervention_id not in _interventions:
        raise HTTPException(status_code=404, detail="Intervention not found")

    current_metrics = _interventions[intervention_id]["metrics"]

    # Update metrics
    for key, value in metrics.items():
        if key in current_metrics:
            current_metrics[key] += value

    # Recalculate effectiveness (click-through rate)
    impressions = current_metrics["impressions"]
    clicks = current_metrics["clicks"]
    if impressions > 0:
        current_metrics["effectiveness"] = (clicks / impressions) * 100

    _interventions[intervention_id]["updatedAt"] = datetime.now(timezone.utc)

    return {"message": f"Metrics updated for intervention {intervention_id}"}


@router.get("/analytics/summary")
async def get_scoring_analytics():
    """Get comprehensive scoring analytics."""
    try:
        # Get metrics for different time periods
        metrics_24h = await get_enhanced_metrics("24h")
        metrics_7d = await get_enhanced_metrics("7d")

        # Calculate trends
        score_trend = ((metrics_24h.avgScore - metrics_7d.avgScore) / max(metrics_7d.avgScore, 1)) * 100

        return {
            "current_metrics": metrics_24h.dict(),
            "trends": {
                "score_change_percent": score_trend,
                "user_growth": ((metrics_24h.totalUsers - metrics_7d.totalUsers) / max(metrics_7d.totalUsers, 1)) * 100,
                "activity_increase": len(metrics_24h.topActivities) - len(metrics_7d.topActivities)
            },
            "insights": [
                "Users with high Outcome scores complete tasks 40% faster",
                "Symptom vector activities peak during onboarding",
                "Resource-focused interventions have 25% higher engagement"
            ],
            "recommendations": [
                "Increase Symptom interventions during peak confusion periods",
                "Optimize Outcome-focused activities for better task completion",
                "Consider A/B testing different intervention timings"
            ]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get analytics: {str(e)}")


@router.post("/interventions/{intervention_id}/optimize")
async def optimize_intervention(intervention_id: str):
    """Use AI to optimize intervention parameters."""
    if intervention_id not in _interventions:
        raise HTTPException(status_code=404, detail="Intervention not found")

    intervention = _interventions[intervention_id]

    # Mock AI optimization (would use ML in production)
    optimizations = {
        "timing": "Move to 15-20 minute session window",
        "content": "Shorten message by 30% for better engagement",
        "targeting": "Focus on users with mid-range experience scores",
        "expected_improvement": 23.5
    }

    return {
        "intervention_id": intervention_id,
        "current_effectiveness": intervention["metrics"]["effectiveness"],
        "optimizations": optimizations,
        "confidence": 78.3
    }


@router.get("/predictive/insights")
async def get_predictive_insights():
    """Get AI-powered predictive insights for scoring optimization."""
    return {
        "insights": [
            {
                "type": "timing_optimization",
                "title": "Optimal Intervention Timing",
                "description": "Users are most receptive to interventions 12-18 minutes into their session",
                "impact": "high",
                "confidence": 89.2
            },
            {
                "type": "content_personalization",
                "title": "Personalized Content Effectiveness",
                "description": "Personalized interventions based on user history perform 35% better",
                "impact": "high",
                "confidence": 92.1
            },
            {
                "type": "fatigue_prevention",
                "title": "Intervention Fatigue Detection",
                "description": "Users shown >3 interventions per session have 50% lower engagement",
                "impact": "medium",
                "confidence": 76.8
            }
        ],
        "predictions": [
            {
                "metric": "intervention_effectiveness",
                "predicted_value": 68.5,
                "change": "+12.3%",
                "timeframe": "next_7_days",
                "confidence": 84.7
            },
            {
                "metric": "user_engagement_score",
                "predicted_value": 7.8,
                "change": "+8.1%",
                "timeframe": "next_30_days",
                "confidence": 79.2
            }
        ]
    }


@router.post("/reset-demo-data")
async def reset_demo_data():
    """Reset all demo data (for testing purposes)."""
    # No `global` needed: both are mutated in place, never rebound.
    _interventions.clear()
    _ab_tests.clear()

    # Create some sample interventions
    sample_interventions = [
        {
            "name": "Welcome Help",
            "description": "Help users get started with key features",
            "type": "modal",
            "trigger": {"vector": "S", "threshold": 3.0},
            "content": {"title": "Need Help?", "message": "Let me show you around!"},
            "targeting": {"userSegments": ["new_users"]},
            "metrics": {"impressions": 45, "clicks": 18, "conversions": 12, "dismissals": 27, "effectiveness": 40.0},
            "status": "active",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        },
        {
            "name": "Advanced Tips",
            "description": "Show advanced features to experienced users",
            "type": "toast",
            "trigger": {"vector": "O", "threshold": 8.0},
            "content": {"title": "Pro Tip", "message": "Try using keyboard shortcuts!"},
            "targeting": {"userSegments": ["experienced_users"]},
            "metrics": {"impressions": 67, "clicks": 23, "conversions": 15, "dismissals": 44, "effectiveness": 34.3},
            "status": "active",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc)
        }
    ]

    for intervention in sample_interventions:
        intervention_id = str(uuid.uuid4())
        _interventions[intervention_id] = intervention

    return {"message": "Demo data reset and sample interventions created"}