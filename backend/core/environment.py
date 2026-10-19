# Environment Configuration Management
# This file defines environment-specific configurations for different deployment stages

# Base configuration (shared across all environments)
BASE_CONFIG = {
    "PROJECT_NAME": "Oddjob",
    "VERSION": "1.0.0",
    "DEBUG": False,
    "LOG_LEVEL": "INFO",

    # Security
    "JWT_ALGORITHM": "HS256",
    "ACCESS_TOKEN_EXPIRE_MINUTES": 60,
    "REFRESH_TOKEN_EXPIRE_DAYS": 7,

    # API
    "HOST": "0.0.0.0",
    "PORT": 8000,

    # External Services
    "REQUEST_TIMEOUT": 30,
    "MAX_CONCURRENT_REQUESTS": 10,

    # File Upload
    "MAX_PDF_SIZE_MB": 50,
    "PDF_PROCESSING_TIMEOUT": 300,

    # Rate Limiting
    "RATE_LIMIT_REQUESTS": 100,
    "RATE_LIMIT_WINDOW_MINUTES": 1,
    "RATE_LIMIT_EMBEDDINGS": 50,
}

# Development environment
DEVELOPMENT = {
    **BASE_CONFIG,
    "DEBUG": True,
    "LOG_LEVEL": "DEBUG",
    "ENVIRONMENT": "development",

    # Database
    "DATABASE_URL": "postgresql://postgres:postgres@db:5432/oddjob",

    # Caching
    "REDIS_URL": "redis://redis:6379",

    # Vector Database
    "QDRANT_URL": "http://qdrant:6333",

    # Message Queue
    "RABBITMQ_URL": "amqp://guest:guest@rabbitmq:5672/",

    # Security (use weak keys for development only)
    "JWT_SECRET_KEY": "dev-secret-key-change-in-production",

    # AI Services (optional in development)
    "OPENAI_API_KEY": None,
    "ANTHROPIC_API_KEY": None,

    # Email (disabled in development)
    "SMTP_SERVER": None,
    "SMTP_PORT": None,
    "SMTP_USERNAME": None,
    "SMTP_PASSWORD": None,
    "FROM_EMAIL": None,

    # Alerting (disabled in development)
    "ALERT_WEBHOOK_URL": None,
}

# Staging environment
STAGING = {
    **BASE_CONFIG,
    "ENVIRONMENT": "staging",
    "LOG_LEVEL": "INFO",

    # Database
    "DATABASE_URL": "postgresql://postgres:postgres@db:5432/oddjob_staging",

    # Caching
    "REDIS_URL": "redis://redis:6379",

    # Vector Database
    "QDRANT_URL": "http://qdrant:6333",

    # Message Queue
    "RABBITMQ_URL": "amqp://guest:guest@rabbitmq:5672/",

    # Security
    "JWT_SECRET_KEY": "${JWT_SECRET_KEY}",

    # AI Services
    "OPENAI_API_KEY": "${OPENAI_API_KEY}",
    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",

    # Email notifications
    "SMTP_SERVER": "${SMTP_SERVER}",
    "SMTP_PORT": "${SMTP_PORT}",
    "SMTP_USERNAME": "${SMTP_USERNAME}",
    "SMTP_PASSWORD": "${SMTP_PASSWORD}",
    "FROM_EMAIL": "${FROM_EMAIL}",

    # Alerting
    "ALERT_WEBHOOK_URL": "${ALERT_WEBHOOK_URL}",
}

# Production environment
PRODUCTION = {
    **BASE_CONFIG,
    "ENVIRONMENT": "production",
    "LOG_LEVEL": "WARNING",

    # Performance optimizations
    "MAX_WORKERS": 4,
    "WORKER_TIMEOUT": 30,
    "KEEP_ALIVE_TIMEOUT": 65,

    # Database
    "DATABASE_URL": "postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/oddjob_prod",

    # Caching
    "REDIS_URL": "redis://redis:6379",

    # Vector Database
    "QDRANT_URL": "http://qdrant:6333",

    # Message Queue
    "RABBITMQ_URL": "amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672/",

    # Security
    "JWT_SECRET_KEY": "${JWT_SECRET_KEY}",

    # AI Services
    "OPENAI_API_KEY": "${OPENAI_API_KEY}",
    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",

    # Email notifications
    "SMTP_SERVER": "${SMTP_SERVER}",
    "SMTP_PORT": "${SMTP_PORT}",
    "SMTP_USERNAME": "${SMTP_USERNAME}",
    "SMTP_PASSWORD": "${SMTP_PASSWORD}",
    "FROM_EMAIL": "${FROM_EMAIL}",

    # Alerting
    "ALERT_WEBHOOK_URL": "${ALERT_WEBHOOK_URL}",
}

# Environment mapping
ENVIRONMENTS = {
    "development": DEVELOPMENT,
    "staging": STAGING,
    "production": PRODUCTION,
}

def get_environment_config(environment: str = None) -> dict:
    """Get configuration for the specified environment."""
    if environment is None:
        import os
        environment = os.getenv("ENVIRONMENT", "development")

    if environment not in ENVIRONMENTS:
        raise ValueError(f"Unknown environment: {environment}")

    return ENVIRONMENTS[environment]

def load_environment_variables(config: dict) -> dict:
    """Load environment variables into configuration."""
    import os
    import re

    loaded_config = {}

    for key, value in config.items():
        if isinstance(value, str) and value.startswith("${") and value.endswith("}"):
            # Extract environment variable name
            env_var = value[2:-1]
            env_value = os.getenv(env_var)

            if env_value is None:
                raise ValueError(f"Required environment variable {env_var} is not set")

            loaded_config[key] = env_value
        else:
            loaded_config[key] = value

    return loaded_config