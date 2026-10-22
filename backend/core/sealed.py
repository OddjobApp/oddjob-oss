"""
Encrypted values in the format the Node API writes (server/utils/encryption.ts).

AES-256-GCM, hex, dot-separated:
    v3.<kid>.<b|u>.<iv>.<tag>.<ciphertext>   current: names its key; b = owner-bound
    v2.<iv>.<tag>.<ciphertext>               owner-bound, key not named
    <iv>.<tag>.<ciphertext>                  legacy, unbound

Keys come from ENCRYPTION_KEY (or APP_TOKEN_ENCRYPTION_KEY), with
ENCRYPTION_KEYS_PREVIOUS (comma-separated) for rotation: the current key seals,
every key in the ring opens. A key is 64 hex characters or base64 of 32 bytes;
<kid> is the first 8 hex characters of its SHA-256.

SaaS connector credentials are stored as {"__sealed": "<ciphertext>"} in
saas_connectors.credentials, by both services.
"""

import hashlib
import json
import os
import base64
from typing import Any, List, Optional, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SEALED_KEY = "__sealed"
_IV_LEN = 12
_TAG_LEN = 16


def _decode_key(raw: str, name: str) -> bytes:
    value = raw.strip()
    key = bytes.fromhex(value) if len(value) == 64 else base64.b64decode(value)
    if len(key) != 32:
        raise ValueError(f"{name} must decode to exactly 32 bytes")
    return key


def _key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()[:8]


def _keyring() -> List[Tuple[str, bytes]]:
    raw = os.getenv("ENCRYPTION_KEY") or os.getenv("APP_TOKEN_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY is not set")
    keys = [_decode_key(raw, "ENCRYPTION_KEY")]
    for entry in (os.getenv("ENCRYPTION_KEYS_PREVIOUS") or "").split(","):
        if entry.strip():
            keys.append(_decode_key(entry, "Each ENCRYPTION_KEYS_PREVIOUS entry"))
    ring, seen = [], set()
    for key in keys:
        kid = _key_id(key)
        if kid not in seen:
            seen.add(kid)
            ring.append((kid, key))
    return ring


def _seal(key: bytes, plaintext: str, aad: Optional[str]) -> str:
    iv = os.urandom(_IV_LEN)
    out = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), aad.encode("utf-8") if aad is not None else None)
    ciphertext, tag = out[:-_TAG_LEN], out[-_TAG_LEN:]
    return f"{iv.hex()}.{tag.hex()}.{ciphertext.hex()}"


def _open(key: bytes, body: str, aad: Optional[str]) -> str:
    parts = body.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid encrypted format")
    iv, tag, ciphertext = (bytes.fromhex(p) for p in parts)
    data = AESGCM(key).decrypt(iv, ciphertext + tag, aad.encode("utf-8") if aad is not None else None)
    return data.decode("utf-8")


def encrypt(plaintext: str, aad: Optional[str] = None) -> str:
    kid, key = _keyring()[0]
    return f"v3.{kid}.{'b' if aad is not None else 'u'}.{_seal(key, plaintext, aad)}"


def decrypt(stored: str, aad: Optional[str] = None) -> str:
    kid: Optional[str] = None
    if stored.startswith("v3."):
        pieces = stored[3:].split(".")
        if len(pieces) != 5 or pieces[1] not in ("b", "u"):
            raise ValueError("Invalid encrypted format")
        kid, bound, body = pieces[0], pieces[1] == "b", ".".join(pieces[2:])
    elif stored.startswith("v2."):
        bound, body = True, stored[3:]
    else:
        bound, body = False, stored
    if bound and aad is None:
        raise ValueError("Owner-bound ciphertext requires its owner")
    binding = aad if bound else None
    ring = _keyring()
    if kid is not None:
        for entry_kid, key in ring:
            if entry_kid == kid:
                return _open(key, body, binding)
        raise ValueError(f"Encrypted with key {kid}, which is not configured")
    last: Optional[Exception] = None
    for _, key in ring:
        try:
            return _open(key, body, binding)
        except Exception as error:  # Wrong key: try the next one.
            last = error
    raise last or ValueError("No encryption key configured")


def seal_json(value: Any) -> dict:
    """The stored form of a credentials object."""
    return {SEALED_KEY: encrypt(json.dumps(value or {}, default=str))}


def open_json(stored: Any) -> dict:
    """Credentials from their stored form. A plaintext row from before sealing is returned as is."""
    if isinstance(stored, str):
        stored = json.loads(stored) if stored else {}
    if isinstance(stored, dict) and isinstance(stored.get(SEALED_KEY), str):
        return json.loads(decrypt(stored[SEALED_KEY]))
    return stored or {}
