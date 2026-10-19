"""
Memory Documentation Generation System
Automated generation and maintenance of comprehensive feature documentation
"""

import asyncio
import json
import os
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import hashlib

from core.memory_store import VectorMemoryStore, MemoryEntry, MemoryType, MemoryQuery
from core.structured_logging import get_structured_logger

logger = get_structured_logger("memory_documentation")


class DocumentationType(Enum):
    """Types of documentation that can be generated."""
    FEATURE_OVERVIEW = "feature_overview"
    ARCHITECTURE = "architecture"
    API_REFERENCE = "api_reference"
    IMPLEMENTATION = "implementation"
    INTEGRATION_GUIDE = "integration_guide"
    TROUBLESHOOTING = "troubleshooting"
    MAINTENANCE = "maintenance"


class DocumentationStatus(Enum):
    """Status of documentation generation."""
    PENDING = "pending"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"
    OUTDATED = "outdated"


@dataclass
class DocumentationTemplate:
    """Template for generating documentation."""
    type: DocumentationType
    name: str
    description: str
    sections: List[str]
    required_fields: List[str] = field(default_factory=list)
    optional_fields: List[str] = field(default_factory=list)

    def validate_content(self, content: Dict[str, Any]) -> List[str]:
        """Validate that content meets template requirements."""
        errors = []

        # Check required fields
        for field in self.required_fields:
            if field not in content:
                errors.append(f"Missing required field: {field}")

        # Check required sections
        for section in self.sections:
            if section not in content.get('sections', {}):
                errors.append(f"Missing required section: {section}")

        return errors


@dataclass
class FeatureDefinition:
    """Definition of a feature for documentation."""
    id: str
    name: str
    description: str
    version: str
    components: List[str]
    apis: List[str]
    dependencies: List[str]
    maintainers: List[str]
    directory_path: str
    last_updated: datetime
    documentation_status: DocumentationStatus = DocumentationStatus.PENDING

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "components": self.components,
            "apis": self.apis,
            "dependencies": self.dependencies,
            "maintainers": self.maintainers,
            "directory_path": self.directory_path,
            "last_updated": self.last_updated.isoformat(),
            "documentation_status": self.documentation_status.value
        }


@dataclass
class DocumentationResult:
    """Result of documentation generation."""
    feature_id: str
    documentation_type: DocumentationType
    memory_entries: List[MemoryEntry]
    status: DocumentationStatus
    errors: List[str] = field(default_factory=list)
    generated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "feature_id": self.feature_id,
            "documentation_type": self.documentation_type.value,
            "memory_entries_count": len(self.memory_entries),
            "status": self.status.value,
            "errors": self.errors,
            "generated_at": self.generated_at.isoformat()
        }


class MemoryDocumentationService:
    """Service for generating and maintaining memory-based documentation."""

    def __init__(self, memory_store: VectorMemoryStore):
        self.memory_store = memory_store
        self.logger = get_structured_logger("memory_docs_service")

        # Initialize components
        self.templates = self._load_documentation_templates()
        self.feature_registry = self._load_feature_registry()
        self.generation_history: Dict[str, List[DocumentationResult]] = {}

        # Create documentation directories
        self._ensure_directory_structure()

    def _load_documentation_templates(self) -> Dict[str, DocumentationTemplate]:
        """Load documentation templates."""
        templates = {}

        # Feature Overview Template
        templates["feature_overview"] = DocumentationTemplate(
            type=DocumentationType.FEATURE_OVERVIEW,
            name="Feature Overview",
            description="High-level overview of a feature including purpose, architecture, and usage",
            sections=["overview", "architecture", "components", "apis", "usage", "maintenance"],
            required_fields=["name", "description", "version", "components"],
            optional_fields=["dependencies", "maintainers", "changelog"]
        )

        # API Reference Template
        templates["api_reference"] = DocumentationTemplate(
            type=DocumentationType.API_REFERENCE,
            name="API Reference",
            description="Detailed API endpoint documentation with examples and error handling",
            sections=["endpoint", "method", "parameters", "responses", "examples", "error_handling"],
            required_fields=["endpoint", "method", "responses"],
            optional_fields=["examples", "rate_limits", "authentication"]
        )

        # Architecture Template
        templates["architecture"] = DocumentationTemplate(
            type=DocumentationType.ARCHITECTURE,
            name="Architecture Documentation",
            description="Technical architecture and design decisions",
            sections=["overview", "components", "data_flow", "scalability", "security"],
            required_fields=["overview", "components"],
            optional_fields=["diagrams", "performance_characteristics", "deployment_considerations"]
        )

        # Implementation Template
        templates["implementation"] = DocumentationTemplate(
            type=DocumentationType.IMPLEMENTATION,
            name="Implementation Guide",
            description="Detailed implementation instructions and code examples",
            sections=["setup", "configuration", "usage", "examples", "troubleshooting"],
            required_fields=["setup", "usage"],
            optional_fields=["configuration", "examples", "common_issues"]
        )

        return templates

    def _load_feature_registry(self) -> Dict[str, FeatureDefinition]:
        """Load the feature registry with current implemented features."""
        features = {}

        # SaaS Integration Feature
        features["saas_integration"] = FeatureDefinition(
            id="saas_integration",
            name="SaaS Integration",
            description="Connect and manage external SaaS platforms with real-time synchronization",
            version="1.0.0",
            components=["OAuthConnector", "SaaSConnector", "ConnectorManager", "WebhookHandler"],
            apis=["/api/saas/connectors", "/api/saas/webhooks", "/api/saas/sync"],
            dependencies=["memory_store", "oauth_manager", "webhook_handler"],
            maintainers=["platform_team"],
            directory_path="docs/memory/features/saas-integration/",
            last_updated=datetime.now(timezone.utc)
        )

        # Predictive Automation Feature
        features["predictive_automation"] = FeatureDefinition(
            id="predictive_automation",
            name="Predictive Automation",
            description="AI-powered failure prediction, resource optimization, and workflow intelligence",
            version="1.0.0",
            components=["PredictiveAnalyticsEngine", "ResourceOptimizer", "WorkflowOptimizer", "PredictiveService"],
            apis=["/api/predictive/health", "/api/predictive/observations", "/api/predictive/predictions"],
            dependencies=["memory_store", "predictive_analytics", "resource_optimizer"],
            maintainers=["ai_team"],
            directory_path="docs/memory/features/predictive-automation/",
            last_updated=datetime.now(timezone.utc)
        )

        # User Experience Feature
        features["user_experience"] = FeatureDefinition(
            id="user_experience",
            name="User Experience Enhancement",
            description="Advanced user activity scoring, intervention management, and A/B testing",
            version="1.0.0",
            components=["ScoringRuleForm", "InterventionsManager", "ABTestFramework", "EnhancedScoringDashboard"],
            apis=["/api/scoring/observations", "/api/scoring/interventions", "/api/scoring/ab-tests"],
            dependencies=["memory_store", "scoring_engine", "intervention_manager"],
            maintainers=["ux_team"],
            directory_path="docs/memory/features/user-experience/",
            last_updated=datetime.now(timezone.utc)
        )

        # Agency Intelligence Feature [NEW]
        features["agency_intelligence"] = FeatureDefinition(
            id="agency_intelligence",
            name="Agency Intelligence",
            description="Strategic knowledge curation, lesson learned extraction, and semantic enrichment across missions",
            version="1.1.0",
            components=["KnowledgeService", "LessonCurator", "SemanticGraph3D", "IntelligenceHub"],
            apis=["/api/knowledge/curate", "/api/knowledge/topics", "/api/knowledge/graph"],
            dependencies=["memory_store", "knowledge_engine", "vector_search"],
            maintainers=["intelligence_team"],
            directory_path="docs/memory/features/agency-intelligence/",
            last_updated=datetime.now(timezone.utc)
        )

        # Triage Center (Rescue 2.0) Feature [NEW]
        features["triage_center"] = FeatureDefinition(
            id="triage_center",
            name="Triage Center (Rescue 2.0)",
            description="Autonomous mission failure recovery, triage automation, and HIL intervention protocols",
            version="2.0.0",
            components=["RescueService", "TriageGenerator", "InterventionDetailDialog", "RecoveryStrategyApplier"],
            apis=["/api/rescue/initiate", "/api/rescue/triage", "/api/rescue/execute"],
            dependencies=["mission_run_service", "approval_service", "agent_service"],
            maintainers=["reliability_team"],
            directory_path="docs/memory/features/triage-center/",
            last_updated=datetime.now(timezone.utc)
        )

        return features

    def _ensure_directory_structure(self):
        """Ensure the documentation directory structure exists."""
        base_dirs = [
            "docs/memory",
            "docs/memory/features",
            "docs/memory/features/saas-integration",
            "docs/memory/features/saas-integration/connectors",
            "docs/memory/features/saas-integration/webhooks",
            "docs/memory/features/saas-integration/sync",
            "docs/memory/features/saas-integration/apis",
            "docs/memory/features/predictive-automation",
            "docs/memory/features/predictive-automation/failure-prediction",
            "docs/memory/features/predictive-automation/resource-optimization",
            "docs/memory/features/predictive-automation/workflow-intelligence",
            "docs/memory/features/predictive-automation/apis",
            "docs/memory/features/user-experience",
            "docs/memory/features/user-experience/scoring-system",
            "docs/memory/features/user-experience/interventions",
            "docs/memory/features/user-experience/apis",
            "docs/memory/features/agency-intelligence",
            "docs/memory/features/agency-intelligence/curation",
            "docs/memory/features/agency-intelligence/graph",
            "docs/memory/features/agency-intelligence/apis",
            "docs/memory/features/triage-center",
            "docs/memory/features/triage-center/triage",
            "docs/memory/features/triage-center/interventions",
            "docs/memory/features/triage-center/apis",
            "docs/memory/architecture",
            "docs/memory/apis",
            "docs/memory/guides",
            "docs/memory/tools",
            "docs/memory/tools/generators",
            "docs/memory/tools/validators",
            "docs/memory/tools/maintenance-scripts"
        ]

        for dir_path in base_dirs:
            os.makedirs(dir_path, exist_ok=True)

    async def generate_feature_documentation(self, feature_id: str) -> DocumentationResult:
        """Generate comprehensive documentation for a feature."""
        try:
            if feature_id not in self.feature_registry:
                raise ValueError(f"Feature '{feature_id}' not found in registry")

            feature = self.feature_registry[feature_id]
            feature.documentation_status = DocumentationStatus.GENERATING

            self.logger.info(f"Generating documentation for feature: {feature_id}")

            # Generate different types of documentation
            memory_entries = []

            # Feature overview
            overview_entries = await self._generate_feature_overview(feature)
            memory_entries.extend(overview_entries)

            # Component documentation
            component_entries = await self._generate_component_documentation(feature)
            memory_entries.extend(component_entries)

            # API documentation
            api_entries = await self._generate_api_documentation(feature)
            memory_entries.extend(api_entries)

            # Architecture documentation
            arch_entries = await self._generate_architecture_documentation(feature)
            memory_entries.extend(arch_entries)

            # Implementation guides
            impl_entries = await self._generate_implementation_guides(feature)
            memory_entries.extend(impl_entries)

            # Store generation result
            result = DocumentationResult(
                feature_id=feature_id,
                documentation_type=DocumentationType.FEATURE_OVERVIEW,
                memory_entries=memory_entries,
                status=DocumentationStatus.COMPLETED
            )

            if feature_id not in self.generation_history:
                self.generation_history[feature_id] = []
            self.generation_history[feature_id].append(result)

            # Update feature status
            feature.documentation_status = DocumentationStatus.COMPLETED
            feature.last_updated = datetime.now(timezone.utc)

            self.logger.info(f"Generated {len(memory_entries)} documentation entries for {feature_id}")

            return result

        except Exception as e:
            self.logger.error(f"Failed to generate documentation for {feature_id}: {e}")

            # Update feature status on failure
            if feature_id in self.feature_registry:
                self.feature_registry[feature_id].documentation_status = DocumentationStatus.FAILED

            return DocumentationResult(
                feature_id=feature_id,
                documentation_type=DocumentationType.FEATURE_OVERVIEW,
                memory_entries=[],
                status=DocumentationStatus.FAILED,
                errors=[str(e)]
            )

    async def _generate_feature_overview(self, feature: FeatureDefinition) -> List[MemoryEntry]:
        """Generate feature overview documentation."""
        entries = []

        # Main feature overview
        content = f"""
# {feature.name}

{feature.description}

## Overview

**Version:** {feature.version}
**Last Updated:** {feature.last_updated.strftime('%Y-%m-%d')}
**Maintainers:** {', '.join(feature.maintainers)}

## Key Components

{chr(10).join(f'- {component}' for component in feature.components)}

## APIs

{chr(10).join(f'- `{api}`' for api in feature.apis)}

## Dependencies

{chr(10).join(f'- {dep}' for dep in feature.dependencies)}
"""

        entry = MemoryEntry(
            content=content,
            memory_type=MemoryType.FACT,
            context={
                "feature_id": feature.id,
                "documentation_type": "feature_overview",
                "directory_path": f"{feature.directory_path}README.md",
                "sections": ["overview", "components", "apis", "dependencies"],
                "version": feature.version,
                "last_updated": feature.last_updated.isoformat()
            },
            source=f"feature_docs_{feature.id}"
        )

        entries.append(entry)

        # Store in memory
        await self.memory_store.store_memory(
            content=entry.content,
            memory_type=entry.memory_type,
            context=entry.context,
            source=entry.source
        )

        return entries

    async def _generate_component_documentation(self, feature: FeatureDefinition) -> List[MemoryEntry]:
        """Generate documentation for individual components."""
        entries = []

        for component in feature.components:
            content = f"""
# Component: {component}

## Overview

Component `{component}` is part of the {feature.name} feature.

## Purpose

This component provides [specific functionality to be documented based on actual implementation].

## Configuration

[Configuration options and parameters]

## Usage

[Code examples and usage patterns]

## Dependencies

[Internal and external dependencies]
"""

            entry = MemoryEntry(
                content=content,
                memory_type=MemoryType.FACT,
                context={
                    "feature_id": feature.id,
                    "component": component,
                    "documentation_type": "component",
                    "directory_path": f"{feature.directory_path}components/{component.lower()}.md",
                    "sections": ["overview", "purpose", "configuration", "usage", "dependencies"]
                },
                source=f"feature_docs_{feature.id}"
            )

            entries.append(entry)

            # Store in memory
            await self.memory_store.store_memory(
                content=entry.content,
                memory_type=entry.memory_type,
                context=entry.context,
                source=entry.source
            )

        return entries

    async def _generate_api_documentation(self, feature: FeatureDefinition) -> List[MemoryEntry]:
        """Generate API documentation."""
        entries = []

        for api_endpoint in feature.apis:
            content = f"""
# API: {api_endpoint}

## Endpoint

`{api_endpoint}`

## Methods

[HTTP methods supported]

## Parameters

[Request parameters and their types]

## Responses

[Response formats and status codes]

## Examples

[Usage examples with curl or code]

## Error Handling

[Common errors and how to handle them]
"""

            entry = MemoryEntry(
                content=content,
                memory_type=MemoryType.FACT,
                context={
                    "feature_id": feature.id,
                    "api_endpoint": api_endpoint,
                    "documentation_type": "api_reference",
                    "directory_path": f"{feature.directory_path}apis/{api_endpoint.replace('/', '_').strip('_')}.md",
                    "sections": ["endpoint", "methods", "parameters", "responses", "examples", "error_handling"]
                },
                source=f"feature_docs_{feature.id}"
            )

            entries.append(entry)

            # Store in memory
            await self.memory_store.store_memory(
                content=entry.content,
                memory_type=entry.memory_type,
                context=entry.context,
                source=entry.source
            )

        return entries

    async def _generate_architecture_documentation(self, feature: FeatureDefinition) -> List[MemoryEntry]:
        """Generate architecture documentation."""
        content = f"""
# Architecture: {feature.name}

## System Overview

High-level architecture diagram and component relationships.

## Data Flow

How data flows through the system components.

## Component Interactions

Detailed interactions between components.

## Scalability Considerations

How the system scales and performance characteristics.

## Security Architecture

Security measures and data protection.
"""

        entry = MemoryEntry(
            content=content,
            memory_type=MemoryType.FACT,
            context={
                "feature_id": feature.id,
                "documentation_type": "architecture",
                "directory_path": f"{feature.directory_path}architecture.md",
                "sections": ["overview", "data_flow", "interactions", "scalability", "security"]
            },
            source=f"feature_docs_{feature.id}"
        )

        # Store in memory
        await self.memory_store.store_memory(
            content=entry.content,
            memory_type=entry.memory_type,
            context=entry.context,
            source=entry.source
        )

        return [entry]

    async def _generate_implementation_guides(self, feature: FeatureDefinition) -> List[MemoryEntry]:
        """Generate implementation guides."""
        content = f"""
# Implementation Guide: {feature.name}

## Setup Instructions

Step-by-step setup and installation.

## Configuration

Configuration options and environment variables.

## Basic Usage

Getting started with the feature.

## Advanced Usage

Advanced configuration and customization.

## Troubleshooting

Common issues and their solutions.

## Best Practices

Recommended patterns and practices.
"""

        entry = MemoryEntry(
            content=content,
            memory_type=MemoryType.FACT,
            context={
                "feature_id": feature.id,
                "documentation_type": "implementation_guide",
                "directory_path": f"{feature.directory_path}implementation.md",
                "sections": ["setup", "configuration", "basic_usage", "advanced_usage", "troubleshooting", "best_practices"]
            },
            source=f"feature_docs_{feature.id}"
        )

        # Store in memory
        await self.memory_store.store_memory(
            content=entry.content,
            memory_type=entry.memory_type,
            context=entry.context,
            source=entry.source
        )

        return [entry]

    async def generate_all_feature_documentation(self) -> Dict[str, DocumentationResult]:
        """Generate documentation for all registered features."""
        results = {}

        for feature_id in self.feature_registry.keys():
            self.logger.info(f"Generating documentation for feature: {feature_id}")
            result = await self.generate_feature_documentation(feature_id)
            results[feature_id] = result

            # Small delay to prevent overwhelming the system
            await asyncio.sleep(0.1)

        return results

    async def validate_documentation_freshness(self) -> Dict[str, List[str]]:
        """Validate that documentation is up to date with code changes."""
        outdated_docs = {}

        for feature_id, feature in self.feature_registry.items():
            # Check if feature code has been modified more recently than docs
            # This is a simplified check - in production, you'd compare git timestamps
            code_last_modified = datetime.now(timezone.utc) - timedelta(days=1)  # Mock

            if code_last_modified > feature.last_updated:
                outdated_docs[feature_id] = [
                    f"Documentation last updated: {feature.last_updated.strftime('%Y-%m-%d')}",
                    f"Code last modified: {code_last_modified.strftime('%Y-%m-%d')}"
                ]

        return outdated_docs

    async def search_documentation(self, query: str, feature_filter: Optional[str] = None) -> List[MemoryEntry]:
        """Search documentation using semantic search."""
        search_query = MemoryQuery(
            query=query,
            limit=20,
            metadata_filter={"documentation_type": {"$exists": True}} if not feature_filter
                            else {"feature_id": feature_filter, "documentation_type": {"$exists": True}}
        )

        results, _ = await self.memory_store.search_memories(search_query)
        return [entry for entry, _ in results]

    def get_feature_registry(self) -> Dict[str, FeatureDefinition]:
        """Get the current feature registry."""
        return self.feature_registry.copy()

    def get_generation_history(self, feature_id: Optional[str] = None) -> Dict[str, List[DocumentationResult]]:
        """Get documentation generation history."""
        if feature_id:
            return {feature_id: self.generation_history.get(feature_id, [])}
        return self.generation_history.copy()

    async def export_documentation_to_files(self, base_path: str = "docs/memory"):
        """Export memory documentation to markdown files."""
        exported_count = 0

        for feature_id, feature in self.feature_registry.items():
            # Export feature overview
            overview_path = os.path.join(base_path, feature.directory_path, "README.md")
            os.makedirs(os.path.dirname(overview_path), exist_ok=True)

            # Get overview documentation from memory
            overview_docs = await self.search_documentation(
                f"feature overview {feature.name}",
                feature_id
            )

            if overview_docs:
                with open(overview_path, 'w') as f:
                    f.write(overview_docs[0].content)
                exported_count += 1

        self.logger.info(f"Exported {exported_count} documentation files")
        return exported_count


# Import memory store instance
from core.memory_store import memory_store

# Global documentation service instance
memory_documentation_service = MemoryDocumentationService(memory_store)