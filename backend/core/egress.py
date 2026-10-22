"""
Outbound requests to addresses a user configured (a SaaS connector's base URL).

Inside the deployment network the sidecar can reach Postgres, Redis and Qdrant.
A connector whose base URL points there must not be able to read them, so every
connector request checks its URL first: http(s) only, and every address the host
resolves to must be public. Mirrors the Node API's egress firewall
(server/utils/egress-firewall.ts). Redirects are not followed (httpx's default),
so a public host cannot bounce a request inward.

SIDECAR_ALLOW_PRIVATE_EGRESS=true lifts the address check for local development
against a connector running on the same machine; it is ignored in production.
"""

import ipaddress
import socket
from typing import Optional
from urllib.parse import urlsplit

from core.service_auth import is_production


class EgressRefused(Exception):
    """The URL may not be requested from inside the deployment."""


def _blocked(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified or not ip.is_global)


def assert_public_url(url: str, resolver=socket.getaddrinfo) -> str:
    """Return `url` when it may be requested; raise EgressRefused otherwise."""
    import os
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise EgressRefused(f"Only http and https URLs may be requested, not {parts.scheme or 'none'}")
    host: Optional[str] = parts.hostname
    if not host:
        raise EgressRefused("The URL has no host")
    if not is_production() and os.getenv("SIDECAR_ALLOW_PRIVATE_EGRESS", "").lower() == "true":
        return url
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        try:
            addresses = sorted({info[4][0] for info in resolver(host, None)})
        except socket.gaierror:
            # Unresolvable: the request itself will fail; there is nothing to reach.
            return url
    for address in addresses:
        if _blocked(address.split("%")[0]):
            raise EgressRefused("Requests to private or reserved addresses are not allowed")
    return url
