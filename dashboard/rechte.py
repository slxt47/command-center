"""Gruppen & Rechte (seit 3.8.0, 19.11.2026).

Superadmins (DASH_SUPERADMINS) dürfen weiter alles. Alle anderen Benutzer bekommen ihre Rechte aus Gruppen:
    Rechte eines Benutzers = Gruppe „alle“ (jeder Angemeldete) ∪ alle Gruppen, in denen er Mitglied ist.
Der Server prüft jedes Recht selbst (DashboardHandler._require_superadmin/_require_admin fragen recht_fuer()).
Was hier keinem Recht zugeordnet ist, bleibt Superadmins vorbehalten (Host-Netze, Storage-Pools, VM-XML, Rechteverwaltung).

Passwörter ANDERER Benutzer zurücksetzen darf nur der Inhaber (DASH_INHABER, Standard: erster Superadmin außer root) – auch kein
anderer Superadmin. Speicher: /data/gruppen.json (0600, atomar).
"""
import json
import os
import re
import threading
import time

DATEI = os.environ.get("DASH_GRUPPEN", "/data/gruppen.json")
def _inhaber():
    """DASH_INHABER, sonst der erste Superadmin außer root (sonst root)."""
    e = os.environ.get("DASH_INHABER", "").strip()
    if e:
        return e
    sa = [u.strip() for u in os.environ.get("DASH_SUPERADMINS", "root").split(",") if u.strip()]
    return next((u for u in sa if u != "root"), "root")


INHABER = _inhaber()
_lock = threading.Lock()

# (Schlüssel, Bereich, Name, Erklärung, kritisch). kritisch = kann den Server übernehmen bzw. Geheimnisse sehen.
RECHTE = [
    ("browser",              "Zugriff",    "Browser-Sitzungen",        "Eigene Browser im Command Center starten", False),
    ("verbindungen",         "Zugriff",    "Verbindungen",             "Eigene SSH-/RDP-Verbindungen anlegen und öffnen", False),
    ("vms.eigene",           "Zugriff",    "Eigene virtuelle Maschinen", "VMs anlegen und eigene VMs bedienen (früher „Admin“)", False),
    ("prozesse.sehen",       "System",     "Prozesse ansehen",         "Seite Prozesse", False),
    ("prozesse.beenden",     "System",     "Prozesse beenden",         "Beliebige Prozesse auf dem Server beenden", True),
    ("dienste.sehen",        "System",     "Dienste ansehen",          "Seite Dienste (systemd)", False),
    ("dienste.steuern",      "System",     "Dienste steuern",          "Dienste starten, stoppen, neu starten", True),
    ("updates.sehen",        "System",     "Updates ansehen",          "Offene Paket-Updates", False),
    ("updates.installieren", "System",     "Updates installieren",     "apt-Updates einspielen", True),
    ("terminal",             "System",     "Server-Terminal",          "Shell auf dem Server – als eigener Linux-Benutzer ohne sudo/su (nur Superadmins sind root)", True),
    ("docker.sehen",         "Container",  "Docker ansehen",           "Container, Logs, Statistik, Images, Netze, Volumes, Stacks", False),
    ("docker.steuern",       "Container",  "Container starten/stoppen", "Container und Stacks starten, stoppen, neu starten", False),
    ("docker.verwalten",     "Container",  "Docker verwalten",         "Container anlegen/löschen, Konsole, Dateien, Images, Netze, Volumes, Aufräumen", True),
    ("sicherheit.sehen",     "Sicherheit", "Sicherheit ansehen",       "Sicherheit & Sperren, Angriffs-Radar", False),
    ("sicherheit.sperren",   "Sicherheit", "IPs sperren/entsperren",   "Sperren am Cloudflare-Rand und an der Firewall", False),
    ("benachrichtigungen",   "Sicherheit", "Benachrichtigungen",       "ntfy-Meldungen lesen", False),
    ("benutzer.sehen",       "Sicherheit", "Benutzer ansehen",         "Benutzerliste und Gruppen", False),
    ("benutzer.verwalten",   "Sicherheit", "Benutzer verwalten",       "Benutzer anlegen/löschen und Gruppen zuweisen (nur Gruppen mit eigenen Rechten, keine Passwörter)", True),
    ("startseite",           "Werkzeuge",  "Mein Dashboard bearbeiten", "Kacheln der eigenen Startseite", False),
    ("automationen",         "Werkzeuge",  "Automationen",             "n8n-Workflows und Ben (Server-Arzt)", False),
    ("werkzeuge",            "Werkzeuge",  "IT-Tools",                 "Eingebettete IT-Tools", False),
    ("backups",              "Werkzeuge",  "Backups",                  "Sicherungen ansehen und wiederherstellen", True),
    ("konten",               "Werkzeuge",  "Konten",                   "Gespeicherte Zugänge (Konten-Übersicht)", True),
    ("codes",                "Werkzeuge",  "2FA-Codes",                "Einmal-Codes der eigenen Konten", True),
]
SCHLUESSEL = [r[0] for r in RECHTE]
KRITISCH = {r[0] for r in RECHTE if r[4]}

# Seite → Recht (Frontend blendet Menüpunkte danach ein)
SEITEN = {"processes": "prozesse.sehen", "services": "dienste.sehen", "updates": "updates.sehen", "terminal": "terminal",
          "docker": "docker.sehen", "vms": "vms.eigene", "connections": "verbindungen", "browser": "browser",
          "security": "sicherheit.sehen", "angriffe": "sicherheit.sehen", "notifications": "benachrichtigungen",
          "users": "benutzer.sehen", "startseite": "startseite", "automationen": "automationen", "werkzeuge": "werkzeuge",
          "backups": "backups", "konten": "konten", "codes": "codes"}

VORLAGEN = {
    "alle": ("Alle Angemeldeten", "Gilt automatisch für jeden, der sich anmelden kann.", ["browser", "verbindungen"]),
    "beobachter": ("Beobachter", "Darf überall hineinschauen, aber nichts ändern.",
                   ["prozesse.sehen", "dienste.sehen", "updates.sehen", "docker.sehen", "sicherheit.sehen", "benachrichtigungen"]),
    "docker-betreuer": ("Docker-Betreuer", "Container ansehen und neu starten – z. B. wenn eine Seite hängt.",
                        ["docker.sehen", "docker.steuern", "benachrichtigungen"]),
    "docker-admin": ("Docker-Admin", "Volle Docker-Verwaltung (entspricht Root!).", ["docker.sehen", "docker.steuern", "docker.verwalten", "benachrichtigungen"]),
    "system-admin": ("System-Admin", "Prozesse, Dienste, Updates und Terminal (entspricht Root!).",
                     ["prozesse.sehen", "prozesse.beenden", "dienste.sehen", "dienste.steuern", "updates.sehen", "updates.installieren", "terminal"]),
    "sicherheit": ("Sicherheit", "Angriffe beobachten, IPs sperren und entsperren.", ["sicherheit.sehen", "sicherheit.sperren", "benachrichtigungen"]),
    "vm-nutzer": ("VM-Nutzer", "Eigene virtuelle Maschinen anlegen und bedienen (früher „Admin“).", ["vms.eigene"]),
    "benutzerpflege": ("Benutzerpflege", "Benutzer anlegen und Gruppen zuweisen – Passwörter setzt nur der Inhaber.", ["benutzer.sehen", "benutzer.verwalten"]),
    "werkzeuge": ("Werkzeuge", "IT-Tools, Mein Dashboard und Automationen.", ["werkzeuge", "startseite", "automationen"]),
    "tresor": ("Tresor", "Konten, 2FA-Codes und Backups (sehr vertraulich).", ["konten", "codes", "backups"]),
}
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


# ---------------------------------------------------------------- Speicher
def _leer():
    return {"gruppen": {k: {"name": n, "beschreibung": b, "rechte": list(r)} for k, (n, b, r) in VORLAGEN.items()},
            "mitglieder": {}, "angelegt": int(time.time())}


def _laden():
    try:
        with open(DATEI) as f:
            d = json.load(f)
        d.setdefault("gruppen", {}).setdefault("alle", {"name": VORLAGEN["alle"][0], "beschreibung": VORLAGEN["alle"][1],
                                                        "rechte": list(VORLAGEN["alle"][2])})
        d.setdefault("mitglieder", {})
        return d
    except FileNotFoundError:
        return _leer()
    except Exception:
        return _leer()


def _speichern(d):
    tmp = DATEI + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, DATEI)


_cache = {"t": 0.0, "d": None}


def daten():
    with _lock:
        if _cache["d"] is None or time.time() - _cache["t"] > 5:
            _cache["d"], _cache["t"] = _laden(), time.time()
        return json.loads(json.dumps(_cache["d"]))


def _schreiben(d):
    with _lock:
        _speichern(d)
        _cache["d"], _cache["t"] = d, time.time()


def migrieren(admins_alt):
    """Einmalig: Mitglieder der alten Linux-Gruppe dashadmin → Gruppe vm-nutzer (Datei wird angelegt)."""
    if os.path.exists(DATEI):
        return
    d = _leer()
    for u in admins_alt:
        d["mitglieder"].setdefault(u, [])
        if "vm-nutzer" not in d["mitglieder"][u]:
            d["mitglieder"][u].append("vm-nutzer")
    try:
        _schreiben(d)
    except OSError:
        pass


# ---------------------------------------------------------------- Abfragen
def rechte_von(benutzer, superadmin=False):
    if superadmin:
        return set(SCHLUESSEL)
    d = daten()
    r = set(d["gruppen"].get("alle", {}).get("rechte", []))
    for g in d["mitglieder"].get(benutzer, []):
        r |= set(d["gruppen"].get(g, {}).get("rechte", []))
    return r & set(SCHLUESSEL)


def gruppen_von(benutzer):
    d = daten()
    return [g for g in d["mitglieder"].get(benutzer, []) if g in d["gruppen"]]


def recht_fuer(methode, pfad, query=""):
    """Welches Recht braucht diese Anfrage? None = nur Superadmins."""
    p = pfad
    if methode == "GET":
        if p == "/api/processes": return "prozesse.sehen"
        if p == "/api/services": return "dienste.sehen"
        if p == "/api/updates": return "updates.sehen"
        # Terminal (3.9.0): nur Tabs/WebSocket/Info – die alten /api/terminal-Befehle laufen als root → nur Superadmins
        if p in ("/api/terminal/ws", "/api/terminal/info", "/api/terminal/tabs"): return "terminal"
        if p.startswith("/api/docker/ws/exec/") or p in ("/api/docker/container/archive", "/api/docker/image/save"):
            return "docker.verwalten"
        if p.startswith("/api/docker/") or p == "/api/docker": return "docker.sehen"
        if p.startswith("/api/security/"): return "sicherheit.sehen"
        if p == "/api/notifications": return "benachrichtigungen"
        if p in ("/api/users", "/api/gruppen") or p.startswith("/api/user"): return "benutzer.sehen"
        if p.startswith("/api/startseite"): return "startseite"
        if p.startswith("/api/automationen"): return "automationen"
        if p == "/api/einbettung":
            m = re.search(r"(?:^|&)app=([a-z]+)", query or "")
            from dashboard import funktionen
            return funktionen.app_recht().get(m.group(1)) if m else None
        return None
    # POST / DELETE
    if p == "/api/process/kill": return "prozesse.beenden"
    if p == "/api/service/action": return "dienste.steuern"
    if p == "/api/update": return "updates.installieren"
    if p.startswith("/api/terminal/tabs/"): return "terminal"
    if p in ("/api/docker/container/action", "/api/docker/stack/action"): return "docker.steuern"
    if p.startswith("/api/docker/"): return "docker.verwalten"
    if p in ("/api/security/ban", "/api/security/unban", "/api/security/unban-many"): return "sicherheit.sperren"
    if p in ("/api/user/create", "/api/user/delete", "/api/user/update", "/api/user/gruppen"): return "benutzer.verwalten"
    if p.startswith("/api/startseite"): return "startseite"
    if p.startswith("/api/automationen"): return "automationen"
    return None


# Eingebettete Apps → Recht: kommt aus funktionen.app_recht() (3.13.0)


def recht_name(k):
    for r in RECHTE:
        if r[0] == k:
            return r[2]
    return k


# ---------------------------------------------------------------- Ändern
def katalog():
    return [{"schluessel": k, "bereich": b, "name": n, "text": t, "kritisch": kr} for k, b, n, t, kr in RECHTE]


def gruppe_speichern(gid, name, beschreibung, rechte):
    gid = (gid or "").strip().lower()
    neu = not gid
    if neu:
        gid = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:32] or "gruppe"
    if not _ID_RE.match(gid):
        return {"error": "Ungültige Gruppen-Kennung"}
    name = (name or "").strip()[:40]
    if not name:
        return {"error": "Name fehlt"}
    d = daten()
    if neu:
        basis, i = gid, 2
        while gid in d["gruppen"]:
            gid = f"{basis}-{i}"; i += 1
    d["gruppen"][gid] = {"name": name, "beschreibung": (beschreibung or "").strip()[:200],
                         "rechte": [r for r in SCHLUESSEL if r in set(rechte or [])]}
    _schreiben(d)
    return {"success": True, "id": gid}


def gruppe_loeschen(gid):
    d = daten()
    if gid == "alle":
        return {"error": "Die Gruppe „Alle Angemeldeten“ kann nicht gelöscht werden (Rechte leeren geht)."}
    if gid not in d["gruppen"]:
        return {"error": "Gruppe nicht gefunden"}
    d["gruppen"].pop(gid)
    for u in d["mitglieder"]:
        d["mitglieder"][u] = [g for g in d["mitglieder"][u] if g != gid]
    _schreiben(d)
    return {"success": True}


def mitglied_setzen(benutzer, gruppen, erlaubt_rechte=None):
    """Gruppen eines Benutzers setzen. erlaubt_rechte: Rechte des Bearbeitenden (None = Superadmin, alles)."""
    d = daten()
    gruppen = [g for g in dict.fromkeys(gruppen or []) if g in d["gruppen"] and g != "alle"]
    if erlaubt_rechte is not None:
        alt = set(d["mitglieder"].get(benutzer, []))
        for g in set(gruppen) ^ alt:            # hinzugefügt ODER entfernt
            fehlt = set(d["gruppen"][g]["rechte"]) - erlaubt_rechte if g in d["gruppen"] else set()
            if fehlt:
                return {"error": f"Gruppe „{d['gruppen'][g]['name']}“ enthält Rechte, die du selbst nicht hast: "
                                 + ", ".join(recht_name(x) for x in sorted(fehlt))}
    if gruppen:
        d["mitglieder"][benutzer] = gruppen
    else:
        d["mitglieder"].pop(benutzer, None)
    _schreiben(d)
    return {"success": True}


def benutzer_entfernen(benutzer):
    d = daten()
    if d["mitglieder"].pop(benutzer, None) is not None:
        _schreiben(d)
