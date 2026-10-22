"""
Production entry point for the Python sidecar.

Mounts only what the Node API calls in production, behind the service boundary
(core/service_auth.py):

- SaaS connectors, actions, sync and discovery (/api/saas/*), scoped to the
  organization in X-Organization-Id.
- Predictive analytics (/api/predictive/*) and response scoring
  (/api/scoring/*). Their state is in process memory and spans organizations,
  so Node exposes them to platform super administrators only.

Everything else main.py mounts for development stays off: the sidecar's own
login and registration (users sign in to Node), agent orchestration, memory
(in-memory and shared across organizations; Node's memory is the record),
alerts, documentation, form agents, notifications, local embeddings (a
different vector space from the organization's index), scraping and PDF
parsing (Node parses documents itself), and graph ranking (no caller).

Run: uvicorn service_main:app --host 0.0.0.0 --port 8002
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from core.service_auth import ServiceAuthMiddleware, assert_service_config
from core.structured_logging import get_structured_logger

logger = get_structured_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    assert_service_config()
    from core.database import get_pool, close_pool
    try:
        await get_pool()
    except Exception as error:  # The SaaS routes report it per request.
        logger.error(f"Database pool unavailable at startup: {error}")
    yield
    await close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="Oddjob sidecar", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.add_middleware(ServiceAuthMiddleware)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    # Importing a connector module registers its platform with the connector
    # manager; without these the SaaS routes know no platforms.
    import services.connectors.jira_connector  # noqa: F401
    import services.connectors.slack_connector  # noqa: F401
    import services.connectors.teams_connector  # noqa: F401
    import services.connectors.confluence_connector  # noqa: F401

    from api.routes.saas import router as saas_router
    from api.routes.predictive import router as predictive_router
    from api.routes.scoring import router as scoring_router

    app.include_router(saas_router, prefix="/api", tags=["saas"])
    app.include_router(predictive_router, prefix="/api", tags=["predictive"])
    app.include_router(scoring_router, prefix="/api", tags=["scoring"])
    return app


app = create_app()
