"""
acdd.core.http_client
======================

Tiny, dependency-free JSON-over-HTTP helpers built on the Python standard
library (``urllib``). Used by the registry (to reach the local Ollama embedding
API) and the doc compiler (to reach the local Ollama generation API).

Keeping these on the stdlib means the ACDD core has a single third-party
dependency (Pydantic); ``requests``/``httpx`` and the web framework are only
needed for the optional HTTP *server*, not the client paths.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping

logger = logging.getLogger("acdd.http")

__all__ = ["HttpError", "post_json", "get_json"]


class HttpError(RuntimeError):
    """Raised for any transport-, status- or decode-level HTTP failure."""

    def __init__(self, message: str, *, status: int | None = None, url: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.url = url


def _decode(raw: bytes) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HttpError(f"Response body was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        # Callers in this codebase always expect an object; normalise anything
        # else under a predictable key rather than surprising them with a list.
        return {"data": parsed}
    return parsed


def post_json(
    url: str,
    payload: Mapping[str, Any],
    *,
    timeout: float = 30.0,
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """POST ``payload`` as JSON and return the decoded JSON response.

    Raises:
        HttpError: On connection failure, non-2xx status, or a non-JSON body.
    """
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _decode(response.read())
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:  # pragma: no cover - defensive
            pass
        raise HttpError(
            f"POST {url} failed with HTTP {exc.code}: {body[:500]}",
            status=exc.code,
            url=url,
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HttpError(f"POST {url} failed: {exc}", url=url) from exc


def get_json(
    url: str,
    params: Mapping[str, Any] | None = None,
    *,
    timeout: float = 30.0,
    headers: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """GET ``url`` (optionally with query ``params``) and return decoded JSON."""
    if params:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{url}?{query}"
    request = urllib.request.Request(url, method="GET")
    request.add_header("Accept", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _decode(response.read())
    except urllib.error.HTTPError as exc:
        raise HttpError(f"GET {url} failed with HTTP {exc.code}", status=exc.code, url=url) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise HttpError(f"GET {url} failed: {exc}", url=url) from exc
