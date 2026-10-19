"""
acdd.core.schema
================

Unified data model for the bi-directional Capability & Documentation
Synchronization Engine.

A single :class:`CapabilityManifest` is the absolute source of truth shared by
both directions of the pipeline:

* **Code → Docs** (:mod:`acdd.core.code_to_docs`) builds a manifest from runtime
  reflection or a visual-canvas save, then compiles it to Markdown.
* **Docs → Code** (:mod:`acdd.core.docs_to_code`) parses Markdown back into a
  manifest and registers it into the live vector router.

The manifest deliberately carries *both* engineering fields (``technical_spec``,
``runtime_context``) and human/business fields (``documentation_meta``) so the
two representations can never diverge structurally. Everything is Pydantic v2 for
strict runtime validation and static typing.
"""

from __future__ import annotations

import hashlib
import json
import re
from enum import Enum
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

__all__ = [
    "CAPABILITY_ID_PATTERN",
    "CAPABILITY_VERSION_PATTERN",
    "CapabilityCategory",
    "RiskProfile",
    "ExecutionEnvironment",
    "Metadata",
    "TechnicalSpec",
    "DocumentationMeta",
    "RuntimeContext",
    "CapabilityManifest",
    "ManifestValidationError",
    "validate_manifest",
]

# A capability_id must be a stable, filesystem- and URL-safe slug. The pattern is
# reused by the git worker to reject path-traversal attempts before writing docs.
CAPABILITY_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z0-9_]+$")
CAPABILITY_VERSION_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)


class _CoercibleStrEnum(str, Enum):
    """Base str-enum that accepts case-insensitive value *or* member-name input."""

    @classmethod
    def _missing_(cls, value: object) -> "_CoercibleStrEnum | None":
        if isinstance(value, str):
            candidate = value.strip().lower()
            for member in cls:
                if member.value.lower() == candidate or member.name.lower() == candidate:
                    return member
        return None


class CapabilityCategory(_CoercibleStrEnum):
    """High-level functional grouping used for documentation and filtering."""

    DATA_OPERATIONS = "Data Operations"
    BROWSER_AUTOMATION = "Browser Automation"
    FINANCIAL_OPERATIONS = "Financial Operations"
    SAAS_CONNECTORS = "SaaS Connectors"
    SYSTEM_UTILITIES = "System Utilities"
    KNOWLEDGE = "Knowledge"
    CUSTOM_JIT = "Custom JIT"


class RiskProfile(_CoercibleStrEnum):
    """Security footprint of a capability. Drives the git branching strategy."""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"

    @property
    def requires_isolation(self) -> bool:
        """High/Critical capabilities must never auto-merge; isolate for review."""
        return self in (RiskProfile.HIGH, RiskProfile.CRITICAL)


class ExecutionEnvironment(_CoercibleStrEnum):
    """Where the capability's code is permitted to run."""

    HOST = "Host"
    ISOLATED_DOCKER = "Isolated Docker Container"
    EPHEMERAL_SANDBOX = "Ephemeral Sandbox"


class Metadata(BaseModel):
    """Human-facing descriptive fields, including ownership tracking."""

    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(min_length=1, description="Human-readable capability name.")
    category: CapabilityCategory
    description: str = Field(min_length=1, description="What the capability does, in prose.")
    owner: str = Field(default="unassigned", description="Team or person accountable for it.")


class TechnicalSpec(BaseModel):
    """Machine-facing I/O contract, keyed by parameter name -> type string."""

    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, str] = Field(default_factory=dict)
    outputs: dict[str, str] = Field(default_factory=dict)


class DocumentationMeta(BaseModel):
    """User-facing documentation fields distinct from the engineering contract."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(default="", description="Short business-readable summary.")
    business_use_cases: list[str] = Field(
        default_factory=list, description="Concrete scenarios the capability serves."
    )
    guardrails: list[str] = Field(
        default_factory=list,
        description="Strict execution constraints rendered as security callouts.",
    )


class RuntimeContext(BaseModel):
    """Operational and security metadata governing how the capability is run."""

    model_config = ConfigDict(extra="forbid")

    risk_profile: RiskProfile = RiskProfile.LOW
    execution_environment: ExecutionEnvironment = ExecutionEnvironment.HOST
    dependencies: list[str] = Field(default_factory=list)


class CapabilityManifest(BaseModel):
    """The normalised, validated description of a single platform capability."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=1, ge=1, description="Manifest contract version.")
    capability_version: str = Field(default="1.0.0", description="Semantic capability version.")
    capability_id: str = Field(description="Stable slug, ^[a-z0-9_]+$.")
    metadata: Metadata
    technical_spec: TechnicalSpec
    documentation_meta: DocumentationMeta = Field(default_factory=DocumentationMeta)
    runtime_context: RuntimeContext = Field(default_factory=RuntimeContext)

    @field_validator("capability_id")
    @classmethod
    def _validate_capability_id(cls, value: str) -> str:
        if not CAPABILITY_ID_PATTERN.match(value):
            raise ValueError(
                f"capability_id {value!r} must match {CAPABILITY_ID_PATTERN.pattern} "
                "(lowercase letters, digits and underscores only)."
            )
        return value

    @field_validator("capability_version")
    @classmethod
    def _validate_capability_version(cls, value: str) -> str:
        if not CAPABILITY_VERSION_PATTERN.match(value):
            raise ValueError("capability_version must be a semantic version such as 1.2.0")
        return value

    # ------------------------------------------------------------------
    # Semantic + serialisation helpers
    # ------------------------------------------------------------------
    def embedding_text(self) -> str:
        """Flatten the manifest into the semantic block used for vector indexing.

        Includes engineering *and* documentation signal so both an agent's
        natural-language problem statement (discovery) and a Markdown paragraph
        (docs-to-code ingestion) retrieve or match the right capability.
        """
        return "\n".join(
            [
                f"Capability ID: {self.capability_id}",
                f"Capability Version: {self.capability_version}",
                f"Manifest Schema Version: {self.schema_version}",
                f"Name: {self.metadata.display_name}",
                f"Category: {self.metadata.category.value}",
                f"Owner: {self.metadata.owner}",
                f"Description: {self.metadata.description}",
                f"Summary: {self.documentation_meta.summary}",
                f"Use Cases: {'; '.join(self.documentation_meta.business_use_cases)}",
                f"Guardrails: {'; '.join(self.documentation_meta.guardrails)}",
                f"Inputs: {json.dumps(self.technical_spec.inputs, sort_keys=True)}",
                f"Outputs: {json.dumps(self.technical_spec.outputs, sort_keys=True)}",
                f"Risk: {self.runtime_context.risk_profile.value}",
                f"Environment: {self.runtime_context.execution_environment.value}",
            ]
        )

    def to_dict(self) -> dict[str, Any]:
        """JSON-serialisable representation (enums rendered as their values)."""
        return self.model_dump(mode="json")

    def to_json(self, *, indent: int = 2) -> str:
        return self.model_dump_json(indent=indent)

    def canonical_json(self) -> str:
        """Stable, whitespace- and order-normalised JSON for hashing/diffing."""
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    def content_hash(self) -> str:
        """SHA-256 of the full canonical manifest — the reconciler's drift key."""
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def signature(self) -> dict[str, Any]:
        """The semantically meaningful subset used to detect *behavioural* drift.

        Excludes purely cosmetic prose (descriptions, summaries) so a reworded
        sentence does not read as a capability change, while a changed input type
        or guardrail does.
        """
        return {
            "capability_id": self.capability_id,
            "category": self.metadata.category.value,
            "inputs": dict(sorted(self.technical_spec.inputs.items())),
            "outputs": dict(sorted(self.technical_spec.outputs.items())),
            "guardrails": sorted(self.documentation_meta.guardrails),
            "risk_profile": self.runtime_context.risk_profile.value,
            "execution_environment": self.runtime_context.execution_environment.value,
        }

    def signature_hash(self) -> str:
        """SHA-256 of :meth:`signature` — used to gate registry/router updates."""
        payload = json.dumps(self.signature(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ManifestValidationError(ValueError):
    """Raised when an inbound payload does not satisfy the manifest schema."""

    def __init__(self, message: str, *, errors: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.errors: list[dict[str, Any]] = errors or []


def validate_manifest(data: CapabilityManifest | dict[str, Any]) -> CapabilityManifest:
    """Validate and normalise an arbitrary payload into a :class:`CapabilityManifest`.

    Raises:
        ManifestValidationError: If validation fails.
    """
    if isinstance(data, CapabilityManifest):
        return data
    try:
        return CapabilityManifest.model_validate(data)
    except ValidationError as exc:
        raise ManifestValidationError(str(exc), errors=exc.errors()) from exc
