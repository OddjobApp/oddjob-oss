"""
Security Headers and Protection Middleware
Comprehensive security headers and protection against common attacks
"""

import hashlib
import hmac
import re
import secrets
from typing import List, Optional, Dict, Any
from fastapi import Request, Response, HTTPException, status
from fastapi.responses import JSONResponse
from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


class SecurityHeadersMiddleware:
    """Middleware to add comprehensive security headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Intercept response to add security headers
        async def send_with_security_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))

                # Add security headers
                security_headers = self._get_security_headers(scope)

                # Merge with existing headers (security headers take precedence)
                header_dict = {h[0]: h[1] for h in headers}
                for header_name, header_value in security_headers.items():
                    header_dict[header_name.encode()] = header_value.encode()

                message["headers"] = list(header_dict.items())

            await send(message)

        await self.app(scope, receive, send_with_security_headers)

    def _get_security_headers(self, scope) -> Dict[str, str]:
        """Generate security headers for the response."""
        headers = {}

        # Content Security Policy
        csp = self._build_csp()
        if csp:
            headers['content-security-policy'] = csp

        # Prevent clickjacking
        headers['x-frame-options'] = 'DENY'

        # Prevent MIME type sniffing
        headers['x-content-type-options'] = 'nosniff'

        # Enable XSS protection
        headers['x-xss-protection'] = '1; mode=block'

        # Referrer Policy
        headers['referrer-policy'] = 'strict-origin-when-cross-origin'

        # Permissions Policy (formerly Feature Policy)
        headers['permissions-policy'] = self._build_permissions_policy()

        # HSTS (only for HTTPS)
        if scope.get('scheme') == 'https':
            headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'

        # Remove server information
        headers['server'] = 'webserver'

        return headers

    def _build_csp(self) -> str:
        """Build Content Security Policy header."""
        csp_parts = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  # Allow for development
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "media-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ]

        if settings.DEBUG:
            # More permissive in development
            csp_parts.extend([
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* https://localhost:*",
                "connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*",
            ])

        return '; '.join(csp_parts)

    def _build_permissions_policy(self) -> str:
        """Build Permissions Policy header."""
        return (
            "camera=(), "
            "microphone=(), "
            "geolocation=(), "
            "gyroscope=(), "
            "magnetometer=(), "
            "payment=(), "
            "usb=(), "
            "autoplay=()"
        )


class RequestSecurityValidator:
    """Validate incoming requests for security issues."""

    @staticmethod
    def validate_request_size(request: Request, max_size: int = 10 * 1024 * 1024) -> None:
        """Validate request size to prevent DoS attacks."""
        content_length = request.headers.get('content-length')
        if content_length:
            try:
                size = int(content_length)
                if size > max_size:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Request too large"
                    )
            except ValueError:
                pass  # Invalid content-length header, let it pass

    @staticmethod
    def validate_user_agent(request: Request) -> None:
        """Validate user agent string."""
        user_agent = request.headers.get('user-agent', '')

        # Check for suspicious user agents
        suspicious_patterns = [
            r'python-requests',  # Automated requests
            r'curl/',            # Command line tools
            r'wget/',            # Command line tools
            r'sqlmap',           # SQL injection tools
            r'nmap',             # Network scanning
        ]

        for pattern in suspicious_patterns:
            if re.search(pattern, user_agent, re.IGNORECASE):
                logger.warning(
                    f"Suspicious user agent detected: {user_agent}",
                    extra={
                        "user_agent": user_agent,
                        "client_ip": request.client.host if request.client else None,
                        "path": request.url.path
                    }
                )
                # Don't block, just log for monitoring
                break

    @staticmethod
    def validate_headers(request: Request) -> None:
        """Validate request headers for security issues."""
        # Check for multiple content-type headers (potential HTTP request smuggling)
        content_types = [h for h in request.headers.getlist('content-type') if h]
        if len(content_types) > 1:
            logger.warning("Multiple content-type headers detected")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid request headers"
            )

        # Check for suspicious header values
        suspicious_headers = ['x-forwarded-for', 'x-real-ip']
        for header in suspicious_headers:
            if header in request.headers and len(request.headers.getlist(header)) > 1:
                logger.warning(f"Multiple {header} headers detected")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid request headers"
                )


class WebhookSecurity:
    """Webhook security utilities for signed webhooks."""

    @staticmethod
    def verify_webhook_signature(
        payload: str,
        signature: str,
        secret: str,
        algorithm: str = 'sha256'
    ) -> bool:
        """
        Verify webhook signature using HMAC.

        Args:
            payload: Raw request body
            signature: Signature from webhook header (e.g., 'sha256=abc123')
            secret: Webhook secret
            algorithm: Hash algorithm to use

        Returns:
            True if signature is valid
        """
        try:
            # Parse signature header (format: "sha256=signature")
            if '=' not in signature:
                return False

            sig_algorithm, sig_value = signature.split('=', 1)
            if sig_algorithm != algorithm:
                return False

            # Calculate expected signature
            expected_sig = hmac.new(
                secret.encode(),
                payload.encode(),
                getattr(hashlib, algorithm)
            ).hexdigest()

            # Use constant-time comparison to prevent timing attacks
            return hmac.compare_digest(expected_sig, sig_value)

        except Exception as e:
            logger.error(f"Webhook signature verification failed: {str(e)}")
            return False

    @staticmethod
    def generate_webhook_secret() -> str:
        """Generate a secure webhook secret."""
        return secrets.token_hex(32)  # 256-bit secret


class SecurityAuditLogger:
    """Log security-related events for monitoring."""

    @staticmethod
    def log_suspicious_activity(
        request: Request,
        activity_type: str,
        details: Dict[str, Any]
    ) -> None:
        """Log suspicious activity for security monitoring."""
        logger.warning(
            f"Security event: {activity_type}",
            extra={
                "activity_type": activity_type,
                "client_ip": request.client.host if request.client else None,
                "user_agent": request.headers.get('user-agent'),
                "path": request.url.path,
                "method": request.method,
                "details": details,
                "security_event": True
            }
        )

    @staticmethod
    def log_failed_authentication(request: Request, reason: str) -> None:
        """Log failed authentication attempts."""
        SecurityAuditLogger.log_suspicious_activity(
            request,
            "failed_authentication",
            {"reason": reason}
        )

    @staticmethod
    def log_rate_limit_exceeded(request: Request, limit_type: str) -> None:
        """Log rate limit violations."""
        SecurityAuditLogger.log_suspicious_activity(
            request,
            "rate_limit_exceeded",
            {"limit_type": limit_type}
        )

    @staticmethod
    def log_suspicious_payload(request: Request, payload_info: Dict[str, Any]) -> None:
        """Log suspicious payload detection."""
        SecurityAuditLogger.log_suspicious_activity(
            request,
            "suspicious_payload",
            payload_info
        )


# Security-focused error responses
def create_security_error_response(message: str) -> JSONResponse:
    """Create a standardized security error response."""
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "error": {
                "code": "SECURITY_VIOLATION",
                "message": "Security policy violation",
                "details": message
            }
        },
        headers={
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY"
        }
    )