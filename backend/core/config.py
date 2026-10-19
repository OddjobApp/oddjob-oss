"""
Core Configuration Management
Centralized configuration with environment variable support
"""

import os
from typing import List, Optional
from pydantic import BaseModel, validator, Field
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))


class Settings:
    """Application settings with environment variable support."""

    # Project Info
    PROJECT_NAME: str = "Oddjob Python Sidecar"
    VERSION: str = "1.0.0"
    DESCRIPTION: str = "AI-powered automation and data processing service"

    # Server Configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8002
    DEBUG: bool = False
    RELOAD: bool = False

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]
    ALLOWED_HOSTS: List[str] = ["*"]

    # AI/ML Configuration
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    OPENAI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None

    # Scraping Configuration
    REQUEST_TIMEOUT: int = 30
    MAX_CONCURRENT_REQUESTS: int = 10
    USER_AGENT: str = "Oddjob-Sidecar/1.0"

    # PDF Processing
    MAX_PDF_SIZE_MB: int = 50
    PDF_PROCESSING_TIMEOUT: int = 300

    # Database (if needed in future)
    DATABASE_URL: Optional[str] = None

    # External Services
    REDIS_URL: Optional[str] = None
    NODE_API_URL: str = "http://localhost:5000"

    # Authentication
    JWT_SECRET_KEY: str = "your-secret-key-change-in-production"
    INTERNAL_API_SECRET: Optional[str] = None
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Notification Channels
    AGENTMAIL_API_KEY: Optional[str] = None
    AGENTMAIL_INBOX: str = "oddjobapp@agentmail.to"
    AGENTMAIL_WEBHOOK_SECRET: Optional[str] = None
    SLACK_BOT_TOKEN: Optional[str] = None
    SLACK_APP_TOKEN: Optional[str] = None

    def __init__(self):
        """Load settings from environment variables."""
        import os

        # Load from environment
        self.PROJECT_NAME = os.getenv("PROJECT_NAME", self.PROJECT_NAME)
        self.VERSION = os.getenv("VERSION", self.VERSION)
        self.DESCRIPTION = os.getenv("DESCRIPTION", self.DESCRIPTION)

        self.HOST = os.getenv("HOST", self.HOST)
        self.PORT = int(os.getenv("PORT", str(self.PORT)))
        self.DEBUG = os.getenv("DEBUG", str(self.DEBUG)).lower() in ("true", "1", "yes", "on")
        self.RELOAD = os.getenv("RELOAD", str(self.RELOAD)).lower() in ("true", "1", "yes", "on")

        self.LOG_LEVEL = os.getenv("LOG_LEVEL", self.LOG_LEVEL)
        self.LOG_FORMAT = os.getenv("LOG_FORMAT", self.LOG_FORMAT)

        # Parse comma-separated lists
        allowed_origins = os.getenv("ALLOWED_ORIGINS")
        if allowed_origins:
            self.ALLOWED_ORIGINS = [origin.strip() for origin in allowed_origins.split(",")]
        else:
            self.ALLOWED_ORIGINS = self.ALLOWED_ORIGINS

        allowed_hosts = os.getenv("ALLOWED_HOSTS")
        if allowed_hosts:
            self.ALLOWED_HOSTS = [host.strip() for host in allowed_hosts.split(",")]
        else:
            self.ALLOWED_HOSTS = self.ALLOWED_HOSTS

        self.EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", self.EMBEDDING_MODEL)
        self.OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
        self.GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

        self.REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", str(self.REQUEST_TIMEOUT)))
        self.MAX_CONCURRENT_REQUESTS = int(os.getenv("MAX_CONCURRENT_REQUESTS", str(self.MAX_CONCURRENT_REQUESTS)))
        self.USER_AGENT = os.getenv("USER_AGENT", self.USER_AGENT)

        self.MAX_PDF_SIZE_MB = int(os.getenv("MAX_PDF_SIZE_MB", str(self.MAX_PDF_SIZE_MB)))
        self.PDF_PROCESSING_TIMEOUT = int(os.getenv("PDF_PROCESSING_TIMEOUT", str(self.PDF_PROCESSING_TIMEOUT)))

        self.DATABASE_URL = os.getenv("DATABASE_URL")
        self.REDIS_URL = os.getenv("REDIS_URL")
        self.NODE_API_URL = os.getenv("NODE_API_URL", self.NODE_API_URL)

        self.JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET") or self.JWT_SECRET_KEY
        self.INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET") or os.getenv("SESSION_SECRET")
        self.JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", self.JWT_ALGORITHM)
        self.ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(self.ACCESS_TOKEN_EXPIRE_MINUTES)))
        self.REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", str(self.REFRESH_TOKEN_EXPIRE_DAYS)))
        
        # Notifications
        self.AGENTMAIL_API_KEY = os.getenv("AGENTMAIL_API_KEY")
        self.AGENTMAIL_INBOX = os.getenv("AGENTMAIL_INBOX", self.AGENTMAIL_INBOX)
        self.AGENTMAIL_WEBHOOK_SECRET = os.getenv("AGENTMAIL_WEBHOOK_SECRET")
        self.SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN")
        self.SLACK_APP_TOKEN = os.getenv("SLACK_APP_TOKEN")




# Create global settings instance
settings = Settings()