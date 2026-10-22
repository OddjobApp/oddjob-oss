"""
A connector's base URL is typed by a user; inside the deployment it must not
reach Postgres, Redis, Qdrant or any other private address.
"""

import socket

import pytest

from core.egress import EgressRefused, assert_public_url


def resolver(table):
    def lookup(host, _port):
        if host not in table:
            raise socket.gaierror("not found")
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (addr, 0)) for addr in table[host]]
    return lookup


@pytest.fixture(autouse=True)
def production(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("SIDECAR_ALLOW_PRIVATE_EGRESS", "true")  # ignored in production


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:6379/",
    "http://10.0.0.5/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
])
def test_refuses_private_literal_addresses(url):
    with pytest.raises(EgressRefused):
        assert_public_url(url, resolver({}))


def test_refuses_a_name_that_resolves_privately():
    lookup = resolver({"qdrant": ["172.18.0.5"], "mixed.example": ["93.184.216.34", "10.1.2.3"]})
    with pytest.raises(EgressRefused):
        assert_public_url("http://qdrant:6333/collections", lookup)
    # One private address among public ones is enough to refuse.
    with pytest.raises(EgressRefused):
        assert_public_url("https://mixed.example/rest/api/3/myself", lookup)


def test_allows_a_public_host():
    url = "https://acme.atlassian.net/rest/api/3/myself"
    assert assert_public_url(url, resolver({"acme.atlassian.net": ["104.192.141.1"]})) == url


@pytest.mark.parametrize("url", ["file:///etc/passwd", "gopher://x/", "ftp://example.com/"])
def test_refuses_other_schemes(url):
    with pytest.raises(EgressRefused):
        assert_public_url(url, resolver({}))


def test_development_may_opt_into_private_targets(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "development")
    assert assert_public_url("http://127.0.0.1:8080/", resolver({})) == "http://127.0.0.1:8080/"
