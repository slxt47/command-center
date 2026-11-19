"""Optionale Funktionen je Server (seit 3.13.0): alles, was es nur auf einem bestimmten Server gibt.

Ohne Datei ist das Command Center neutral: keine eingebetteten Apps, keine Startseiten-/n8n-Anbindung. Wer etwas davon
nutzt, legt /data/funktionen.json an (Beispiel: config/funktionen.beispiel.json):

{
  "einbettungen": {                         Seiten „Konten“, „Backups“, „Werkzeuge“, „Codes“ (je eine oder mehrere Apps)
    "konten":    [{"id": "hetzner", "name": "Hetzner", "port": 9301, "host": "hetzner.example.org", "token": "hetzner"}],
    "werkzeuge": [{"id": "tools", "name": "IT-Tools", "port": 89, "host": "tools.example.org"}]
  },
  "startseite":   {"url": "https://dash.example.org"},   Seite „Mein Dashboard“ (braucht /data/startseite-token)
  "automationen": {"url": "https://n8n.example.org"},    Seite „Automationen“ (braucht /data/n8n-api-key)
  "profilbild_ebenen": false,                             zusätzliches Profilbild „Ebenen“ (eigene Grafik unter static/icons/profil)
  "iso_verzeichnisse": ["/var/lib/libvirt/images"],       Ziel für ISO-Downloads (erstes beschreibbares)
  "ntfy_senden": "/pfad/zu/ntfy-send.sh"                  Push bei Passwort-Ereignissen (optional)
}
Eingebettete Apps laufen nur lokal (127.0.0.1:<port>); „host“ ist der Host-Header, den die App erwartet.
"""
import json
import os
import re
import threading
import time
from pathlib import Path

DATEI = Path(os.environ.get("DASH_FUNKTIONEN", "/data/funktionen.json"))
SEITEN = ("konten", "backups", "werkzeuge", "codes")
_lock = threading.Lock()
_cache = {"t": 0.0, "d": None, "mtime": None}
_ID = re.compile(r"^[a-z][a-z0-9]{0,23}$")


def _laden():
    try:
        mtime = DATEI.stat().st_mtime
    except OSError:
        return {}, None
    with _lock:
        if _cache["mtime"] == mtime and time.time() - _cache["t"] < 30:
            return _cache["d"], mtime
    try:
        d = json.loads(DATEI.read_text(encoding="utf-8")) or {}
    except Exception:
        d = {}
    with _lock:
        _cache.update(t=time.time(), d=d, mtime=mtime)
    return d, mtime


def daten():
    return _laden()[0]


def einbettungen():
    """{seite: [{id, name, port, host, token}]} – nur gültige Einträge."""
    out = {}
    for seite, apps in (daten().get("einbettungen") or {}).items():
        if seite not in SEITEN or not isinstance(apps, list):
            continue
        gut = []
        for a in apps:
            try:
                if _ID.match(a["id"]) and 0 < int(a["port"]) < 65536:
                    gut.append({"id": a["id"], "name": str(a.get("name") or a["id"])[:30], "port": int(a["port"]),
                                "host": str(a.get("host") or "localhost")[:120], "token": a.get("token")})
            except (KeyError, TypeError, ValueError):
                continue
        if gut:
            out[seite] = gut
    return out


def apps():
    """{id: {port, host, token}} für dashboard/einbettung.py."""
    return {a["id"]: {"port": a["port"], "host": a["host"], "token": a["token"]} for l in einbettungen().values() for a in l}


def app_recht():
    """{id: seite} – das Recht heißt wie die Seite (konten, backups, werkzeuge, codes)."""
    return {a["id"]: seite for seite, l in einbettungen().items() for a in l}


def url(name):
    v = daten().get(name)
    return v.get("url") if isinstance(v, dict) and isinstance(v.get("url"), str) else None


def wert(name, standard=None):
    return daten().get(name, standard)


def oeffentlich(data_dir="/data"):
    """Was das Frontend wissen darf (für /api/me): welche Seiten es gibt, Namen der eingebetteten Apps."""
    st = url("startseite")
    au = url("automationen")
    return {
        "einbettungen": {s: [{"id": a["id"], "name": a["name"]} for a in l] for s, l in einbettungen().items()},
        "startseite": st if st and os.path.exists(os.path.join(data_dir, "startseite-token")) else None,
        "automationen": au if au and os.path.exists(os.path.join(data_dir, "n8n-api-key")) else None,
        # true oder Beschriftung (z. B. "slxt.dev")
        "profilbild_ebenen": wert("profilbild_ebenen", False) if isinstance(wert("profilbild_ebenen", False), str) else bool(wert("profilbild_ebenen", False)),
    }
