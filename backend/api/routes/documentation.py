"""
Documentation Management API
REST endpoints for managing memory-based documentation
"""

from typing import Dict, List, Any, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from datetime import datetime, timezone

from core.memory_documentation import memory_documentation_service, DocumentationResult
from core.documentation_maintenance import documentation_maintenance_scheduler, MaintenanceResult, MaintenanceTask
from core.structured_logging import get_structured_logger

logger = get_structured_logger("documentation_api")

router = APIRouter(prefix="/documentation", tags=["documentation"])


# Pydantic models for API requests/responses
class GenerateDocumentationRequest(BaseModel):
    """Request model for generating documentation."""
    feature_id: str = Field(..., description="Feature ID to generate documentation for")
    force_regenerate: bool = Field(False, description="Force regeneration even if up to date")


class DocumentationResponse(BaseModel):
    """Response model for documentation generation."""
    result: Dict[str, Any]
    message: str
    generated_at: datetime


class MaintenanceTaskRequest(BaseModel):
    """Request model for running maintenance tasks."""
    task: str = Field(..., description="Maintenance task to run")
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Task parameters")


class SearchRequest(BaseModel):
    """Request model for documentation search."""
    query: str = Field(..., description="Search query")
    feature_filter: Optional[str] = Field(None, description="Filter by feature ID")
    limit: int = Field(20, description="Maximum results to return")


class FeatureStatusResponse(BaseModel):
    """Response model for feature documentation status."""
    feature_id: str
    name: str
    documentation_status: str
    last_updated: datetime
    total_documents: int
    up_to_date: bool


@router.post("/generate/{feature_id}", response_model=DocumentationResponse)
async def generate_feature_documentation(
    feature_id: str,
    request: GenerateDocumentationRequest,
    background_tasks: BackgroundTasks
):
    """Generate documentation for a specific feature."""
    try:
        # Check if feature exists
        registry = memory_documentation_service.get_feature_registry()
        if feature_id not in registry:
            raise HTTPException(status_code=404, detail=f"Feature '{feature_id}' not found")

        # Generate documentation in background
        background_tasks.add_task(
            _generate_documentation_background,
            feature_id,
            request.force_regenerate
        )

        return DocumentationResponse(
            result={"feature_id": feature_id, "status": "generating"},
            message=f"Documentation generation started for feature '{feature_id}'",
            generated_at=datetime.now(timezone.utc)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start documentation generation for {feature_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate documentation: {str(e)}")


async def _generate_documentation_background(feature_id: str, force_regenerate: bool):
    """Background task for documentation generation."""
    try:
        result = await memory_documentation_service.generate_feature_documentation(feature_id)

        if result.status.value == "completed":
            logger.info(f"Successfully generated documentation for {feature_id}: {len(result.memory_entries)} entries")
        else:
            logger.error(f"Failed to generate documentation for {feature_id}: {result.errors}")

    except Exception as e:
        logger.error(f"Background documentation generation failed for {feature_id}: {e}")


@router.post("/generate-all", response_model=Dict[str, Any])
async def generate_all_documentation(background_tasks: BackgroundTasks):
    """Generate documentation for all features."""
    try:
        background_tasks.add_task(_generate_all_documentation_background)

        return {
            "message": "Documentation generation started for all features",
            "status": "generating",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to start bulk documentation generation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start generation: {str(e)}")


async def _generate_all_documentation_background():
    """Background task for generating all documentation."""
    try:
        results = await memory_documentation_service.generate_all_feature_documentation()
        successful = sum(1 for r in results.values() if r.status.value == "completed")
        total = len(results)

        logger.info(f"Bulk documentation generation completed: {successful}/{total} features successful")

    except Exception as e:
        logger.error(f"Bulk documentation generation failed: {e}")


@router.get("/status")
async def get_documentation_status():
    """Get overall documentation status."""
    try:
        registry = memory_documentation_service.get_feature_registry()
        freshness_report = documentation_maintenance_scheduler.get_freshness_report()

        features_status = []
        for feature_id, feature in registry.items():
            history = memory_documentation_service.get_generation_history(feature_id)
            total_docs = sum(len(result.memory_entries) for result in history.get(feature_id, []))

            features_status.append({
                "feature_id": feature_id,
                "name": feature.name,
                "documentation_status": feature.documentation_status.value,
                "last_updated": feature.last_updated.isoformat(),
                "total_documents": total_docs,
                "up_to_date": feature.documentation_status.value == "completed"
            })

        return {
            "overall_status": freshness_report.to_dict(),
            "features": features_status,
            "maintenance_status": {
                "scheduler_running": documentation_maintenance_scheduler.is_running,
                "last_maintenance_run": documentation_maintenance_scheduler.get_maintenance_history(1)[0].timestamp.isoformat()
                if documentation_maintenance_scheduler.get_maintenance_history(1) else None
            }
        }

    except Exception as e:
        logger.error(f"Failed to get documentation status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")


@router.get("/features")
async def get_features():
    """Get list of all registered features."""
    try:
        registry = memory_documentation_service.get_feature_registry()
        return {
            "features": [feature.to_dict() for feature in registry.values()],
            "total": len(registry)
        }

    except Exception as e:
        logger.error(f"Failed to get features: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get features: {str(e)}")


@router.get("/features/{feature_id}")
async def get_feature_details(feature_id: str):
    """Get detailed information about a specific feature."""
    try:
        registry = memory_documentation_service.get_feature_registry()
        if feature_id not in registry:
            raise HTTPException(status_code=404, detail=f"Feature '{feature_id}' not found")

        feature = registry[feature_id]
        history = memory_documentation_service.get_generation_history(feature_id)

        return {
            "feature": feature.to_dict(),
            "generation_history": [result.to_dict() for result in history.get(feature_id, [])],
            "total_generations": len(history.get(feature_id, []))
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get feature details for {feature_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get feature details: {str(e)}")


@router.post("/maintenance/{task}")
async def run_maintenance_task(task: str, background_tasks: BackgroundTasks):
    """Run a specific maintenance task."""
    try:
        # Validate task
        try:
            maintenance_task = MaintenanceTask(task)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid maintenance task: {task}")

        # Run maintenance task in background
        background_tasks.add_task(_run_maintenance_background, maintenance_task)

        return {
            "message": f"Maintenance task '{task}' started",
            "task": task,
            "status": "running",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start maintenance task {task}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start maintenance task: {str(e)}")


async def _run_maintenance_background(task: MaintenanceTask):
    """Background task for maintenance operations."""
    try:
        result = await documentation_maintenance_scheduler.run_manual_maintenance(task)
        logger.info(f"Manual maintenance task completed: {task.value} - {result.status}")

    except Exception as e:
        logger.error(f"Manual maintenance task failed: {task.value} - {e}")


@router.get("/maintenance/history")
async def get_maintenance_history(limit: int = 20):
    """Get maintenance task history."""
    try:
        history = documentation_maintenance_scheduler.get_maintenance_history(limit)
        return {
            "history": [result.to_dict() for result in history],
            "total": len(history)
        }

    except Exception as e:
        logger.error(f"Failed to get maintenance history: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get maintenance history: {str(e)}")


@router.post("/search", response_model=List[Dict[str, Any]])
async def search_documentation(request: SearchRequest):
    """Search documentation using semantic search."""
    try:
        results = await memory_documentation_service.search_documentation(
            request.query,
            request.feature_filter
        )

        # Format results for API response
        formatted_results = []
        for memory_entry in results[:request.limit]:
            formatted_results.append({
                "id": memory_entry.memory_id,
                "content": memory_entry.content[:500] + "..." if len(memory_entry.content) > 500 else memory_entry.content,
                "type": memory_entry.memory_type.value,
                "feature": memory_entry.context.get("feature_id", "unknown"),
                "component": memory_entry.context.get("component", "unknown"),
                "last_updated": memory_entry.timestamp.isoformat(),
                "source": memory_entry.source,
                "relevance_score": memory_entry.context.get("relevance_score", 0.0)
            })

        return formatted_results

    except Exception as e:
        logger.error(f"Failed to search documentation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to search documentation: {str(e)}")


@router.post("/export")
async def export_documentation(base_path: str = "docs/memory"):
    """Export memory documentation to markdown files."""
    try:
        exported_count = await memory_documentation_service.export_documentation_to_files(base_path)

        return {
            "message": f"Successfully exported {exported_count} documentation files",
            "export_path": base_path,
            "files_exported": exported_count,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to export documentation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to export documentation: {str(e)}")


@router.get("/freshness")
async def get_freshness_report():
    """Get documentation freshness report."""
    try:
        report = documentation_maintenance_scheduler.get_freshness_report()
        return report.to_dict()

    except Exception as e:
        logger.error(f"Failed to get freshness report: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get freshness report: {str(e)}")


@router.post("/validate")
async def validate_documentation():
    """Validate documentation accuracy and completeness."""
    try:
        outdated_features = await memory_documentation_service.validate_documentation_freshness()

        validation_results = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "overall_status": "valid" if not outdated_features else "needs_attention",
            "issues_found": len(outdated_features),
            "outdated_features": outdated_features
        }

        return validation_results

    except Exception as e:
        logger.error(f"Failed to validate documentation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to validate documentation: {str(e)}")


@router.get("/stats")
async def get_documentation_stats():
    """Get comprehensive documentation statistics."""
    try:
        registry = memory_documentation_service.get_feature_registry()
        history = memory_documentation_service.get_generation_history()

        total_features = len(registry)
        documented_features = sum(1 for f in registry.values() if f.documentation_status.value == "completed")
        total_memory_entries = sum(
            len(result.memory_entries)
            for feature_history in history.values()
            for result in feature_history
        )

        freshness_report = documentation_maintenance_scheduler.get_freshness_report()

        return {
            "features": {
                "total": total_features,
                "documented": documented_features,
                "coverage_percentage": (documented_features / total_features * 100) if total_features > 0 else 0
            },
            "memory_entries": {
                "total": total_memory_entries,
                "average_per_feature": total_memory_entries / total_features if total_features > 0 else 0
            },
            "freshness": freshness_report.to_dict(),
            "maintenance": {
                "scheduler_active": documentation_maintenance_scheduler.is_running,
                "last_activity": documentation_maintenance_scheduler.get_maintenance_history(1)[0].timestamp.isoformat()
                if documentation_maintenance_scheduler.get_maintenance_history(1) else None
            }
        }

    except Exception as e:
        logger.error(f"Failed to get documentation stats: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get documentation stats: {str(e)}")


@router.delete("/cache")
async def clear_documentation_cache():
    """Clear documentation cache (for development/debugging)."""
    try:
        # This would clear any cached documentation data
        # In a real implementation, this might clear Redis cache or in-memory caches

        return {
            "message": "Documentation cache cleared",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to clear documentation cache: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")