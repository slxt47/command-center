"""Eigenes Command-Center-Passwort (seit 3.5.0, 16.11.2026).

Hat ein Benutzer hier einen Eintrag, gilt für die Anmeldung am Command Center NUR noch dieses Passwort –
das Linux-Passwort (SSH, sudo) wird vom Command Center dann nicht mehr angenommen und bleibt unverändert.
Ohne Eintrag gilt wie bisher das Linux-Passwort.

Speicher: /data/cc-passwoerter.json (0600), nur scrypt-Hashes (N=2^15, r=8, p=1, 16 Byte Salz).
„Passwort ändern“ (Mein Konto) und „Passwort vergessen?“ ändern bei Benutzern mit Eintrag dieses Passwort statt chpasswd.

Kommandozeile (im Container, Passwort NUR über stdin):
    docker exec -i linux-dashboard python3 -m dashboard.ccpasswort setzen <benutzer>   < passwort
    docker exec linux-dashboard python3 -m dashboard.ccpasswort entfernen <benutzer>    # zurück zum Linux-Passwort
    docker exec linux-dashboard python3 -m dashboard.ccpasswort status
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time

from dashboard.base import DATA_DIR

DATEI = DATA_DIR / "cc-passwoerter.json"
N, R, P = 2 ** 15, 8, 1
_BENUTZER_RE = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")
_lock = threading.Lock()


def _laden():
    try:
        with open(DATEI) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _speichern(d):
    tmp = str(DATEI) + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(d, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, DATEI)


def _hash(pw, salz):
    return hashlib.scrypt(pw.encode(), salt=salz, n=N, r=R, p=P, maxmem=64 * 1024 * 1024, dklen=32)


def hat(benutzer):
    return bool(_laden().get(benutzer or "", {}).get("hash"))


def pruefen(benutzer, pw):
    e = _laden().get(benutzer or "")
    if not e or not e.get("hash"):
        return False
    try:
        art, n, r, p, salz, soll = e["hash"].split("$")
        if art != "scrypt":
            return False
        ist = hashlib.scrypt((pw or "").encode(), salt=base64.b64decode(salz), n=int(n), r=int(r), p=int(p),
                             maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(ist, base64.b64decode(soll))
    except (ValueError, KeyError):
        return False


def setzen(benutzer, pw):
    if not _BENUTZER_RE.match(benutzer or "") or not pw or len(pw) < 12 or len(pw) > 256:
        return False
    salz = secrets.token_bytes(16)
    h = f"scrypt${N}${R}${P}${base64.b64encode(salz).decode()}${base64.b64encode(_hash(pw, salz)).decode()}"
    with _lock:
        d = _laden()
        d[benutzer] = {"hash": h, "gesetzt": int(time.time())}
        _speichern(d)
    return True


def entfernen(benutzer):
    with _lock:
        d = _laden()
        if d.pop(benutzer, None) is None:
            return False
        _speichern(d)
    return True


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["setzen"] and len(a) == 2:
        pw = sys.stdin.readline().rstrip("\n")
        ok = setzen(a[1], pw)
        print("ok" if ok and pruefen(a[1], pw) else "FEHLER")
        sys.exit(0 if ok else 1)
    if a[:1] == ["entfernen"] and len(a) == 2:
        print("entfernt – Command Center nimmt wieder das Linux-Passwort" if entfernen(a[1]) else "kein Eintrag")
        sys.exit(0)
    if a == ["status"]:
        for b, e in sorted(_laden().items()):
            print(f"{b}: eigenes CC-Passwort seit {time.strftime('%d.%m.%Y %H:%M', time.localtime(e.get('gesetzt', 0)))}")
        sys.exit(0)
    sys.exit(__doc__)
