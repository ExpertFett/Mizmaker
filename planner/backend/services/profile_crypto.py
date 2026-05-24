"""App-side encryption for stored server credentials (Olympus role passwords).

These are server-control credentials, so they're never stored plaintext and
never returned to the browser. We encrypt with Fernet (symmetric, AES-128-CBC +
HMAC) using PROFILE_ENC_KEY from the environment — kept on Railway, NOT in
Supabase, so a database leak alone can't expose passwords. The backend decrypts
only to make the server-side relay call to Olympus.

Generate a key once with: python -c "from services.profile_crypto import gen_key; print(gen_key())"
and set it as PROFILE_ENC_KEY on Railway.
"""

from __future__ import annotations

import os
from typing import Optional


class EncKeyMissing(RuntimeError):
    """Raised when an encrypt/decrypt is attempted but PROFILE_ENC_KEY is unset."""


def _fernet():
    key = os.environ.get("PROFILE_ENC_KEY")
    if not key:
        raise EncKeyMissing(
            "PROFILE_ENC_KEY is not set — cannot store or read server passwords. "
            "Generate one with profile_crypto.gen_key() and set it on Railway."
        )
    from cryptography.fernet import Fernet  # lazy import
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_secret(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a secret to a storable token. Empty/None -> None (no-op)."""
    if not plaintext:
        return None
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: Optional[str]) -> Optional[str]:
    """Decrypt a stored token back to plaintext. Empty/None -> None."""
    if not token:
        return None
    return _fernet().decrypt(token.encode("ascii")).decode("utf-8")


def gen_key() -> str:
    """Generate a fresh Fernet key (base64 str) for PROFILE_ENC_KEY."""
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode("ascii")
