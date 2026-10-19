"""
API Routes Package
All route modules are imported here for easy inclusion in the main app
"""

from . import health, embeddings, scraping

__all__ = ["health", "embeddings", "scraping"]