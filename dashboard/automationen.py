"""Reiter „Automationen“: n8n-Workflows im Command Center (seit 11.11.2026, 3.2.0).

n8n selbst läuft z. B. hinter Cloudflare Access. Eine Einbettung per iframe ist bewusst NICHT
möglich (n8n braucht Cookies, Speicher, WebSocket, PATCH/DELETE – das passt nicht zur Einbettungs-Sandbox,
und ohne Sandbox bekäme n8n Zugriff auf das Command Center). Stattdessen spricht nur der Server mit der
öffentlichen n8n-API (http://127.0.0.1:9330/api/v1) – der Browser sieht den API-Schlüssel nie.

- Schlüssel: /data/n8n-api-key (0600, Kopie von ~/compose/n8n/api-key). Fehlt er, zeigt der Reiter einen Hinweis.
- Lesen: Workflows (Name, aktiv, Auslöser, Knoten) + letzte Ausführungen, 15 s zwischengespeichert.
- Schreiben: nur Workflow ein-/ausschalten (Superadmin, Gate im Handler).
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

from dashboard.base import DATA_DIR

KEY_FILE = DATA_DIR / "n8n-api-key"
FRAGE_FILE = DATA_DIR / "n8n-frage-token"     # Webhook „Arzt fragen“ (seit 3.3.0)
FRAGE_URL = os.environ.get("N8N_FRAGE_URL", "http://127.0.0.1:9330/webhook/arzt-frage")
MODUS_URL = os.environ.get("N8N_MODUS_URL", "http://127.0.0.1:9330/webhook/bin-weg")   # Bin-weg-Modus (seit 3.4.0, gleiches Token)
URL = os.environ.get("N8N_API_URL", "http://127.0.0.1:9330/api/v1")
OEFFENTLICH = os.environ.get("N8N_OEFFENTLICH", "")   # Link „in n8n öffnen“ (sonst aus funktionen.json)
CACHE_S = 15
ID_RE = re.compile(r"^[A-Za-z0-9]{8,32}$")
_lock = threading.Lock()
_cache = {"zeit": 0.0, "daten": None}


def _key():
    try:
        with open(KEY_FILE, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _api(methode, pfad, key):
    req = urllib.request.Request(URL + pfad, method=methode,
                                 headers={"X-N8N-API-KEY": key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        t = r.read(8 * 1024 * 1024)
        return json.loads(t) if t else {}


def _ausloeser(nodes):
    """Kurzbeschreibung des Auslösers (Zeitplan, Webhook, manuell …) – nur Text, keine Parameter-Rohdaten."""
    for n in nodes or []:
        t = str(n.get("type", ""))
        p = n.get("parameters") or {}
        if t.endswith("scheduleTrigger"):
            regeln = ((p.get("rule") or {}).get("interval") or [{}])
            r = regeln[0] if regeln else {}
            if r.get("field") == "cronExpression":
                return {"art": "zeitplan", "text": _cron_text(str(r.get("expression", "")))}
            if r.get("field") == "minutes":
                return {"art": "zeitplan", "text": f"alle {r.get('minutesInterval', 1)} Minuten"}
            if r.get("field") == "hours":
                return {"art": "zeitplan", "text": f"alle {r.get('hoursInterval', 1)} Stunden"}
            return {"art": "zeitplan", "text": "Zeitplan"}
        if t.endswith("webhook"):
            return {"art": "webhook", "text": "Webhook"}
        if t.endswith("manualTrigger"):
            return {"art": "manuell", "text": "von Hand"}
        if t.lower().endswith("trigger"):
            return {"art": "ereignis", "text": str(n.get("name", "Ereignis"))[:40]}
    return {"art": "sonst", "text": "–"}


_TAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]


def _cron_text(expr):
    teile = expr.split()
    if len(teile) == 5 and teile[0].isdigit() and teile[1].isdigit():
        zeit = f"{int(teile[1]):02d}:{int(teile[0]):02d}"
        if teile[2:] == ["*", "*", "*"]:
            return f"täglich {zeit}"
        if teile[2:4] == ["*", "*"] and teile[4].isdigit() and 0 <= int(teile[4]) <= 6:
            return f"{_TAGE[int(teile[4])]} {zeit}"
    return f"Cron {expr}"[:40]


def automationen_daten(neu=False):
    with _lock:
        if not neu and _cache["daten"] is not None and time.time() - _cache["zeit"] < CACHE_S:
            return _cache["daten"]
    key = _key()
    if not key:
        return {"error": "Kein n8n-API-Schlüssel hinterlegt (/var/lib/linux-dashboard/n8n-api-key)."}
    try:
        wfs = _api("GET", "/workflows?limit=250", key).get("data", [])
        exe = _api("GET", "/executions?limit=60", key).get("data", [])
    except urllib.error.HTTPError as e:
        return {"error": f"n8n antwortet mit {e.code}."}
    except (OSError, ValueError):
        return {"error": "n8n nicht erreichbar."}
    namen = {}
    workflows = []
    for w in wfs:
        wid = str(w.get("id", ""))
        namen[wid] = str(w.get("name", ""))[:120]
        workflows.append({
            "id": wid, "name": namen[wid], "aktiv": bool(w.get("active")),
            "geaendert": w.get("updatedAt"), "knoten": len(w.get("nodes") or []),
            "ausloeser": _ausloeser(w.get("nodes")),
            "link": f"{OEFFENTLICH}/workflow/{wid}",
        })
    laeufe = []
    for e in exe:
        wid = str(e.get("workflowId", ""))
        start, ende = e.get("startedAt"), e.get("stoppedAt")
        laeufe.append({"id": str(e.get("id", "")), "workflow": wid, "name": namen.get(wid, "?"),
                       "status": str(e.get("status") or ("success" if e.get("finished") else "unbekannt")),
                       "modus": str(e.get("mode", "")), "start": start, "ende": ende,
                       "link": f"{OEFFENTLICH}/workflow/{wid}/executions/{e.get('id', '')}"})
    # je Workflow: letzter Lauf
    for w in workflows:
        l = next((x for x in laeufe if x["workflow"] == w["id"]), None)
        w["letzter"] = {"status": l["status"], "start": l["start"]} if l else None
    daten = {"workflows": sorted(workflows, key=lambda w: (not w["aktiv"], w["name"].lower())),
             "laeufe": laeufe[:30], "url": OEFFENTLICH}
    with _lock:
        _cache.update(zeit=time.time(), daten=daten)
    return daten


def automation_schalten(wid, aktiv):
    """Workflow ein-/ausschalten. Rückgabe (antwort, http-code)."""
    if not isinstance(wid, str) or not ID_RE.match(wid):
        return {"error": "Ungültige Workflow-ID"}, 400
    key = _key()
    if not key:
        return {"error": "Kein n8n-API-Schlüssel hinterlegt."}, 503
    try:
        _api("POST", f"/workflows/{wid}/{'activate' if aktiv else 'deactivate'}", key)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read(4096) or b"{}").get("message", "")
        except ValueError:
            msg = ""
        return {"error": f"n8n: {msg or e.code}"[:200]}, 502 if e.code >= 500 else 400
    except OSError:
        return {"error": "n8n nicht erreichbar."}, 503
    with _lock:
        _cache["daten"] = None
    return {"success": True, "aktiv": bool(aktiv)}, 200


def arzt_fragen(frage, benutzer):
    """Frage an Ben (Server-Arzt) (Claude-Agent, nur lesen) über den n8n-Webhook stellen. Rückgabe (antwort, code).
    Die Antwort kommt asynchron per ntfy (Thema n8n → Benachrichtigungen) und als Bericht in Obsidian."""
    frage = " ".join(str(frage or "").split())[:1500]
    if len(frage) < 5:
        return {"error": "Bitte eine Frage mit mindestens 5 Zeichen."}, 400
    try:
        with open(FRAGE_FILE, encoding="utf-8") as fh:
            tok = fh.read().strip()
    except OSError:
        return {"error": "Kein Webhook-Token hinterlegt (/var/lib/linux-dashboard/n8n-frage-token)."}, 503
    req = urllib.request.Request(FRAGE_URL, method="POST", data=json.dumps({"frage": frage, "von": str(benutzer)[:40]}).encode(),
                                 headers={"X-Frage-Token": tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(4096)
    except urllib.error.HTTPError as e:
        return {"error": f"n8n antwortet mit {e.code}."}, 502
    except OSError:
        return {"error": "n8n nicht erreichbar."}, 503
    return {"success": True}, 200


def bin_weg(aktion, tage=7):
    """Bin-weg-Modus (3.4.0) über den n8n-Webhook lesen/setzen. aktion: "abfrage" | "an" | "aus". Rückgabe (antwort, code).
    Wirkung (in n8n/Helfer): nur Prio-5-Meldungen pushen, Ben darf mehr selbst reparieren, Jarvis ruft weiter an."""
    if aktion not in ("abfrage", "an", "aus"):
        return {"error": "Unbekannte Aktion"}, 400
    try:
        tage = max(1, min(60, int(tage)))
    except (TypeError, ValueError):
        tage = 7
    body = {"abfrage": True} if aktion == "abfrage" else {"weg": aktion == "an", "tage": tage}
    try:
        with open(FRAGE_FILE, encoding="utf-8") as fh:
            tok = fh.read().strip()
    except OSError:
        return {"error": "Kein Webhook-Token hinterlegt (/var/lib/linux-dashboard/n8n-frage-token)."}, 503
    req = urllib.request.Request(MODUS_URL, method="POST", data=json.dumps(body).encode(),
                                 headers={"X-Frage-Token": tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read(4096) or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": f"n8n antwortet mit {e.code}."}, 502
    except (OSError, ValueError):
        return {"error": "n8n nicht erreichbar."}, 503
    return {"weg": bool(d.get("weg")), "bis": d.get("bis"), "seit": d.get("seit")}, 200
