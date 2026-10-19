"""
Documentation Maintenance System
Automated monitoring, updating, and validation of documentation freshness
"""

import asyncio
import os
from typing import Dict, List, Any, Optional, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum

from core.memory_documentation import memory_documentation_service, DocumentationResult, DocumentationStatus
from core.memory_store import MemoryQuery
from core.structured_logging import get_structured_logger

logger = get_structured_logger("documentation_maintenance")


class MaintenanceTask(Enum):
    """Types of maintenance tasks."""
    FRESHNESS_CHECK = "freshness_check"
    VALIDATION = "validation"
    UPDATE = "update"
    BACKUP = "backup"
    CROSS_REFERENCE_CHECK = "cross_reference_check"


@dataclass
class MaintenanceResult:
    """Result of a maintenance operation."""
    task: MaintenanceTask
    status: str  # "success", "warning", "error"
    message: str
    affected_items: int = 0
    details: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "task": self.task.value,
            "status": self.status,
            "message": self.message,
            "affected_items": self.affected_items,
            "details": self.details,
            "timestamp": self.timestamp.isoformat()
        }


@dataclass
class FreshnessReport:
    """Report on documentation freshness."""
    total_documents: int
    up_to_date: int
    outdated: int
    missing: int
    average_age_days: float
    oldest_document_days: int
    freshness_score: float  # 0-100

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "total_documents": self.total_documents,
            "up_to_date": self.up_to_date,
            "outdated": self.outdated,
            "missing": self.missing,
            "average_age_days": self.average_age_days,
            "oldest_document_days": self.oldest_document_days,
            "freshness_score": self.freshness_score
        }


class DocumentationMaintenanceScheduler:
    """Automated scheduler for documentation maintenance tasks."""

    def __init__(self):
        self.logger = get_structured_logger("docs_maintenance")
        self.maintenance_history: List[MaintenanceResult] = []
        self.is_running = False
        self.task_handle: Optional[asyncio.Task] = None

        # Maintenance schedules (in seconds)
        self.schedules = {
            MaintenanceTask.FRESHNESS_CHECK: 3600,  # Every hour
            MaintenanceTask.VALIDATION: 86400,      # Daily
            MaintenanceTask.UPDATE: 604800,         # Weekly
            MaintenanceTask.BACKUP: 86400,          # Daily
            MaintenanceTask.CROSS_REFERENCE_CHECK: 3600  # Every hour
        }

    async def start(self):
        """Start the maintenance scheduler."""
        if self.is_running:
            return

        self.is_running = True
        self.task_handle = asyncio.create_task(self._maintenance_loop())
        self.logger.info("Documentation maintenance scheduler started")

    async def stop(self):
        """Stop the maintenance scheduler."""
        self.is_running = False
        if self.task_handle:
            self.task_handle.cancel()
            try:
                await self.task_handle
            except asyncio.CancelledError:
                pass
        self.logger.info("Documentation maintenance scheduler stopped")

    async def _maintenance_loop(self):
        """Main maintenance loop."""
        last_runs = {task: datetime.min.replace(tzinfo=timezone.utc) for task in MaintenanceTask}

        while self.is_running:
            try:
                current_time = datetime.now(timezone.utc)

                # Check each maintenance task
                for task in MaintenanceTask:
                    schedule_seconds = self.schedules[task]
                    last_run = last_runs[task]
                    time_since_last_run = (current_time - last_run).total_seconds()

                    if time_since_last_run >= schedule_seconds:
                        # Run the maintenance task
                        result = await self._run_maintenance_task(task)
                        self.maintenance_history.append(result)
                        last_runs[task] = current_time

                        # Keep only recent history
                        if len(self.maintenance_history) > 1000:
                            self.maintenance_history = self.maintenance_history[-500:]

                # Sleep for a minute before next check
                await asyncio.sleep(60)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Maintenance loop error: {e}")
                await asyncio.sleep(300)  # Wait 5 minutes on error

    async def _run_maintenance_task(self, task: MaintenanceTask) -> MaintenanceResult:
        """Run a specific maintenance task."""
        try:
            if task == MaintenanceTask.FRESHNESS_CHECK:
                result = await self._check_documentation_freshness()
            elif task == MaintenanceTask.VALIDATION:
                result = await self._validate_documentation()
            elif task == MaintenanceTask.UPDATE:
                result = await self._update_outdated_documentation()
            elif task == MaintenanceTask.BACKUP:
                result = await self._backup_documentation()
            elif task == MaintenanceTask.CROSS_REFERENCE_CHECK:
                result = await self._check_cross_references()
            else:
                result = MaintenanceResult(
                    task=task,
                    status="error",
                    message=f"Unknown maintenance task: {task.value}"
                )

            self.logger.info(f"Completed maintenance task {task.value}: {result.status}")
            return result

        except Exception as e:
            self.logger.error(f"Failed to run maintenance task {task.value}: {e}")
            return MaintenanceResult(
                task=task,
                status="error",
                message=f"Task failed: {str(e)}"
            )

    async def _check_documentation_freshness(self) -> MaintenanceResult:
        """Check if documentation is up to date."""
        try:
            outdated_features = await memory_documentation_service.validate_documentation_freshness()

            total_outdated = len(outdated_features)
            if total_outdated > 0:
                message = f"Found {total_outdated} features with outdated documentation"
                status = "warning"
            else:
                message = "All documentation is up to date"
                status = "success"

            return MaintenanceResult(
                task=MaintenanceTask.FRESHNESS_CHECK,
                status=status,
                message=message,
                affected_items=total_outdated,
                details={"outdated_features": list(outdated_features.keys())}
            )

        except Exception as e:
            return MaintenanceResult(
                task=MaintenanceTask.FRESHNESS_CHECK,
                status="error",
                message=f"Freshness check failed: {str(e)}"
            )

    async def _validate_documentation(self) -> MaintenanceResult:
        """Validate documentation accuracy and completeness."""
        try:
            validation_errors = []
            features = memory_documentation_service.get_feature_registry()

            for feature_id, feature in features.items():
                # Check if feature has required documentation
                if not hasattr(feature, 'documentation_status'):
                    validation_errors.append(f"Feature {feature_id} missing documentation_status")
                    continue

                if feature.documentation_status not in [DocumentationStatus.COMPLETED]:
                    validation_errors.append(f"Feature {feature_id} documentation not complete")

            if validation_errors:
                return MaintenanceResult(
                    task=MaintenanceTask.VALIDATION,
                    status="warning",
                    message=f"Found {len(validation_errors)} validation issues",
                    affected_items=len(validation_errors),
                    details={"validation_errors": validation_errors}
                )
            else:
                return MaintenanceResult(
                    task=MaintenanceTask.VALIDATION,
                    status="success",
                    message="All documentation passed validation"
                )

        except Exception as e:
            return MaintenanceResult(
                task=MaintenanceTask.VALIDATION,
                status="error",
                message=f"Validation failed: {str(e)}"
            )

    async def _update_outdated_documentation(self) -> MaintenanceResult:
        """Update documentation that is outdated."""
        try:
            outdated_features = await memory_documentation_service.validate_documentation_freshness()
            updated_count = 0

            for feature_id in outdated_features.keys():
                try:
                    result = await memory_documentation_service.generate_feature_documentation(feature_id)
                    if result.status == DocumentationStatus.COMPLETED:
                        updated_count += 1
                        self.logger.info(f"Updated documentation for feature: {feature_id}")
                    else:
                        self.logger.warning(f"Failed to update documentation for {feature_id}: {result.errors}")
                except Exception as e:
                    self.logger.error(f"Error updating documentation for {feature_id}: {e}")

            return MaintenanceResult(
                task=MaintenanceTask.UPDATE,
                status="success" if updated_count > 0 else "warning",
                message=f"Updated documentation for {updated_count} features",
                affected_items=updated_count,
                details={"updated_features": list(outdated_features.keys())[:updated_count]}
            )

        except Exception as e:
            return MaintenanceResult(
                task=MaintenanceTask.UPDATE,
                status="error",
                message=f"Update failed: {str(e)}"
            )

    async def _backup_documentation(self) -> MaintenanceResult:
        """Create backup of documentation."""
        try:
            # Export documentation to files
            exported_count = await memory_documentation_service.export_documentation_to_files()

            # In a real implementation, this would also create backups to cloud storage
            # or other persistent storage systems

            return MaintenanceResult(
                task=MaintenanceTask.BACKUP,
                status="success",
                message=f"Backed up {exported_count} documentation files",
                affected_items=exported_count
            )

        except Exception as e:
            return MaintenanceResult(
                task=MaintenanceTask.BACKUP,
                status="error",
                message=f"Backup failed: {str(e)}"
            )

    async def _check_cross_references(self) -> MaintenanceResult:
        """Check cross-references between documentation."""
        try:
            broken_references = []
            features = memory_documentation_service.get_feature_registry()

            for feature_id, feature in features.items():
                # Check if referenced dependencies exist
                for dependency in feature.dependencies:
                    if dependency not in features and not self._is_system_dependency(dependency):
                        broken_references.append({
                            "feature": feature_id,
                            "broken_dependency": dependency
                        })

            if broken_references:
                return MaintenanceResult(
                    task=MaintenanceTask.CROSS_REFERENCE_CHECK,
                    status="warning",
                    message=f"Found {len(broken_references)} broken cross-references",
                    affected_items=len(broken_references),
                    details={"broken_references": broken_references}
                )
            else:
                return MaintenanceResult(
                    task=MaintenanceTask.CROSS_REFERENCE_CHECK,
                    status="success",
                    message="All cross-references are valid"
                )

        except Exception as e:
            return MaintenanceResult(
                task=MaintenanceTask.CROSS_REFERENCE_CHECK,
                status="error",
                message=f"Cross-reference check failed: {str(e)}"
            )

    def _is_system_dependency(self, dependency: str) -> bool:
        """Check if a dependency is a system-level component."""
        system_deps = {
            "memory_store", "oauth_manager", "webhook_handler",
            "predictive_analytics", "resource_optimizer", "scoring_engine",
            "intervention_manager"
        }
        return dependency in system_deps

    def get_maintenance_history(self, limit: int = 50) -> List[MaintenanceResult]:
        """Get recent maintenance history."""
        return self.maintenance_history[-limit:]

    def get_freshness_report(self) -> FreshnessReport:
        """Generate a comprehensive freshness report."""
        features = memory_documentation_service.get_feature_registry()
        total_docs = len(features)
        up_to_date = sum(1 for f in features.values() if f.documentation_status == DocumentationStatus.COMPLETED)
        outdated = sum(1 for f in features.values() if f.documentation_status == DocumentationStatus.OUTDATED)
        missing = sum(1 for f in features.values() if f.documentation_status == DocumentationStatus.PENDING)

        # Calculate ages (simplified)
        current_time = datetime.now(timezone.utc)
        ages = [(current_time - f.last_updated).days for f in features.values()]
        average_age = sum(ages) / len(ages) if ages else 0
        oldest_age = max(ages) if ages else 0

        # Freshness score (0-100, higher is better)
        freshness_score = max(0, 100 - (average_age * 2))  # Simple scoring

        return FreshnessReport(
            total_documents=total_docs,
            up_to_date=up_to_date,
            outdated=outdated,
            missing=missing,
            average_age_days=average_age,
            oldest_document_days=oldest_age,
            freshness_score=freshness_score
        )

    async def run_manual_maintenance(self, task: MaintenanceTask) -> MaintenanceResult:
        """Run a maintenance task manually."""
        self.logger.info(f"Running manual maintenance task: {task.value}")
        result = await self._run_maintenance_task(task)
        self.maintenance_history.append(result)
        return result


# Global maintenance scheduler instance
documentation_maintenance_scheduler = DocumentationMaintenanceScheduler()