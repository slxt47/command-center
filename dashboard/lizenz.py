#!/usr/bin/env python3
"""Command Center – Lizenz (Installer, „command-center lizenz“ und das Command Center selbst).

  lizenz.py                    Status anzeigen
  lizenz.py SCHLÜSSEL          Schlüssel prüfen und eintragen
  lizenz.py --pruefen          eingetragenen Schlüssel erneut prüfen (Command Center: täglich)
  lizenz.py --installer [S]    für install.sh: Schlüssel erfragen (über /dev/tty), prüfen, eintragen;
                               Exit 0 = gültig, 1 = ungültig/abgebrochen, 2 = Lizenzserver nicht erreichbar

Geprüft wird bei lizenz.slxt.dev; übertragen werden nur Schlüssel, eine anonyme Server-Kennung
(Prüfsumme der machine-id) und die Version. Ergebnis: /var/lib/linux-dashboard/lizenz.json.
Nur Standardbibliothek – läuft am Host und im Container.
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

URL = os.environ.get("CC_LIZENZ_URL", "https://lizenz.slxt.dev/api/v1/pruefen")
ANFRAGE = "https://lizenz.slxt.dev"
DATEI = os.environ.get("CC_LIZENZ_DATEI") or ("/data/lizenz.json" if os.path.isdir("/data") and os.path.exists("/app/server.py") else "/var/lib/linux-dashboard/lizenz.json")
KULANZ_TAGE = 14        # Lizenzserver nicht erreichbar: so lange gilt das letzte gute Ergebnis

T = {
    "de": {"frage": "Lizenzschlüssel (CC-XXXXX-…)", "keine": "Ohne Lizenzschlüssel geht es nicht weiter.",
           "anfragen": "Lizenz anfragen", "ok": "Lizenz gültig", "bis": "bis", "unbegrenzt": "unbegrenzt",
           "unbekannt": "Diesen Schlüssel gibt es nicht.", "format": "Das ist kein gültiger Schlüssel (Form CC-XXXXX-XXXXX-XXXXX-XXXXX).",
           "gesperrt": "Dieser Schlüssel ist gesperrt.", "abgelaufen": "Diese Lizenz ist abgelaufen – bitte verlängern.",
           "zu_viele_server": "Dieser Schlüssel ist schon auf der erlaubten Zahl von Servern aktiv.",
           "netz": "Lizenzserver nicht erreichbar – Internetverbindung prüfen und erneut versuchen.",
           "zu_viele_anfragen": "Zu viele Versuche – bitte kurz warten.", "fuer": "für", "nicht_eingetragen": "Keine Lizenz eingetragen.",
           "eintragen": "Eintragen: sudo command-center lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX", "server": "Server-Kennung"},
    "en": {"frage": "License key (CC-XXXXX-…)", "keine": "A license key is required to continue.",
           "anfragen": "Request a license", "ok": "License valid", "bis": "until", "unbegrenzt": "unlimited",
           "unbekannt": "This key does not exist.", "format": "This is not a valid key (form CC-XXXXX-XXXXX-XXXXX-XXXXX).",
           "gesperrt": "This key has been revoked.", "abgelaufen": "This license has expired – please renew it.",
           "zu_viele_server": "This key is already active on the allowed number of servers.",
           "netz": "License server not reachable – check the internet connection and try again.",
           "zu_viele_anfragen": "Too many attempts – please wait a moment.", "fuer": "for", "nicht_eingetragen": "No license entered.",
           "eintragen": "Enter one: sudo command-center lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX", "server": "Server ID"},
    "es": {"frage": "Clave de licencia (CC-XXXXX-…)", "keine": "Sin clave de licencia no se puede continuar.",
           "anfragen": "Solicitar una licencia", "ok": "Licencia válida", "bis": "hasta", "unbegrenzt": "sin límite",
           "unbekannt": "Esta clave no existe.", "format": "No es una clave válida (formato CC-XXXXX-XXXXX-XXXXX-XXXXX).",
           "gesperrt": "Esta clave está bloqueada.", "abgelaufen": "Esta licencia ha caducado: renuévala.",
           "zu_viele_server": "Esta clave ya está activa en el número permitido de servidores.",
           "netz": "Servidor de licencias no accesible: comprueba la conexión a internet e inténtalo de nuevo.",
           "zu_viele_anfragen": "Demasiados intentos: espera un momento.", "fuer": "para", "nicht_eingetragen": "No hay ninguna licencia.",
           "eintragen": "Introducirla: sudo command-center lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX", "server": "ID del servidor"},
}


def sprache():
    s = os.environ.get("CC_SPRACHE", "")
    if not s:
        try:
            s = next((z.split("=", 1)[1].strip() for z in open("/etc/linux-dashboard/dashboard.env") if z.startswith("CC_SPRACHE=")), "")
        except OSError:
            s = ""
    return s if s in T else "de"


def server_kennung():
    for p in ("/etc/machine-id", "/var/lib/dbus/machine-id", "/proc/sys/kernel/random/boot_id"):
        try:
            mid = open(p).read().strip()
            if mid:
                return hashlib.sha256(("command-center:" + mid).encode()).hexdigest()[:32]
        except OSError:
            continue
    return hashlib.sha256(os.uname().nodename.encode()).hexdigest()[:32]


def version():
    for p in (os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "VERSION"), "/app/VERSION"):
        try:
            return open(p).read().strip()
        except OSError:
            pass
    return ""


def lesen():
    try:
        with open(DATEI, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def schreiben(d):
    os.makedirs(os.path.dirname(DATEI), exist_ok=True)
    tmp = DATEI + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=1)
    os.replace(tmp, DATEI)


def anfragen(schluessel, server):
    body = json.dumps({"schluessel": schluessel, "server": server, "version": version()}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "User-Agent": "command-center"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except ValueError:
            return None
    except Exception:  # noqa: BLE001 – Netz, DNS, TLS
        return None


def pruefen(schluessel=None):
    """Prüft (neuen oder eingetragenen) Schlüssel, speichert das Ergebnis und gibt den Status zurück."""
    alt = lesen()
    k = schluessel or alt.get("schluessel")
    if not k:
        return status()
    server = alt.get("server") or server_kennung()
    jetzt = int(time.time())
    r = anfragen(k.strip(), server)
    if r is not None and r.get("grund") == "zu_viele_anfragen":
        r = None                                   # wie „nicht erreichbar“: gespeichertes Ergebnis bleibt
    if r is None:
        if schluessel and schluessel != alt.get("schluessel"):
            return {"vorhanden": bool(alt), "gueltig": False, "grund": "netz", "schluessel": k}
        alt["letzter_fehler"] = jetzt
        alt["grund_netz"] = True
        if alt:
            schreiben(alt)
        return status()
    if not r.get("gueltig") and schluessel and alt.get("gueltig") and schluessel != alt.get("schluessel"):
        return {**status(), "neu_abgelehnt": r.get("grund")}      # alter gültiger Schlüssel bleibt
    d = {"schluessel": k.strip().upper(), "server": server, "gueltig": bool(r.get("gueltig")), "grund": r.get("grund"),
         "name": r.get("name"), "bis": r.get("bis"), "max_server": r.get("max_server"), "geprueft": jetzt}
    schreiben(d)
    return status()


def status():
    d = lesen()
    if not d.get("schluessel"):
        return {"vorhanden": False, "gueltig": False, "grund": "keine"}
    jetzt = int(time.time())
    gueltig, grund = bool(d.get("gueltig")), d.get("grund") or ""
    if d.get("bis") and d["bis"] < jetzt:
        gueltig, grund = False, "abgelaufen"
    # Lange keine erfolgreiche Prüfung (Server nicht erreichbar): nach der Kulanz ungültig
    if gueltig and d.get("geprueft") and d["geprueft"] < jetzt - KULANZ_TAGE * 86400:
        gueltig, grund = False, "netz"
    tage = None if not d.get("bis") else max(0, (d["bis"] - jetzt) // 86400)
    return {"vorhanden": True, "gueltig": gueltig, "grund": grund, "name": d.get("name"), "bis": d.get("bis"),
            "tage_rest": tage, "max_server": d.get("max_server"), "geprueft": d.get("geprueft"),
            "schluessel": d["schluessel"][:9] + "…" + d["schluessel"][-5:], "anfrage_url": ANFRAGE}


def text(s, t):
    if not s.get("vorhanden"):
        return f"{t['nicht_eingetragen']}\n{t['eintragen']}\n{t['anfragen']}: {ANFRAGE}"
    if s.get("gueltig"):
        bis = time.strftime("%d.%m.%Y", time.localtime(s["bis"])) if s.get("bis") else t["unbegrenzt"]
        return f"✓ {t['ok']} {t['fuer']} {s.get('name')} – {t['bis']} {bis} ({s['schluessel']})"
    return f"✕ {t.get(s.get('grund'), s.get('grund'))}\n{t['anfragen']}: {ANFRAGE}"


def main(argv):
    t = T[sprache()]
    if not argv:
        print(text(status(), t))
        return 0 if status().get("gueltig") else 1
    if argv[0] == "--pruefen":
        s = pruefen()
        print(text(s, t))
        return 0 if s.get("gueltig") else 1
    if argv[0] == "--installer":
        k = argv[1] if len(argv) > 1 and argv[1] else os.environ.get("CC_LIZENZ", "")
        if not k:
            s = status()
            if s.get("vorhanden"):                       # Update: eingetragenen Schlüssel neu prüfen
                s = pruefen()
                if s.get("gueltig"):
                    print(text(s, t))
                    return 0
                if s.get("grund") == "netz":
                    print(t["netz"], file=sys.stderr)
                    return 2
                print(t.get(s.get("grund"), s.get("grund")), file=sys.stderr)   # ungültig → nach neuem Schlüssel fragen
        for _ in range(3):
            if not k:
                try:
                    # getrennt öffnen: "r+" geht auf einem Terminal nicht (nicht suchbar)
                    with open("/dev/tty", "w") as aus, open("/dev/tty") as ein:
                        aus.write(f"\n{t['anfragen']}: {ANFRAGE}\n{t['frage']}: ")
                        aus.flush()
                        k = ein.readline().strip()
                except OSError:
                    print(f"{t['keine']}\n{t['anfragen']}: {ANFRAGE}\n… | sudo bash -s -- --lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX", file=sys.stderr)
                    return 1
                if not k:
                    print(f"{t['keine']} {t['anfragen']}: {ANFRAGE}", file=sys.stderr)
                    return 1
            if not re.fullmatch(r"\s*(CC-?)?[0-9A-Za-z]{5}(-?[0-9A-Za-z]{5}){3}\s*", k):
                print(t["format"], file=sys.stderr)
                k = ""
                continue
            s = pruefen(k)
            if s.get("gueltig") and not s.get("neu_abgelehnt"):
                print(text(s, t))
                return 0
            grund = s.get("neu_abgelehnt") or s.get("grund")
            print(t.get(grund, grund), file=sys.stderr)
            if grund == "netz":
                return 2
            k = ""
        return 1
    s = pruefen(argv[0])
    if s.get("neu_abgelehnt"):
        print(t.get(s["neu_abgelehnt"], s["neu_abgelehnt"]), file=sys.stderr)
        return 1
    print(text(s, t))
    return 0 if s.get("gueltig") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
