"""
The sidecar reads and writes encrypted values in exactly the Node API's format
(server/utils/encryption.ts). The vectors below were produced by Node with the
test key; the Node suite (shared/schema/sealed-json.test.ts) opens one produced here.
"""

import pytest

KEY = "0123456789abcdef" * 4
NODE_UNBOUND = ("v3.4884fdaa.u.d2a1251fc25daca441befd88.7b8d31b7c630da44e713f7f72e2bc3c7."
                "b685fbafdae9c4a87f59d250d3bbb4f9d214bda6af69b16b17e92ac3dd1556b9bf80567e59fdd0e8c10d20db9104f73f28415318d54a")
NODE_BOUND = "v3.4884fdaa.b.6c734eb90f185cb8cea6b00c.742fb84afacddd7de27b51b2b4689f21.92d3a4f895003b7fd0faa6"


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", KEY)
    monkeypatch.delenv("APP_TOKEN_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("ENCRYPTION_KEYS_PREVIOUS", raising=False)


def test_opens_what_node_sealed():
    from core.sealed import decrypt
    assert decrypt(NODE_UNBOUND) == '{"api_key":"jira-secret","username":"ops@example.com"}'


def test_opens_an_owner_bound_value_only_with_its_owner():
    from core.sealed import decrypt
    assert decrypt(NODE_BOUND, "saas_connector:7:jira") == "bound-value"
    with pytest.raises(Exception):
        decrypt(NODE_BOUND, "saas_connector:8:jira")
    with pytest.raises(ValueError, match="requires its owner"):
        decrypt(NODE_BOUND)


def test_round_trips_credentials_and_reads_old_plaintext_rows():
    from core.sealed import seal_json, open_json, SEALED_KEY
    stored = seal_json({"api_key": "k", "username": "u"})
    assert set(stored) == {SEALED_KEY} and "k" not in stored[SEALED_KEY]
    assert open_json(stored) == {"api_key": "k", "username": "u"}
    assert open_json('{"api_key": "legacy"}') == {"api_key": "legacy"}
    assert open_json(None) == {}


def test_a_rotated_key_still_opens_old_values(monkeypatch):
    from core.sealed import decrypt
    monkeypatch.setenv("ENCRYPTION_KEY", "f" * 64)
    monkeypatch.setenv("ENCRYPTION_KEYS_PREVIOUS", KEY)
    assert "jira-secret" in decrypt(NODE_UNBOUND)


def test_a_wrong_key_does_not_open_anything(monkeypatch):
    from core.sealed import decrypt
    monkeypatch.setenv("ENCRYPTION_KEY", "f" * 64)
    with pytest.raises(ValueError, match="not configured"):
        decrypt(NODE_UNBOUND)
