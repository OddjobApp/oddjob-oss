"""
Input Validation and Sanitization Middleware
Comprehensive input filtering and validation for API security
"""

import re
import json
from typing import Dict, Any, Optional, List, Union
from fastapi import Request, HTTPException, status
from pydantic import BaseModel, ValidationError
from core.logging import get_logger
from core.exceptions import ValidationError as AppValidationError

logger = get_logger(__name__)


class InputSanitizer:
    """Input sanitization utilities."""

    # Dangerous patterns to filter out
    DANGEROUS_PATTERNS = [
        r'<script[^>]*>.*?</script>',  # Script tags
        r'javascript:',                 # JavaScript URLs
        r'on\w+\s*=',                  # Event handlers
        r'<iframe[^>]*>.*?</iframe>',  # Iframes
        r'<object[^>]*>.*?</object>',  # Object/embed tags
        r'<embed[^>]*>.*?</embed>',    # Embed tags
        r'<form[^>]*>.*?</form>',      # Form tags
        r'<input[^>]*>',               # Input tags
        r'<meta[^>]*>',                # Meta tags
        r'<\?php.*?\?>',               # PHP tags
        r'<%.*?%>',                    # ASP/JSP tags
    ]

    # SQL injection patterns
    SQL_INJECTION_PATTERNS = [
        r';\s*(drop|delete|update|insert|alter|create|truncate)\s',
        r'union\s+select',
        r'--\s*$',  # SQL comments
        r'/\*.*?\*/',  # Multi-line comments
        r';\s*$',  # Semicolon at end
    ]

    @staticmethod
    def sanitize_string(input_str: str) -> str:
        """Sanitize string input by removing dangerous content."""
        if not isinstance(input_str, str):
            return str(input_str)

        sanitized = input_str

        # Remove dangerous HTML/script content
        for pattern in InputSanitizer.DANGEROUS_PATTERNS:
            sanitized = re.sub(pattern, '', sanitized, flags=re.IGNORECASE | re.DOTALL)

        # Basic HTML entity encoding for remaining angle brackets
        sanitized = sanitized.replace('<', '&lt;').replace('>', '&gt;')

        return sanitized.strip()

    @staticmethod
    def validate_no_sql_injection(input_str: str) -> bool:
        """Check for potential SQL injection patterns."""
        if not isinstance(input_str, str):
            return True

        for pattern in InputSanitizer.SQL_INJECTION_PATTERNS:
            if re.search(pattern, input_str, re.IGNORECASE):
                return False
        return True

    @staticmethod
    def validate_json_structure(data: Any, max_depth: int = 10, max_size: int = 1024*1024) -> bool:
        """Validate JSON structure for safety."""
        def check_depth(obj: Any, current_depth: int = 0) -> bool:
            if current_depth > max_depth:
                return False

            if isinstance(obj, dict):
                for key, value in obj.items():
                    if not isinstance(key, str) or len(key) > 1000:
                        return False
                    if not check_depth(value, current_depth + 1):
                        return False
            elif isinstance(obj, list):
                if len(obj) > 10000:  # Reasonable limit for arrays
                    return False
                for item in obj:
                    if not check_depth(item, current_depth + 1):
                        return False
            elif isinstance(obj, str):
                if len(obj) > 100000:  # Reasonable limit for strings
                    return False

            return True

        try:
            json_str = json.dumps(data) if not isinstance(data, str) else data
            if len(json_str) > max_size:
                return False
            parsed = json.loads(json_str)
            return check_depth(parsed)
        except (json.JSONDecodeError, TypeError):
            return False

    @staticmethod
    def validate_url(url: str) -> bool:
        """Validate URL format and security."""
        if not isinstance(url, str) or not url.strip():
            return False

        # Basic URL pattern
        url_pattern = re.compile(
            r'^https?://'  # http:// or https://
            r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'  # domain...
            r'localhost|'  # localhost...
            r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'  # ...or ip
            r'(?::\d+)?'  # optional port
            r'(?:/?|[/?]\S+)$', re.IGNORECASE)

        if not url_pattern.match(url):
            return False

        # Additional security checks
        if any(dangerous in url.lower() for dangerous in ['javascript:', 'data:', 'vbscript:']):
            return False

        return True

    @staticmethod
    def validate_file_upload(filename: str, content_type: str, file_size: int) -> bool:
        """Validate file upload parameters."""
        # Check filename for dangerous patterns
        if not filename or '..' in filename or '/' in filename or '\\' in filename:
            return False

        # Validate file extension matches content type
        allowed_extensions = {
            'application/pdf': ['.pdf'],
            'text/plain': ['.txt', '.csv', '.json'],
            'application/json': ['.json'],
            'text/csv': ['.csv'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
        }

        if content_type in allowed_extensions:
            file_ext = '.' + filename.split('.')[-1].lower()
            if file_ext not in allowed_extensions[content_type]:
                return False

        # Check file size (50MB limit)
        if file_size > 50 * 1024 * 1024:
            return False

        return True


class InputValidationMiddleware:
    """Middleware for comprehensive input validation and sanitization."""

    def __init__(self, app):
        self.app = app
        self.sanitizer = InputSanitizer()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Intercept request processing
        async def receive_with_validation():
            message = await receive()

            if message["type"] == "http.request":
                # Get request body if present
                body = message.get("body", b"")
                if body:
                    try:
                        # Try to parse as JSON for validation
                        json_data = json.loads(body.decode('utf-8'))
                        if not self.sanitizer.validate_json_structure(json_data):
                            await self._send_error(send, "Invalid JSON structure", 400)
                            return

                        # Sanitize string values in JSON
                        sanitized_data = self._sanitize_json_data(json_data)
                        message["body"] = json.dumps(sanitized_data).encode('utf-8')

                    except (json.JSONDecodeError, UnicodeDecodeError):
                        # Not JSON, check for dangerous content in raw body
                        body_str = body.decode('utf-8', errors='ignore')
                        if not self.sanitizer.validate_no_sql_injection(body_str):
                            await self._send_error(send, "Potentially dangerous content detected", 400)
                            return

            return message

        await self.app(scope, receive_with_validation, send)

    def _sanitize_json_data(self, data: Any) -> Any:
        """Recursively sanitize string values in JSON data."""
        if isinstance(data, dict):
            return {key: self._sanitize_json_data(value) for key, value in data.items()}
        elif isinstance(data, list):
            return [self._sanitize_json_data(item) for item in data]
        elif isinstance(data, str):
            return self.sanitizer.sanitize_string(data)
        else:
            return data

    async def _send_error(self, send, message: str, status_code: int):
        """Send error response."""
        await send({
            'type': 'http.response.start',
            'status': status_code,
            'headers': [
                [b'content-type', b'application/json'],
            ],
        })
        await send({
            'type': 'http.response.body',
            'body': json.dumps({
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': message
                }
            }).encode('utf-8'),
        })


class RequestValidator:
    """Request validation utilities."""

    @staticmethod
    def validate_pagination_params(page: int = 1, limit: int = 10) -> tuple[int, int]:
        """Validate pagination parameters."""
        if page < 1:
            page = 1
        if limit < 1 or limit > 100:
            limit = min(max(limit, 1), 100)

        return page, limit

    @staticmethod
    def validate_text_input(text: str, max_length: int = 10000) -> str:
        """Validate and sanitize text input."""
        if not isinstance(text, str):
            raise AppValidationError("Input must be a string")

        if len(text) > max_length:
            raise AppValidationError(f"Input exceeds maximum length of {max_length} characters")

        sanitizer = InputSanitizer()
        if not sanitizer.validate_no_sql_injection(text):
            raise AppValidationError("Input contains potentially dangerous content")

        return sanitizer.sanitize_string(text)

    @staticmethod
    def validate_id(id_value: Any, field_name: str = "ID") -> int:
        """Validate ID parameter."""
        try:
            id_int = int(id_value)
            if id_int <= 0:
                raise ValueError()
            return id_int
        except (ValueError, TypeError):
            raise AppValidationError(f"Invalid {field_name}: must be a positive integer")