"""
Service boundary between the Node API and this sidecar.

The sidecar is a private service: only the Node API calls it, over the internal
network. Every request must carry the shared service token
(``X-Service-Token`` == ``SIDECAR_SERVICE_TOKEN``), and every tenant-scoped
request the organization Node verified for its caller (``X-Organization-Id``).
The organization is never taken from a query string or request body: those
routes used to default to organization 1, the same leak the Node API removed.

Outside production an unset token lets local development run without one.
In production the service refuses to start without a token.
"""

import hmac
import os
from typing import Optional

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse

#: Paths that answer without the token: liveness only, no data.
PUBLIC_PATHS = frozenset({"/health", "/api/v1/health", "/api/v1/ping"})


def is_production() -> bool:
    return (os.getenv("NODE_ENV") or os.getenv("ENVIRONMENT") or "").lower() == "production"


def service_token() -> Optional[str]:
    token = (os.getenv("SIDECAR_SERVICE_TOKEN") or "").strip()
    return token or None


def assert_service_config() -> None:
    """Refuse to start in production without the token, or with shared AI keys."""
    if not is_production():
        return
    token = service_token()
    if not token or len(token) < 32:
        raise RuntimeError("SIDECAR_SERVICE_TOKEN (32+ characters) is required in production")
    # Organizations bring their own AI keys; the platform pays for none. A shared
    # key here would bill every organization's work to the platform.
    shared = [k for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY") if os.getenv(k)]
    if shared:
        raise RuntimeError(f"Shared AI provider keys are not allowed in production: {', '.join(shared)}")


def _parse_org(raw: Optional[str]) -> Optional[int]:
    if raw is None:
        return None
    raw = raw.strip()
    if not raw.isdigit():
        return None
    value = int(raw)
    return value if 0 < value < 2**31 else None


class ServiceAuthMiddleware:
    """Checks the service token and records the caller's organization on the request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        path = scope.get("path", "")

        if path not in PUBLIC_PATHS:
            expected = service_token()
            if expected is not None or is_production():
                supplied = headers.get("x-service-token", "")
                if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
                    await JSONResponse({"detail": "Service authentication required"}, status_code=401)(scope, receive, send)
                    return

        state = scope.setdefault("state", {})
        state["organization_id"] = _parse_org(headers.get("x-organization-id"))
        await self.app(scope, receive, send)


def caller_org(request: Request) -> int:
    """FastAPI dependency: the organization Node verified for this request."""
    org = getattr(request.state, "organization_id", None)
    if not org:
        raise HTTPException(status_code=400, detail="X-Organization-Id is required")
    return org
