"""
Authentication Routes
User registration, login, and token management
"""

from fastapi import APIRouter, HTTPException, status, Depends, Body
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
import time

from core.auth import (
    jwt_manager, password_manager, user_manager,
    UserClaims, TokenPair
)
from core.auth_middleware import AuthenticatedUser
from core.exceptions import ValidationError, AuthenticationError
from core.logging import get_logger
from core.auth_middleware import get_current_user

logger = get_logger(__name__)

router = APIRouter()


# Request/Response Models
class UserRegistrationRequest(BaseModel):
    """User registration request."""
    username: str = Field(..., min_length=3, max_length=30, description="Unique username")
    email: EmailStr = Field(..., description="Valid email address")
    password: str = Field(..., min_length=8, description="Password (minimum 8 characters)")
    full_name: Optional[str] = Field(None, description="User's full name")


class UserLoginRequest(BaseModel):
    """User login request."""
    username_or_email: str = Field(..., description="Username or email address")
    password: str = Field(..., description="User password")


class TokenRefreshRequest(BaseModel):
    """Token refresh request."""
    refresh_token: str = Field(..., description="Valid refresh token")


class AuthResponse(BaseModel):
    """Authentication response with tokens."""
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int
    user: dict  # Simplified user info


class UserProfile(BaseModel):
    """User profile information."""
    user_id: str
    username: str
    email: str
    full_name: Optional[str]
    roles: list[str]
    permissions: list[str]
    created_at: str
    last_login: Optional[str]


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_user(request: UserRegistrationRequest) -> AuthResponse:
    """
    Register a new user account.

    Creates a new user account and returns authentication tokens.
    """
    try:
        logger.info(f"Processing user registration: {request.username}")

        # Validate username and email
        username = user_manager.validate_username(request.username)
        email = user_manager.validate_email(request.email)

        # Validate password strength
        password_issues = password_manager.validate_password_strength(request.password)
        if password_issues:
            raise ValidationError(f"Password validation failed: {'; '.join(password_issues)}")

        # Check if user already exists (in real implementation, check database)
        # For now, we'll assume registration succeeds

        # Hash password
        hashed_password = password_manager.hash_password(request.password)

        # Generate user ID
        user_id = user_manager.generate_user_id()

        # Create user profile (in real implementation, save to database)
        user_data = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "full_name": request.full_name,
            "roles": user_manager.get_default_roles(),
            "permissions": user_manager.get_role_permissions(user_manager.get_default_roles()),
            "hashed_password": hashed_password,
            "created_at": time.time(),
        }

        # Create JWT claims
        claims = UserClaims(
            user_id=user_id,
            username=username,
            email=email,
            roles=user_data["roles"],
            permissions=user_data["permissions"],
            exp=0,  # Will be set by JWT manager
            iat=0   # Will be set by JWT manager
        )

        # Generate tokens
        token_pair = jwt_manager.create_token_pair(claims)

        logger.info(f"User registered successfully: {username} ({user_id})")

        return AuthResponse(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            token_type=token_pair.token_type,
            expires_in=token_pair.expires_in,
            user={
                "user_id": user_id,
                "username": username,
                "email": email,
                "full_name": request.full_name,
                "roles": user_data["roles"]
            }
        )

    except ValidationError as e:
        logger.warning(f"Registration validation failed: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=e.message
        )
    except Exception as e:
        logger.error(f"Registration failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        )


@router.post("/login", response_model=AuthResponse)
async def login_user(request: UserLoginRequest) -> AuthResponse:
    """
    Authenticate user and return access tokens.

    Validates credentials and returns JWT tokens for authenticated sessions.
    """
    try:
        logger.info(f"Processing login attempt for: {request.username_or_email}")

        # In real implementation, fetch user from database
        # For demo purposes, we'll simulate authentication
        mock_user_data = {
            "user_id": "user-123",
            "username": "demo",
            "email": "demo@example.com",
            "hashed_password": password_manager.hash_password("password123"),
            "roles": ["user"],
            "full_name": "Demo User"
        }

        # Check if username/email matches and password is correct
        is_valid_user = (
            request.username_or_email in [mock_user_data["username"], mock_user_data["email"]]
        )

        if not is_valid_user or not password_manager.verify_password(
            request.password, mock_user_data["hashed_password"]
        ):
            logger.warning(f"Login failed for: {request.username_or_email}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username/email or password"
            )

        # Create JWT claims
        permissions = user_manager.get_role_permissions(mock_user_data["roles"])
        claims = UserClaims(
            user_id=mock_user_data["user_id"],
            username=mock_user_data["username"],
            email=mock_user_data["email"],
            roles=mock_user_data["roles"],
            permissions=permissions,
            exp=0,  # Will be set by JWT manager
            iat=0   # Will be set by JWT manager
        )

        # Generate tokens
        token_pair = jwt_manager.create_token_pair(claims)

        logger.info(f"Login successful for user: {mock_user_data['username']}")

        return AuthResponse(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            token_type=token_pair.token_type,
            expires_in=token_pair.expires_in,
            user={
                "user_id": mock_user_data["user_id"],
                "username": mock_user_data["username"],
                "email": mock_user_data["email"],
                "full_name": mock_user_data["full_name"],
                "roles": mock_user_data["roles"]
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        )


@router.post("/refresh", response_model=AuthResponse)
async def refresh_token(request: TokenRefreshRequest) -> AuthResponse:
    """
    Refresh access token using refresh token.

    Generates new access token without requiring re-authentication.
    """
    try:
        logger.info("Processing token refresh")

        # Validate and refresh token
        token_pair = jwt_manager.refresh_access_token(request.refresh_token)

        # In real implementation, fetch fresh user data from database
        # For demo, return minimal user info
        user_info = {
            "user_id": "refreshed-user",
            "username": "user",
            "email": "user@example.com",
            "roles": ["user"]
        }

        logger.info("Token refresh successful")

        return AuthResponse(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            token_type=token_pair.token_type,
            expires_in=token_pair.expires_in,
            user=user_info
        )

    except AuthenticationError as e:
        logger.warning(f"Token refresh failed: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )
    except Exception as e:
        logger.error(f"Token refresh failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Token refresh failed"
        )


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> UserProfile:
    """
    Get current authenticated user's profile.

    Returns detailed user information for the authenticated user.
    """
    # In real implementation, fetch full user profile from database
    return UserProfile(
        user_id=current_user.user_id,
        username=current_user.username,
        email=current_user.email,
        full_name="Demo User",  # Would come from database
        roles=current_user.roles,
        permissions=current_user.permissions,
        created_at="2024-01-01T00:00:00Z",  # Would come from database
        last_login="2024-01-23T12:00:00Z"  # Would come from database
    )


@router.post("/logout")
async def logout_user(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> dict:
    """
    Logout current user.

    In a stateless JWT system, this is primarily for client-side token cleanup.
    In production, you might implement token blacklisting.
    """
    logger.info(f"User logged out: {current_user.username}")

    return {
        "message": "Logged out successfully",
        "user_id": current_user.user_id
    }


@router.post("/change-password")
async def change_password(
    request: dict = Body(..., description="Password change request"),
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> dict:
    """
    Change user's password.

    Requires current password verification before allowing change.
    """
    try:
        current_password = request.get("current_password")
        new_password = request.get("new_password")

        if not current_password or not new_password:
            raise ValidationError("Both current_password and new_password are required")

        # In real implementation:
        # 1. Fetch user's hashed password from database
        # 2. Verify current password
        # 3. Hash new password
        # 4. Update database
        # 5. Optionally revoke all existing tokens

        # Validate new password strength
        password_issues = password_manager.validate_password_strength(new_password)
        if password_issues:
            raise ValidationError(f"New password validation failed: {'; '.join(password_issues)}")

        # Mock password verification (would check against database)
        mock_current_hashed = password_manager.hash_password("current_password")
        if not password_manager.verify_password(current_password, mock_current_hashed):
            raise AuthenticationError("Current password is incorrect")

        # Hash and "save" new password
        new_hashed = password_manager.hash_password(new_password)

        logger.info(f"Password changed for user: {current_user.username}")

        return {
            "message": "Password changed successfully",
            "user_id": current_user.user_id
        }

    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=e.message
        )
    except AuthenticationError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message
        )