"""
Service Dependencies
Dependency injection for service layer components
"""

from typing import AsyncGenerator
from contextlib import asynccontextmanager
import asyncio

from services.embedder_service import EmbedderService
from services.scraper_service import ScraperService
from services.pdf_service import PDFService
from services.ai_extraction_service import AIExtractionService
from core.saas_connectors import connector_manager


# Global service instances
_embedder_service: EmbedderService | None = None
_scraper_service: ScraperService | None = None
_pdf_service: PDFService | None = None
_ai_extraction_service: AIExtractionService | None = None


def get_embedder_service() -> EmbedderService:
    """Get embedder service instance."""
    global _embedder_service
    if _embedder_service is None:
        _embedder_service = EmbedderService()
    return _embedder_service


def get_scraper_service() -> ScraperService:
    """Get scraper service instance."""
    global _scraper_service
    if _scraper_service is None:
        _scraper_service = ScraperService()
    return _scraper_service


def get_pdf_service() -> PDFService:
    """Get PDF service instance."""
    global _pdf_service
    if _pdf_service is None:
        _pdf_service = PDFService()
    return _pdf_service


def get_ai_extraction_service() -> AIExtractionService:
    """Get AI extraction service instance."""
    global _ai_extraction_service
    if _ai_extraction_service is None:
        # Import config here to avoid circular imports if any
        from core.service_base import ServiceConfig
        _ai_extraction_service = AIExtractionService(ServiceConfig(name="ai_extraction", enabled=True))
    return _ai_extraction_service


from fastapi import FastAPI

@asynccontextmanager
async def lifespan_manager(app: FastAPI):
    """Application lifespan manager for service initialization/cleanup."""
    # Startup
    try:
        # Initialize services
        global _embedder_service, _scraper_service, _pdf_service, _ai_extraction_service

        try:
            _embedder_service = EmbedderService()
        except Exception as e:
            print(f"❌ Failed to initialize EmbedderService: {e}")
            
        try:
            _scraper_service = ScraperService()
        except Exception as e:
            print(f"❌ Failed to initialize ScraperService: {e}")
            
        try:
            _pdf_service = PDFService()
        except Exception as e:
            print(f"❌ Failed to initialize PDFService: {e}")
        
        # Initialize AI Extraction Service (with proper error handling to not block startup)
        try:
            from core.service_base import ServiceConfig
            _ai_extraction_service = AIExtractionService(ServiceConfig(name="ai_extraction", enabled=True))
            await _ai_extraction_service.initialize()
            print("DEBUG: AI Extraction Service initialized.")
        except Exception as e:
            print(f"[WARNING] AI Extraction Service initialization failed (non-blocking): {e}")
        
        # Initialize DB pool
        print("DEBUG: Initializing DB pool...")
        try:
            from core.database import get_pool
            await get_pool()
            print("DEBUG: DB pool initialized.")
        except Exception as e:
             print(f"[ERROR] Failed to initialize DB Pool: {e}")

        # SaaS Connectors: Using lazy initialization instead of blocking startup
        # The connector_manager.initialize_all() call was blocking the event loop due 
        # to synchronous HTTP calls in ensure_initialized(). Instead, connectors are
        # now lazily loaded on first request via load_org_state() which is called in
        # the /api/saas/connectors endpoint when needed.
        print("DEBUG: SaaS connectors will be lazily initialized on first request")

        yield

    finally:
        # Cleanup
        try:
            print("DEBUG: Cleaning up lifespan resources...")
            from core.database import close_pool
            await close_pool()
        except Exception as e:
            print(f"[ERROR] Failed to cleanup lifespan resources: {e}")
        pass