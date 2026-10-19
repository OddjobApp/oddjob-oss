# ============================================================================
# MODULARIZED BACKEND ARCHITECTURE
# ============================================================================
#
# This backend has been refactored from a single main.py file into a
# comprehensive modular architecture for better maintainability and scalability.
#
# New Structure:
# ├── api/
# │   ├── __init__.py
# │   ├── main.py              # Application factory and configuration
# │   ├── routes/              # API route handlers
# │   │   ├── __init__.py
# │   │   ├── health.py
# │   │   ├── embeddings.py
# │   │   └── scraping.py
# │   ├── dependencies/        # Dependency injection
# │   │   ├── __init__.py
# │   │   └── services.py
# │   └── middleware/          # Custom middleware
# │       ├── __init__.py
# │       ├── logging.py
# │       └── error_handling.py
# ├── core/                    # Core functionality
# │   ├── __init__.py
# │   ├── config.py            # Configuration management
# │   ├── logging.py           # Logging configuration
# │   └── exceptions.py        # Custom exceptions
# ├── services/                # Business logic services
# │   ├── __init__.py
# │   ├── embedder_service.py
# │   ├── scraper_service.py
# │   └── pdf_service.py
# ├── models/                  # Data models (if needed)
# │   └── __init__.py
# └── utils/                   # Utility functions
#     ├── __init__.py
#     └── validation.py
#
# ============================================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import uvicorn
import os

from api.routes import (
    health, embeddings, scraping, auth, alerts, 
    agent_orchestration, memory, scoring, documentation, 
    form_agents, saas, predictive
)
from api.middleware.logging import LoggingMiddleware
from api.middleware.error_handling import ErrorHandlingMiddleware
from core.config import settings
from core.logging import setup_logging
from core.input_validation import InputValidationMiddleware
from core.rate_limiting import RateLimitMiddleware
from core.security import SecurityHeadersMiddleware, RequestSecurityValidator
from core.auth_middleware import AuthenticationMiddleware
from core.error_middleware import ErrorTrackingMiddleware, ErrorBoundaryMiddleware
from services.agent_orchestrator import agent_orchestrator
from services.memory_service import memory_service
from core.memory_documentation import memory_documentation_service
from core.documentation_maintenance import documentation_maintenance_scheduler
from core.saas_connectors import connector_manager
# Import SaaS connectors to trigger registration
import services.connectors.jira_connector
import services.connectors.slack_connector
import services.connectors.teams_connector
import services.connectors.confluence_connector
# import services.connectors.github_connector # Needs creating/updating to use registry


from api.dependencies.services import lifespan_manager

def create_application() -> FastAPI:
    """Application factory function."""

    # Setup logging first
    setup_logging()

    # Create FastAPI app
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description=settings.DESCRIPTION,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan_manager
    )

    # Set up middleware
    _setup_middleware(app)

    # Include routers
    _include_routers(app)

    @app.on_event("startup")
    async def startup_event():
        print(f"🚀 {settings.PROJECT_NAME} starting up")

    @app.on_event("shutdown")
    async def shutdown_event():
        print(f"🛑 {settings.PROJECT_NAME} shutting down")
        # Shutdown agent orchestrator
        await agent_orchestrator.shutdown()
        print("🤖 Agent orchestrator shutdown")

        # Shutdown documentation maintenance scheduler
        await documentation_maintenance_scheduler.stop()
        print("📚 Documentation maintenance scheduler stopped")

    return app

def _setup_middleware(app: FastAPI) -> None:
    """Configure application middleware."""

    # Error tracking and boundary (applied first for comprehensive error capture)
    app.add_middleware(ErrorBoundaryMiddleware)
    app.add_middleware(ErrorTrackingMiddleware)

    # Security middleware
    app.add_middleware(InputValidationMiddleware)
    app.add_middleware(AuthenticationMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Trusted host middleware
    if not settings.DEBUG:
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=settings.ALLOWED_HOSTS
        )

    # Custom middleware
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(ErrorHandlingMiddleware)

def _include_routers(app: FastAPI) -> None:
    """Include all API routers."""

    app.include_router(
        health.router,
        prefix="/api/v1",
        tags=["health"]
    )

    app.include_router(
        embeddings.router,
        prefix="/api/v1",
        tags=["embeddings"]
    )

    app.include_router(
        scraping.router,
        prefix="/api/v1",
        tags=["scraping"]
    )

    from api.routes import graph
    app.include_router(
        graph.router,
        prefix="/api/v1/graph",
        tags=["graph"]
    )

    app.include_router(
        auth.router,
        prefix="/api/v1/auth",
        tags=["authentication"]
    )

    app.include_router(
        alerts.router,
        prefix="/api/v1",
        tags=["alerts"]
    )

    app.include_router(
        agent_orchestration.router,
        prefix="/api/v1/orchestration",
        tags=["agent-orchestration"]
    )

    app.include_router(
        memory.router,
        prefix="/api/v1/memory",
        tags=["memory"]
    )

    app.include_router(
        scoring.router,
        prefix="/api",
        tags=["scoring"]
    )

    app.include_router(
        documentation.router,
        prefix="/api",
        tags=["documentation"]
    )

    app.include_router(
        form_agents.router,
        prefix="/api/form-agents",
        tags=["form-agents"]
    )

    app.include_router(
        saas.router,
        prefix="/api",
        tags=["saas"]
    )

    app.include_router(
        predictive.router,
        prefix="/api",
        tags=["predictive"]
    )

    from api.routes import notifications
    app.include_router(
        notifications.router,
        prefix="/api/v1/notifications",
        tags=["notifications"]
    )

# Create the application instance
app = create_application()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower()
    )