"""
JWT Authentication and Authorization Utilities
Secure token management and user authentication
"""

import jwt
import bcrypt
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

from core.config import settings
from core.exceptions import AuthenticationError, AuthorizationError, ValidationError, ConfigurationError
from core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class UserClaims:
    """JWT token payload structure."""
    user_id: str
    username: str
    email: str
    roles: List[str]
    permissions: List[str]
    exp: int
    iat: int
    iss: str = "oddjob-api"


@dataclass
class TokenPair:
    """Access and refresh token pair."""
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int = 3600  # 1 hour


class JWTManager:
    """JWT token creation and validation."""

    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour
    REFRESH_TOKEN_EXPIRE_DAYS = 7  # 7 days

    def __init__(self):
        if not settings.JWT_SECRET_KEY:
            raise ConfigurationError("JWT_SECRET_KEY must be configured")
        self.secret_key = settings.JWT_SECRET_KEY

    def create_access_token(self, user_claims: UserClaims) -> str:
        """Create a JWT access token."""
        expire = datetime.now(timezone.utc) + timedelta(minutes=self.ACCESS_TOKEN_EXPIRE_MINUTES)

        claims = {
            "user_id": user_claims.user_id,
            "username": user_claims.username,
            "email": user_claims.email,
            "roles": user_claims.roles,
            "permissions": user_claims.permissions,
            "exp": int(expire.timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": user_claims.iss,
            "type": "access"
        }

        return jwt.encode(claims, self.secret_key, algorithm=self.ALGORITHM)

    def create_refresh_token(self, user_id: str) -> str:
        """Create a JWT refresh token."""
        expire = datetime.now(timezone.utc) + timedelta(days=self.REFRESH_TOKEN_EXPIRE_DAYS)

        claims = {
            "user_id": user_id,
            "exp": int(expire.timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "iss": "oddjob-api",
            "type": "refresh"
        }

        return jwt.encode(claims, self.secret_key, algorithm=self.ALGORITHM)

    def create_token_pair(self, user_claims: UserClaims) -> TokenPair:
        """Create both access and refresh tokens."""
        access_token = self.create_access_token(user_claims)
        refresh_token = self.create_refresh_token(user_claims.user_id)

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )

    def verify_token(self, token: str, token_type: str = "access") -> UserClaims:
        """Verify and decode a JWT token."""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.ALGORITHM])

            # Validate token type
            if payload.get("type") != token_type:
                raise AuthenticationError("Invalid token type")

            # Validate issuer
            if payload.get("iss") != "oddjob-api":
                raise AuthenticationError("Invalid token issuer")

            # Check expiration (jwt.decode already checks exp, but we can be explicit)
            exp = payload.get("exp")
            if exp and datetime.fromtimestamp(exp, timezone.utc) < datetime.now(timezone.utc):
                raise AuthenticationError("Token has expired")

            return UserClaims(
                user_id=payload["user_id"],
                username=payload["username"],
                email=payload["email"],
                roles=payload.get("roles", []),
                permissions=payload.get("permissions", []),
                exp=exp,
                iat=payload.get("iat", 0)
            )

        except jwt.ExpiredSignatureError:
            raise AuthenticationError("Token has expired")
        except jwt.InvalidTokenError as e:
            raise AuthenticationError(f"Invalid token: {str(e)}")
        except KeyError as e:
            raise AuthenticationError(f"Missing required claim: {str(e)}")

    def refresh_access_token(self, refresh_token: str) -> TokenPair:
        """Create new access token using refresh token."""
        # Verify refresh token
        refresh_claims = self.verify_token(refresh_token, "refresh")

        # Create new access token with same user data
        # Note: In production, you'd fetch fresh user data from database
        user_claims = UserClaims(
            user_id=refresh_claims.user_id,
            username="",  # Would fetch from DB
            email="",     # Would fetch from DB
            roles=[],     # Would fetch from DB
            permissions=[], # Would fetch from DB
            exp=0,
            iat=0
        )

        # Create new token pair
        return self.create_token_pair(user_claims)


class PasswordManager:
    """Password hashing and verification."""

    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt."""
        if not password or len(password) < 8:
            raise ValidationError("Password must be at least 8 characters long")

        # Generate salt and hash
        salt = bcrypt.gensalt(rounds=12)  # 12 rounds for good security/performance balance
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)

        return hashed.decode('utf-8')

    @staticmethod
    def verify_password(password: str, hashed_password: str) -> bool:
        """Verify a password against its hash."""
        try:
            return bcrypt.checkpw(
                password.encode('utf-8'),
                hashed_password.encode('utf-8')
            )
        except Exception as e:
            logger.error(f"Password verification error: {str(e)}")
            return False

    @staticmethod
    def validate_password_strength(password: str) -> List[str]:
        """Validate password strength and return list of issues."""
        issues = []

        if len(password) < 8:
            issues.append("Password must be at least 8 characters long")

        if not re.search(r'[A-Z]', password):
            issues.append("Password must contain at least one uppercase letter")

        if not re.search(r'[a-z]', password):
            issues.append("Password must contain at least one lowercase letter")

        if not re.search(r'[0-9]', password):
            issues.append("Password must contain at least one number")

        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            issues.append("Password must contain at least one special character")

        # Check for common weak passwords
        weak_passwords = ['password', '123456', 'qwerty', 'admin', 'letmein']
        if password.lower() in weak_passwords:
            issues.append("Password is too common")

        return issues


class UserManager:
    """User management utilities."""

    @staticmethod
    def validate_username(username: str) -> str:
        """Validate and sanitize username."""
        if not username or not username.strip():
            raise ValidationError("Username is required")

        username = username.strip().lower()

        if len(username) < 3:
            raise ValidationError("Username must be at least 3 characters long")

        if len(username) > 30:
            raise ValidationError("Username must be no more than 30 characters long")

        # Only allow alphanumeric, underscore, and hyphen
        if not re.match(r'^[a-zA-Z0-9_-]+$', username):
            raise ValidationError("Username can only contain letters, numbers, underscores, and hyphens")

        return username

    @staticmethod
    def validate_email(email: str) -> str:
        """Validate email format."""
        if not email or not email.strip():
            raise ValidationError("Email is required")

        email = email.strip().lower()

        # Basic email regex
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'

        if not re.match(email_pattern, email):
            raise ValidationError("Invalid email format")

        if len(email) > 254:  # RFC 3696 limit
            raise ValidationError("Email address is too long")

        return email

    @staticmethod
    def generate_user_id() -> str:
        """Generate a unique user ID."""
        import uuid
        return str(uuid.uuid4())

    @staticmethod
    def get_default_roles() -> List[str]:
        """Get default user roles."""
        return ["user"]

    @staticmethod
    def get_role_permissions(roles: List[str]) -> List[str]:
        """Get permissions for given roles."""
        # Simple RBAC mapping - in production, this would be more sophisticated
        role_permissions = {
            "admin": [
                "users:read", "users:write", "users:delete",
                "pipelines:read", "pipelines:write", "pipelines:delete", "pipelines:execute",
                "jobs:read", "jobs:write", "jobs:delete", "jobs:execute",
                "system:read", "system:write"
            ],
            "user": [
                "pipelines:read", "pipelines:write",
                "jobs:read", "jobs:write", "jobs:execute",
                "profile:read", "profile:write"
            ],
            "viewer": [
                "pipelines:read", "jobs:read", "system:read"
            ]
        }

        permissions = set()
        for role in roles:
            if role in role_permissions:
                permissions.update(role_permissions[role])

        return list(permissions)


# Global instances
jwt_manager = JWTManager()
password_manager = PasswordManager()
user_manager = UserManager()