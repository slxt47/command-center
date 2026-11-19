"""Terminal-Tabs (seit 3.9.0, 19.11.2026): mehrere Terminals je Benutzer, die weiterlaufen, bis man sie schließt.

Jeder Tab ist eine tmux-Sitzung auf dem HOST (eigener Server-Socket `-L cc`, Sitzung `t-<id>`). Der WebSocket hängt
sich nur an (attach); Seite neu laden, Browser zu oder Command-Center-Neustart beenden die Shell nicht. Schließen des
Tabs = kill-session. Liste je Benutzer in /data/terminal-tabs.json (Titel, Reihenfolge).

Wer nicht Superadmin ist, bekommt die Shell als SEIN Linux-Benutzer und mit no_new_privs (setpriv): setuid-Programme
wie sudo/su/pkexec können dann keine Rechte mehr erlangen – Root ist aus dem Command Center heraus unmöglich.
"""
import json
import os
import re
import secrets
import subprocess
import threading
import time

from dashboard.base import _ns

DATEI = os.environ.get("DASH_TERM_TABS", "/data/terminal-tabs.json")
MAX_TABS = 8
_lock = threading.Lock()
_BENUTZER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_ID_RE = re.compile(r"^[a-z0-9]{8}$")
# Optionen des tmux-Servers: unsichtbar wie ein normales Terminal (keine Statuszeile, kein Alternativ-Bildschirm →
# Rückblick bleibt im Browser), großer Verlauf, Shell immer bash (auch bei Konten mit nologin)
_TMUX_OPTS = [";", "set", "-g", "status", "off", ";", "set", "-g", "history-limit", "50000", ";", "set", "-g", "escape-time", "0",
              ";", "set", "-g", "default-shell", "/bin/bash", ";", "set", "-g", "mouse", "off",
              ";", "set", "-g", "default-terminal", "xterm-256color", ";", "set", "-ga", "terminal-overrides", ",xterm*:smcup@:rmcup@",
              ";", "set", "-g", "set-titles", "off", ";", "set", "-g", "exit-empty", "on"]


def _laden():
    try:
        with open(DATEI) as f:
            return json.load(f)
    except Exception:
        return {}


def _speichern(d):
    tmp = DATEI + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, DATEI)


# ---------------------------------------------------------------- Wer bin ich auf dem Host?
def _konto(benutzer):
    """(uid, gid, home) des Host-Benutzers."""
    r = subprocess.run(_ns(["getent", "passwd", benutzer]), capture_output=True, text=True, timeout=6)
    p = r.stdout.strip().split(":")
    if r.returncode != 0 or len(p) < 7:
        raise ValueError("Kein Linux-Konto für diesen Benutzer")
    return int(p[2]), int(p[3]), p[5] or "/"


def befehl(benutzer, superadmin, *tmux_args, eigene_scope=False):
    """tmux-Befehl im Host-Namensraum – als root (Superadmin) oder als der Benutzer selbst, ohne Rechteausweitung.
    eigene_scope=True (3.12.1): über `systemd-run --scope` starten → der tmux-SERVER gehört nicht zur cgroup des
    Command-Center-Containers und überlebt dessen Neustart/Neuerstellung (vorher hat Docker ihn mit beendet)."""
    tmux = ["tmux", "-L", "cc", "-f", "/dev/null", *tmux_args]
    vorne = ["systemd-run", "--scope", "--quiet", "--collect", f"--unit=cc-terminal-{secrets.token_hex(4)}",
             "--description=Command-Center-Terminal"] if eigene_scope and _host_hat("systemd") else []
    if superadmin:
        return _ns([*vorne, "env", "HOME=/root", "USER=root", "LOGNAME=root", "SHELL=/bin/bash",
                    "TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8", *_in("/root", *tmux)])
    if not _BENUTZER_RE.match(benutzer or ""):
        raise ValueError("Ungültiger Benutzer")
    uid, gid, home = _konto(benutzer)
    if uid == 0:
        raise ValueError("root ohne Superadmin-Rolle ist nicht erlaubt")
    home = home if home and home != "/nonexistent" else "/tmp"
    return _ns([*vorne, "setpriv", "--reuid", str(uid), "--regid", str(gid), "--init-groups", "--no-new-privs", "--inh-caps=-all",
                "env", "-i", f"HOME={home}", f"USER={benutzer}", f"LOGNAME={benutzer}", "SHELL=/bin/bash",
                "PATH=/usr/local/bin:/usr/bin:/bin", "TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8", *_in(home, *tmux)])


def _in(ordner, *befehl):
    """cd + exec – überall verfügbar (env --chdir fehlt z. B. in BusyBox)."""
    return ["sh", "-c", 'cd "$0" 2>/dev/null || cd /; exec "$@"', ordner, *befehl]


_HAT = {}


def _host_hat(was):
    """Gibt es auf dem Host systemd bzw. tmux? (3.13.0: Systeme ohne systemd/tmux, z. B. Alpine, Container-Hosts)"""
    if was not in _HAT:
        pruef = ["test", "-d", "/run/systemd/system"] if was == "systemd" else ["sh", "-c", "command -v tmux"]
        try:
            _HAT[was] = subprocess.run(_ns(pruef), capture_output=True, timeout=6).returncode == 0
        except Exception:
            _HAT[was] = False
    return _HAT[was]


def tmux_da():
    return _host_hat("tmux")


def shell_befehl(benutzer, superadmin):
    """Einfache Shell ohne tmux (Rückfall): als root bzw. als der Benutzer mit no_new_privs – wie die tmux-Variante."""
    sh = ["sh", "-c", "command -v bash >/dev/null && exec bash -l || exec sh -l"]
    if superadmin:
        return _ns(["env", "HOME=/root", "USER=root", "LOGNAME=root", "TERM=xterm-256color", "LANG=C.UTF-8", *_in("/root", *sh)])
    if not _BENUTZER_RE.match(benutzer or ""):
        raise ValueError("Ungültiger Benutzer")
    uid, gid, home = _konto(benutzer)
    if uid == 0:
        raise ValueError("root ohne Superadmin-Rolle ist nicht erlaubt")
    home = home if home and home != "/nonexistent" else "/tmp"
    return _ns(["setpriv", "--reuid", str(uid), "--regid", str(gid), "--init-groups", "--no-new-privs", "--inh-caps=-all",
                "env", "-i", f"HOME={home}", f"USER={benutzer}", f"LOGNAME={benutzer}",
                "PATH=/usr/local/bin:/usr/bin:/bin", "TERM=xterm-256color", "LANG=C.UTF-8", *_in(home, *sh)])


def _lebende(benutzer, superadmin):
    try:
        r = subprocess.run(befehl(benutzer, superadmin, "list-sessions", "-F", "#{session_name}"),
                           capture_output=True, text=True, timeout=8)
        return {s for s in r.stdout.split() if s.startswith("t-")}
    except Exception:
        return set()


# ---------------------------------------------------------------- Tabs
def liste(benutzer, superadmin):
    """Tabs des Benutzers; Tabs, deren Shell beendet wurde (exit), fallen weg. Ohne Tab wird einer angelegt."""
    with _lock:
        d = _laden()
        tabs = d.get(benutzer, [])
        leben = _lebende(benutzer, superadmin)
        # 3.12.1: Tabs verschwinden nur durch Schließen oder `exit` (siehe beendet()). Ist die Sitzung weg (Server-
        # Neustart), bleibt der Tab mit Name/Position und bekommt beim Öffnen eine frische Shell.
        if not tabs:
            tabs = [{"id": secrets.token_hex(4), "titel": "Terminal 1", "erstellt": int(time.time()), "neu_bis": time.time() + 60}]
        tabs.sort(key=lambda t: not t.get("angeheftet"))          # angeheftete immer vorne (stabil)
        d[benutzer] = tabs
        _speichern(d)
        return [{"id": t["id"], "titel": t["titel"], "angeheftet": bool(t.get("angeheftet")),
                 "laeuft": f"t-{t['id']}" in leben} for t in tabs]


# ---------------------------------------------------------------- Einstellungen je Benutzer (3.9.1)
LAYOUTS = ("oben", "seite")


def einstellungen(benutzer):
    return {"layout": "oben", **_laden().get("_einstellungen", {}).get(benutzer, {})}


def layout_setzen(benutzer, layout):
    if layout not in LAYOUTS:
        return {"error": "Unbekanntes Layout"}
    with _lock:
        d = _laden()
        d.setdefault("_einstellungen", {}).setdefault(benutzer, {})["layout"] = layout
        _speichern(d)
    return {"success": True}


def aendern(benutzer, tid, titel=None, angeheftet=None):
    """Name und/oder Anheften eines Tabs ändern."""
    if titel is not None:
        titel = re.sub(r"[\x00-\x1f]", "", titel).strip()[:30]
        if not titel:
            return {"error": "Name fehlt"}
    with _lock:
        d = _laden()
        tabs = d.get(benutzer, [])
        for t in tabs:
            if t["id"] == tid:
                if titel is not None:
                    t["titel"] = titel
                if angeheftet is not None:
                    t["angeheftet"] = bool(angeheftet)
                tabs.sort(key=lambda x: not x.get("angeheftet"))
                _speichern(d)
                return {"success": True}
    return {"error": "Tab nicht gefunden"}


def reihenfolge(benutzer, ids):
    """Neue Reihenfolge (Ziehen/Verschieben). Unbekannte IDs werden ignoriert, fehlende hinten angehängt;
    angeheftete bleiben vorne."""
    with _lock:
        d = _laden()
        tabs = d.get(benutzer, [])
        pos = {i: n for n, i in enumerate(ids or []) if isinstance(i, str)}
        tabs.sort(key=lambda t: (not t.get("angeheftet"), pos.get(t["id"], 10_000)))
        d[benutzer] = tabs
        _speichern(d)
        return {"success": True, "ids": [t["id"] for t in tabs]}


def neu(benutzer, titel=""):
    with _lock:
        d = _laden()
        tabs = d.get(benutzer, [])
        if len(tabs) >= MAX_TABS:
            return {"error": f"Höchstens {MAX_TABS} Terminals gleichzeitig – schließ zuerst eines."}
        nummern = [int(m.group(1)) for t in tabs for m in [re.fullmatch(r"Terminal (\d+)", t["titel"])] if m]
        t = {"id": secrets.token_hex(4), "titel": (titel or "").strip()[:30] or f"Terminal {max(nummern, default=0) + 1}",
             "erstellt": int(time.time()), "neu_bis": time.time() + 60}
        tabs.append(t)
        d[benutzer] = tabs
        _speichern(d)
        return {"success": True, "id": t["id"], "titel": t["titel"]}


def umbenennen(benutzer, tid, titel):
    titel = re.sub(r"[\x00-\x1f]", "", (titel or "")).strip()[:30]
    if not titel:
        return {"error": "Name fehlt"}
    with _lock:
        d = _laden()
        for t in d.get(benutzer, []):
            if t["id"] == tid:
                t["titel"] = titel
                _speichern(d)
                return {"success": True}
    return {"error": "Tab nicht gefunden"}


def schliessen(benutzer, superadmin, tid):
    if not _ID_RE.match(tid or ""):
        return {"error": "Ungültiger Tab"}
    with _lock:
        d = _laden()
        tabs = d.get(benutzer, [])
        if not any(t["id"] == tid for t in tabs):
            return {"error": "Tab nicht gefunden"}
        if any(t["id"] == tid and t.get("angeheftet") for t in tabs):
            return {"error": "Angeheftete Terminals zuerst lösen, dann schließen."}
        d[benutzer] = [t for t in tabs if t["id"] != tid]
        _speichern(d)
    try:
        subprocess.run(befehl(benutzer, superadmin, "kill-session", "-t", f"t-{tid}"), capture_output=True, timeout=8)
    except Exception:
        pass
    return {"success": True}


def beendet(benutzer, superadmin, tid):
    """Nach dem Ende der Verbindung: Gibt es die Sitzung nicht mehr, hat der Benutzer `exit` getippt → Tab entfernen.
    True = Tab entfernt."""
    try:
        if subprocess.run(befehl(benutzer, superadmin, "has-session", "-t", f"t-{tid}"), capture_output=True, timeout=8).returncode == 0:
            return False
    except Exception:
        return False
    with _lock:
        d = _laden()
        vorher = len(d.get(benutzer, []))
        d[benutzer] = [t for t in d.get(benutzer, []) if t["id"] != tid]
        if len(d[benutzer]) != vorher:
            _speichern(d)
    return True


def gehoert(benutzer, tid):
    return bool(_ID_RE.match(tid or "")) and any(t["id"] == tid for t in _laden().get(benutzer, []))


def anhaengen_befehl(benutzer, superadmin, tid, cols, rows):
    """Sitzung bei Bedarf anlegen (mit Fenstergröße), dann den attach-Befehl liefern."""
    name = f"t-{tid}"
    if subprocess.run(befehl(benutzer, superadmin, "has-session", "-t", name), capture_output=True, timeout=8).returncode != 0:
        r = subprocess.run(befehl(benutzer, superadmin, "new-session", "-d", "-s", name, "-x", str(cols), "-y", str(rows),
                                  "bash", "-l", *_TMUX_OPTS, eigene_scope=True), capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or "tmux konnte nicht starten").strip()[:200])
    with _lock:
        d = _laden()
        for t in d.get(benutzer, []):
            if t["id"] == tid:
                t.pop("neu_bis", None)
        _speichern(d)
    return befehl(benutzer, superadmin, "attach-session", "-t", name)
