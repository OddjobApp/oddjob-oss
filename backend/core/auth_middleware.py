"""
Authentication Middleware
JWT token validation and user context management
"""

from fastapi import Request, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, List
import re

from core.auth import jwt_manager, UserClaims
from core.exceptions import AuthenticationError, AuthorizationError
from core.logging import get_logger

logger = get_logger(__name__)

# Security scheme for OpenAPI documentation
security_scheme = HTTPBearer(auto_error=False)


class AuthenticatedUser:
    """Container for authenticated user information."""

    def __init__(self, claims: UserClaims):
        self.user_id = claims.user_id
        self.username = claims.username
        self.email = claims.email
        self.roles = claims.roles
        self.permissions = claims.permissions

    def has_role(self, role: str) -> bool:
        """Check if user has a specific role."""
        return role in self.roles

    def has_permission(self, permission: str) -> bool:
        """Check if user has a specific permission."""
        return permission in self.permissions

    def has_any_role(self, roles: List[str]) -> bool:
        """Check if user has any of the specified roles."""
        return any(role in self.roles for role in roles)

    def has_any_permission(self, permissions: List[str]) -> bool:
        """Check if user has any of the specified permissions."""
        return any(perm in self.permissions for perm in permissions)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> AuthenticatedUser:
    """
    FastAPI dependency to get the current authenticated user.

    Raises HTTPException if authentication fails.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )

    try:
        # Verify the JWT token
        claims = jwt_manager.verify_token(credentials.credentials)

        # Create authenticated user object
        user = AuthenticatedUser(claims)

        # Log successful authentication
        logger.info(
            f"User authenticated: {user.username} ({user.user_id})",
            extra={
                "user_id": user.user_id,
                "username": user.username
            }
        )

        return user

    except AuthenticationError as e:
        logger.warning(f"Authentication failed: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"}
        )


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> Optional[AuthenticatedUser]:
    """
    Optional user dependency - returns None if not authenticated.
    Useful for endpoints that work with or without authentication.
    """
    if not credentials:
        return None

    try:
        claims = jwt_manager.verify_token(credentials.credentials)
        return AuthenticatedUser(claims)
    except AuthenticationError:
        return None


def require_role(required_role: str):
    """Dependency factory for role-based access control."""

    async def role_checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.has_role(required_role):
            logger.warning(
                f"Access denied. User {user.username} lacks required role: {required_role}",
                extra={"user_id": user.user_id, "required_role": required_role}
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {required_role}"
            )
        return user

    return role_checker


def require_permission(required_permission: str):
    """Dependency factory for permission-based access control."""

    async def permission_checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.has_permission(required_permission):
            logger.warning(
                f"Access denied. User {user.username} lacks required permission: {required_permission}",
                extra={"user_id": user.user_id, "required_permission": required_permission}
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required permission: {required_permission}"
            )
        return user

    return permission_checker


def require_any_role(required_roles: List[str]):
    """Dependency factory for requiring any of multiple roles."""

    async def roles_checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.has_any_role(required_roles):
            logger.warning(
                f"Access denied. User {user.username} lacks any of required roles: {required_roles}",
                extra={"user_id": user.user_id, "required_roles": required_roles}
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required roles: {', '.join(required_roles)}"
            )
        return user

    return roles_checker


def require_any_permission(required_permissions: List[str]):
    """Dependency factory for requiring any of multiple permissions."""

    async def permissions_checker(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
        if not user.has_any_permission(required_permissions):
            logger.warning(
                f"Access denied. User {user.username} lacks any of required permissions: {required_permissions}",
                extra={"user_id": user.user_id, "required_permissions": required_permissions}
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required permissions: {', '.join(required_permissions)}"
            )
        return user

    return permissions_checker


class AuthenticationMiddleware:
    """Middleware to optionally attach user context to requests."""

    def __init__(self, app, exclude_paths: Optional[List[str]] = None):
        self.app = app
        self.exclude_paths = exclude_paths or [
            '/api/v1/health',
            '/api/v1/auth/login',
            '/api/v1/auth/register',
            '/docs',
            '/redoc',
            '/openapi.json'
        ]

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        # Skip authentication for excluded paths
        if any(excluded in path for excluded in self.exclude_paths):
            await self.app(scope, receive, send)
            return

        # Extract Authorization header
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b'authorization', b'').decode('utf-8', errors='ignore')

        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header[7:]  # Remove 'Bearer ' prefix

            try:
                # Verify token and attach user to scope
                claims = jwt_manager.verify_token(token)

                # Add user context to scope for use in handlers
                scope["user"] = AuthenticatedUser(claims)

            except AuthenticationError:
                # Invalid token - let the endpoint handle authentication requirements
                pass

        await self.app(scope, receive, send)


# Utility functions for manual authentication in route handlers
def get_user_from_request(request: Request) -> Optional[AuthenticatedUser]:
    """Extract authenticated user from request scope."""
    return getattr(request.state, 'user', None)


def require_auth(user: Optional[AuthenticatedUser] = None) -> AuthenticatedUser:
    """Require authentication and return user."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    return user