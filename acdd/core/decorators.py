"""
acdd.core.decorators
====================

The inline code-ingestion surface: ``@oddjob_capability``.

Developers annotate any callable to declare it as a platform capability. At
import time the decorator:

1. Reflects over the function signature to derive input parameter types and the
   return type.
2. Normalises everything into a :class:`CapabilityManifest`-shaped payload.
3. Attaches the manifest to the function (``func.__oddjob_capability__``) for
   later introspection by the code-to-docs pipeline.
4. Fires the payload *asynchronously and fail-silently* to the local registry
   endpoint on a daemon thread, so a registry being down can never delay or
   crash application boot.

The decorator intentionally depends only on the standard library and the local
schema module, keeping import-time cost and blast radius minimal.
"""

from __future__ import annotations

import functools
import inspect
import json
import logging
import threading
import urllib.error
import urllib.request
from typing import Any, Callable, TypeVar

from .config import get_config
from .schema import (
    CapabilityCategory,
    ExecutionEnvironment,
    ManifestValidationError,
    RiskProfile,
    validate_manifest,
)

logger = logging.getLogger("acdd.decorators")

F = TypeVar("F", bound=Callable[..., Any])

__all__ = ["oddjob_capability", "build_manifest_payload"]


def _annotation_to_str(annotation: Any) -> str:
    """Render a type annotation into a compact, human-readable string."""
    if annotation is inspect.Signature.empty:
        return "Any"
    if isinstance(annotation, str):
        return annotation
    name = getattr(annotation, "__name__", None)
    if name:
        return name
    # e.g. typing.Optional[int] -> "Optional[int]" without the "typing." noise.
    return str(annotation).replace("typing.", "")


def build_manifest_payload(
    func: Callable[..., Any],
    *,
    capability_id: str,
    display_name: str,
    category: str | CapabilityCategory,
    description: str,
    owner: str = "unassigned",
    risk_profile: str | RiskProfile = RiskProfile.LOW,
    execution_environment: str | ExecutionEnvironment = ExecutionEnvironment.HOST,
    dependencies: list[str] | None = None,
    summary: str = "",
    business_use_cases: list[str] | None = None,
    guardrails: list[str] | None = None,
) -> dict[str, Any]:
    """Reflect over ``func`` and build a manifest-shaped dict payload."""
    signature = inspect.signature(func)
    inputs: dict[str, str] = {}
    for name, parameter in signature.parameters.items():
        if name in ("self", "cls"):
            continue
        if parameter.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        inputs[name] = _annotation_to_str(parameter.annotation)

    outputs = {"return_value": _annotation_to_str(signature.return_annotation)}

    return {
        "capability_id": capability_id,
        "metadata": {
            "display_name": display_name,
            "category": CapabilityCategory(category).value,
            "description": description,
            "owner": owner,
        },
        "technical_spec": {"inputs": inputs, "outputs": outputs},
        "documentation_meta": {
            "summary": summary,
            "business_use_cases": list(business_use_cases or []),
            "guardrails": list(guardrails or []),
        },
        "runtime_context": {
            "risk_profile": RiskProfile(risk_profile).value,
            "execution_environment": ExecutionEnvironment(execution_environment).value,
            "dependencies": list(dependencies or []),
        },
    }


def _fire_async(payload: dict[str, Any]) -> None:
    """POST ``payload`` to the registry on a daemon thread, swallowing all errors."""
    config = get_config()

    def _post() -> None:
        try:
            data = json.dumps(payload).encode("utf-8")
            request = urllib.request.Request(
                config.register_url,
                data=data,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=config.register_timeout):
                pass
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # Registry offline at import time is expected and non-fatal.
            logger.debug("Capability registration deferred (registry unreachable): %s", exc)
        except Exception:  # noqa: BLE001 - must never crash a boot path
            logger.debug("Capability registration failed silently.", exc_info=True)

    thread = threading.Thread(target=_post, name="acdd-register", daemon=True)
    thread.start()


def oddjob_capability(
    capability_id: str,
    display_name: str,
    category: str | CapabilityCategory,
    description: str,
    *,
    owner: str = "unassigned",
    risk_profile: str | RiskProfile = RiskProfile.LOW,
    execution_environment: str | ExecutionEnvironment = ExecutionEnvironment.HOST,
    dependencies: list[str] | None = None,
    summary: str = "",
    business_use_cases: list[str] | None = None,
    guardrails: list[str] | None = None,
    autoregister: bool = True,
) -> Callable[[F], F]:
    """Decorate a callable to declare it as an Oddjob capability.

    Args:
        capability_id: Stable slug (``^[a-z0-9_]+$``).
        display_name: Human-readable name.
        category: One of :class:`CapabilityCategory` (value or name accepted).
        description: What the capability does.
        owner: Accountable team/person.
        risk_profile: Drives the downstream git branching strategy.
        execution_environment: Where the capability may run.
        dependencies: External packages/services it needs.
        summary: Short business summary for the docs.
        business_use_cases: Concrete usage scenarios.
        guardrails: Strict execution constraints (rendered as security callouts).
        autoregister: If True, fire the manifest to the local registry at import.

    Returns:
        The wrapped callable, with ``__oddjob_capability__`` attached.
    """

    def decorator(func: F) -> F:
        payload = build_manifest_payload(
            func,
            capability_id=capability_id,
            display_name=display_name,
            category=category,
            description=description,
            owner=owner,
            risk_profile=risk_profile,
            execution_environment=execution_environment,
            dependencies=dependencies,
            summary=summary,
            business_use_cases=business_use_cases,
            guardrails=guardrails,
        )

        # Validate eagerly so a malformed declaration is caught at import, but
        # never abort import over it — log and continue with the raw payload.
        try:
            validate_manifest(payload)
        except ManifestValidationError as exc:
            logger.warning("Capability %s failed schema validation: %s", capability_id, exc)

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                return await func(*args, **kwargs)

            wrapper: Any = async_wrapper
        else:

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                return func(*args, **kwargs)

            wrapper = sync_wrapper

        wrapper.__oddjob_capability__ = payload  # type: ignore[attr-defined]

        if autoregister:
            _fire_async(payload)

        return wrapper  # type: ignore[return-value]

    return decorator
