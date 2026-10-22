"""
The production sidecar answers only the Node API, and only for the organization
Node verified. These tests run the real production app (service_main) with its
middleware and routers; only the connector store is replaced.
"""

import pytest
from fastapi.testclient import TestClient

TOKEN = "t" * 40


@pytest.fixture
def client(monkeypatch):
    # Import first: core.config loads a local .env, which would set keys after we clear them.
    import service_main
    from core.saas_connectors import connector_manager

    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("SIDECAR_SERVICE_TOKEN", TOKEN)
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(key, raising=False)

    loaded = []

    async def load_org_state(org_id):
        loaded.append(org_id)
        connector_manager.org_connectors.setdefault(org_id, {})

    monkeypatch.setattr(connector_manager, "load_org_state", load_org_state)
    connector_manager.org_connectors.clear()

    app = service_main.create_app()
    # No database in unit tests: skip the pool, keep the config check.
    app.router.lifespan_context = _config_only_lifespan
    with TestClient(app) as c:
        c.loaded = loaded
        yield c


from contextlib import asynccontextmanager


@asynccontextmanager
async def _config_only_lifespan(_app):
    from core.service_auth import assert_service_config
    assert_service_config()
    yield


def headers(org="7", token=TOKEN):
    h = {"X-Service-Token": token}
    if org is not None:
        h["X-Organization-Id"] = org
    return h


def test_health_needs_no_token(client):
    assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize("token", [None, "wrong", TOKEN[:-1]])
def test_refuses_a_caller_without_the_service_token(client, token):
    h = {} if token is None else {"X-Service-Token": token, "X-Organization-Id": "7"}
    response = client.get("/api/saas/connectors", headers=h)
    assert response.status_code == 401
    assert client.loaded == []


def test_refuses_a_tenant_route_without_an_organization(client):
    response = client.get("/api/saas/connectors", headers=headers(org=None))
    assert response.status_code == 400
    assert client.loaded == []


def test_takes_the_organization_from_the_header_not_the_query(client):
    response = client.get("/api/saas/connectors?organization_id=1", headers=headers(org="7"))
    assert response.status_code == 200
    assert client.loaded == [7]


@pytest.mark.parametrize("org", ["0", "-3", "7abc", "99999999999"])
def test_refuses_a_malformed_organization(client, org):
    assert client.get("/api/saas/connectors", headers=headers(org=org)).status_code == 400


def test_development_only_routes_are_not_mounted(client):
    for path in ("/api/v1/auth/login", "/api/v1/memory/memories", "/api/v1/embeddings/batch",
                 "/api/v1/scraping/pdf/parse", "/api/v1/orchestration/agents", "/docs", "/openapi.json"):
        assert client.post(path, headers=headers()).status_code in (404, 405), path


def test_production_refuses_to_start_without_a_token(monkeypatch):
    import service_main  # noqa: F401 -- load .env before setting the environment under test
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.delenv("SIDECAR_SERVICE_TOKEN", raising=False)
    for key in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    from core.service_auth import assert_service_config
    with pytest.raises(RuntimeError, match="SIDECAR_SERVICE_TOKEN"):
        assert_service_config()


def test_production_refuses_shared_ai_keys(monkeypatch):
    import service_main  # noqa: F401 -- load .env before setting the environment under test
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("SIDECAR_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-platform")
    from core.service_auth import assert_service_config
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        assert_service_config()
