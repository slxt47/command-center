#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# angriffe-sammeln.py -- Angriffs-Radar fuer das Command Center (seit 19.11.2026)
#
# Sammelt alle 5 Minuten (angriffe-sammeln.timer) Angriffsversuche aus:
#   - Webserver-Protokollen aller Docker-Container (nginx-Format) und edge-log
#       -> Suche nach Geheimnissen (.env, .git, Konfigs von KI-Werkzeugen ...)
#       -> Luecken-Scans & Exploits (WordPress, PHP, Admin-Panels, ../, jndi ...)
#   - fail2ban.log: "Found" = Login-Fehlversuch (SSH + Web-Apps), Ban/Unban
#   - ids-watch.log: IDS-ANGRIFF (von aussen)
# und schreibt sie nach /var/lib/linux-dashboard/angriffe.sqlite3 (Command Center
# liest nur). Normaler Verkehr wird NICHT gespeichert, nur Versuche. Eigene und
# interne Adressen werden ignoriert. Aufbewahrung 90 Tage.
#
#   sudo angriffe-sammeln.py              normaler Lauf (inkrementell)
#   sudo angriffe-sammeln.py --neu        Datenbank leeren, alles Vorhandene einlesen
# ---------------------------------------------------------------------------
import gzip
import ipaddress
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.parse import unquote

DB = os.environ.get("ANGRIFFE_DB", "/var/lib/linux-dashboard/angriffe.sqlite3")
STAND = DB + ".stand.json"
EDGE = "/var/log/edge-log/access.log"
F2B = "/var/log/fail2ban.log"
IDS = "/var/log/ids-watch.log"
SPERR_LOG = "/var/log/angriffe/web.log"     # fail2ban-Jails web-scan / web-exploit lesen hier (seit 19.11.2026)
TAGE = 90
ERSTLAUF_TAGE = 30

# ---------------------------------------------------------------- Einordnung
GEHEIM = re.compile(
    r"/\.(env|git|svn|hg|aws|ssh|docker|config|npmrc|pypirc|htpasswd|htaccess|bash_history|zsh_history|vscode|idea|"
    r"ds_store|gemini|claude|cursor|windsurf|aider|kube|terraform|netrc|s3cfg|boto|azure|gcloud)"
    r"|/(env|\.?env\.[\w.-]+|config\.(json|ya?ml|php|js|ini|bak)|secrets?\.(json|ya?ml|txt)|credentials(\.json|\.xml)?"
    r"|id_(rsa|dsa|ed25519|ecdsa)|docker-compose\.ya?ml|settings\.(json|py)|appsettings(\.\w+)?\.json|wp-config\.php[\w.~-]*"
    r"|(backup|dump|database|db|site)\.(zip|sql|tar|tar\.gz|tgz|rar|7z)|claude_desktop_config\.json|mcp(_config)?\.json"
    r"|\.?aider[\w.]*|sftp-config\.json|phpinfo\.php|info\.php|server-status|\.?travis\.yml|parameters\.yml|web\.config)$",
    re.I)
LUECKE = re.compile(
    r"wp-(admin|login|content|includes|json)|wordpress|xmlrpc|\.(php\d?|asp|aspx|jsp|cgi|pl|do|action)$|phpmyadmin|pma/"
    r"|/cgi-bin/|/boaform|/hnap1|/actuator|/solr/|/manager/html|/jmx-console|/vendor/phpunit|/autodiscover|/owa/|/ecp/"
    r"|/remote/login|/geoserver|/\+cscoe\+|/goform|/druid|/telescope|/_ignition|/sdk$|/evox|/nice ports|/portal/redlion"
    r"|/developmentserver|/webui|/geoip|/systembc|/cf_scripts|/mgmt/|/fckeditor|/ckeditor|/elfinder|/laravel|/storage/logs"
    r"|/api/v1/pods|/v2/_catalog|/containers/json|/debug/|/console(/|$)|/shell|/setup\.cgi|/admin\.(php|asp)|/login\.(asp|jsp|cgi)",
    re.I)
EXPLOIT = re.compile(
    r"\.\./|\.\.%2f|%2e%2e|\$\{jndi|<script|union[\s+]+select|/etc/passwd|/proc/self|cmd=|exec=|eval\(|base64_decode"
    r"|;\s*(wget|curl)|\|\s*(sh|bash)|\$\(|/bin/sh|php://|file://|allow_url_include|auto_prepend_file", re.I)
WEB_FEHLER = {400, 403, 404, 405, 410, 444, 451, 500, 501}

ZEILE_NGINX = re.compile(
    r'^(?P<ip1>\S+) \S+ \S+ \[(?P<zeit>[^\]]+)\] "(?P<meth>[A-Z]{3,10}) (?P<pfad>\S{1,2000}) HTTP/[\d.]+" (?P<st>\d{3}) \S+'
    r'(?: "[^"]*" "(?P<ua>[^"]*)")?(?P<rest>.*)$')
ZEILE_EDGE = re.compile(
    r'^(?P<zeit>\S+ [+-]\d{4}) client=(?P<ip>\S+) host=(?P<host>\S+) "(?P<meth>[A-Z]{3,10}) (?P<pfad>[^"]{1,2000})" status=(?P<st>\d{3})')
ZEILE_F2B = re.compile(
    r"^(?P<zeit>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+ fail2ban\.\w+\s+\[\d+\]: \w+\s+\[(?P<jail>[\w.-]+)\] "
    r"(?P<was>Found|Ban|Unban|Restore Ban) (?P<ip>[0-9a-fA-F:.]+)")
ZEILE_IDS = re.compile(
    r"^(?P<zeit>\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) IDS-ANGRIFF (?P<ip>\S+) .*?\[(?P<sig>[^\]]{1,200})\] (?P<proto>\w+)/(?P<port>\d+)")
IP_RE = re.compile(r'"?([0-9]{1,3}(?:\.[0-9]{1,3}){3}|[0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7})"?')


def eigene_adressen():
    netze = []
    try:
        aus = subprocess.run(["ip", "-o", "addr", "show"], capture_output=True, text=True, timeout=10).stdout
        for t in re.findall(r"inet6? (\S+)", aus):
            netze.append(ipaddress.ip_interface(t).ip)
    except Exception:
        pass
    return set(netze)


EIGENE = eigene_adressen()


def fremd(ip):
    """Nur öffentliche, fremde Adressen zählen."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if a in EIGENE or not a.is_global:
        return False
    return True


def einordnen(pfad, status):
    """→ (kat, art) oder None. kat: geheim | luecke."""
    p = pfad[:600]
    try:
        d = unquote(unquote(p))
    except Exception:
        d = p
    if EXPLOIT.search(p) or EXPLOIT.search(d):
        return ("luecke", "exploit")
    if status not in WEB_FEHLER:
        return None
    nur = d.split("?", 1)[0]
    if nur.startswith("/.well-known/"):
        return None
    if GEHEIM.search(nur):
        return ("geheim", "geheim")
    if LUECKE.search(nur):
        return ("luecke", "scan")
    return None


def ts_nginx(s):
    return int(datetime.strptime(s, "%d/%b/%Y:%H:%M:%S %z").timestamp())


def ts_lokal(s):
    return int(time.mktime(time.strptime(s, "%Y-%m-%d %H:%M:%S")))


# ---------------------------------------------------------------- Datenbank
def db_oeffnen(neu=False):
    if neu:
        for f in (DB, STAND):
            try:
                os.remove(f)
            except FileNotFoundError:
                pass
    c = sqlite3.connect(DB, timeout=30)
    c.execute("PRAGMA journal_mode=DELETE")
    c.executescript("""
      CREATE TABLE IF NOT EXISTS versuche (ts INTEGER NOT NULL, ip TEXT NOT NULL, kat TEXT NOT NULL, art TEXT NOT NULL,
        ziel TEXT NOT NULL, detail TEXT NOT NULL, status INTEGER, quelle TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS v_ts ON versuche(ts);
      CREATE INDEX IF NOT EXISTS v_ip ON versuche(ip, ts);
      CREATE TABLE IF NOT EXISTS sperren (ts INTEGER NOT NULL, ip TEXT NOT NULL, jail TEXT NOT NULL, aktion TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS s_ts ON sperren(ts);
      CREATE INDEX IF NOT EXISTS s_ip ON sperren(ip, ts);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    """)
    os.chmod(DB, 0o640)
    return c


def stand_lesen():
    try:
        return json.load(open(STAND))
    except Exception:
        return {}


def stand_schreiben(s):
    tmp = STAND + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STAND)


# ---------------------------------------------------------------- Dateien inkrementell
def oeffnen(p):
    return gzip.open(p, "rt", errors="replace") if p.endswith(".gz") else open(p, errors="replace")


def neue_zeilen(pfad, stand, schluessel, erstlauf):
    """Liest nur Neues seit dem letzten Lauf (Inode + Position). Beim ersten Lauf auch rotierte Dateien."""
    zeilen = []
    try:
        st = os.stat(pfad)
    except FileNotFoundError:
        return zeilen
    alt = stand.get(schluessel)
    if erstlauf or alt is None:
        rot = sorted([pfad + ".1"] + [pfad + f".{i}.gz" for i in range(2, 8)], reverse=True)
        for r in rot:
            if os.path.exists(r):
                with oeffnen(r) as f:
                    zeilen.extend(f)
        pos = 0
    elif alt["inode"] != st.st_ino:
        # rotiert: Rest der alten Datei (jetzt .1) + neue Datei von vorn
        if os.path.exists(pfad + ".1") and os.stat(pfad + ".1").st_ino == alt["inode"]:
            with open(pfad + ".1", errors="replace") as f:
                f.seek(alt["pos"])
                zeilen.extend(f)
        pos = 0
    else:
        pos = alt["pos"] if alt["pos"] <= st.st_size else 0
    with open(pfad, errors="replace") as f:
        f.seek(pos)
        zeilen.extend(f)
        stand[schluessel] = {"inode": st.st_ino, "pos": f.tell()}
    return zeilen


# ---------------------------------------------------------------- Quellen
def aus_docker(seit, bis):
    """Webserver-Zeilen aller laufenden Container im Zeitfenster [seit, bis)."""
    out = []
    try:
        namen = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=30).stdout.split()
    except Exception:
        return out
    for n in namen:
        try:
            p = subprocess.run(["docker", "logs", "--since", str(seit), "--until", str(bis), n],
                               capture_output=True, text=True, errors="replace", timeout=60)
        except Exception:
            continue
        for z in (p.stdout + p.stderr).splitlines():
            if " HTTP/" not in z:
                continue
            m = ZEILE_NGINX.match(z)
            if not m:
                continue
            st = int(m["st"])
            e = einordnen(m["pfad"], st)
            if not e:
                continue
            ip = m["ip1"]
            # echte Besucher-IP steht bei den eigenen nginx-Formaten als letztes Feld ("$http_cf_connecting_ip")
            for kand in reversed(IP_RE.findall(m["rest"] or "")):
                if fremd(kand):
                    ip = kand
                    break
            if not fremd(ip):
                continue
            try:
                ts = ts_nginx(m["zeit"])
            except ValueError:
                continue
            out.append((ts, ip, e[0], e[1], n, f'{m["meth"]} {m["pfad"][:300]}', st, "web"))
    return out


def aus_edge(zeilen):
    out = []
    for z in zeilen:
        m = ZEILE_EDGE.match(z)
        if not m or not fremd(m["ip"]):
            continue
        st = int(m["st"])
        e = einordnen(m["pfad"], st)
        if not e:
            continue
        try:
            ts = ts_nginx(m["zeit"])
        except ValueError:
            continue
        out.append((ts, m["ip"], e[0], e[1], m["host"], f'{m["meth"]} {m["pfad"][:300]}', st, "edge"))
    return out


def aus_f2b(zeilen):
    versuche, sperren = [], []
    for z in zeilen:
        m = ZEILE_F2B.match(z)
        if not m or not fremd(m["ip"]):
            continue
        ts, jail, was = ts_lokal(m["zeit"]), m["jail"], m["was"]
        if was == "Found":
            if jail.startswith("ids-") or jail in ("recidive", "manuell"):
                continue                       # IDS kommt aus ids-watch.log, recidive zählt Sperren
            kat, art = ("luecke", "scan") if jail.endswith("-scan") else ("login", "ssh" if jail == "sshd" else "web")
            ziel = "SSH" if jail == "sshd" else jail.rsplit("-", 1)[0]
            versuche.append((ts, m["ip"], kat, art, ziel, f"fail2ban {jail}", None, "fail2ban"))
        elif was in ("Ban", "Unban"):
            sperren.append((ts, m["ip"], jail, was.lower()))
    return versuche, sperren


def aus_ids(zeilen, ab):
    out = []
    for z in zeilen:
        if "IDS-ANGRIFF" not in z or "(von aussen)" not in z:
            continue
        m = ZEILE_IDS.match(z)
        if not m or not fremd(m["ip"]):
            continue
        ts = ts_lokal(m["zeit"])
        if ts < ab:
            continue
        sig = re.sub(r"\s+group \d+$", "", m["sig"])
        out.append((ts, m["ip"], "netz", "ids", f'{m["proto"]}/{m["port"]}', sig[:200], None, "ids"))
    return out


def sperr_log(versuche, jetzt):
    """Frische Web-Versuche als Zeilen für fail2ban (Ortszeit). Nur Web-Quellen – Logins und IDS sperren ihre
    eigenen Jails schon. Ältere als 1 Std nicht (Erstlauf/Nachholen soll keine Altlasten sperren)."""
    zeilen = []
    for ts, ip, kat, art, ziel, _d, st, quelle in sorted(versuche):
        if quelle not in ("web", "edge") or ts < jetzt - 3600:
            continue
        # Zeitstempel = Schreibzeit (sonst warnt fail2ban über „latency“, weil der Sammler bis zu 2 min später schreibt);
        # die echte Zeit des Versuchs steht in zeit=
        zeilen.append(f"{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(jetzt))} ANGRIFF ip={ip} art={art} "
                      f"ziel={re.sub(r'[^A-Za-z0-9._-]', '_', ziel)[:60]} status={st} "
                      f"zeit={time.strftime('%H:%M:%S', time.localtime(ts))}\n")
    if zeilen:
        os.makedirs(os.path.dirname(SPERR_LOG), exist_ok=True)
        with open(SPERR_LOG, "a") as f:
            f.writelines(zeilen)


# ---------------------------------------------------------------- Lauf
def main():
    neu = "--neu" in sys.argv
    jetzt = int(time.time())
    c = db_oeffnen(neu)
    stand = {} if neu else stand_lesen()
    erst = "docker_bis" not in stand
    ab = jetzt - ERSTLAUF_TAGE * 86400 if erst else 0

    seit = stand.get("docker_bis", ab)
    bis = jetzt - 5                                   # kleine Pufferzeit gegen halbe Zeilen
    versuche = aus_docker(seit, bis)
    stand["docker_bis"] = bis

    versuche += aus_edge(neue_zeilen(EDGE, stand, "edge", erst))
    v, sperren = aus_f2b(neue_zeilen(F2B, stand, "f2b", erst))
    versuche += v
    versuche += aus_ids(neue_zeilen(IDS, stand, "ids", erst), ab)
    versuche = [x for x in versuche if x[0] >= ab]
    sperren = [x for x in sperren if x[0] >= ab]

    if not erst:
        sperr_log(versuche, jetzt)
    with c:
        c.executemany("INSERT INTO versuche VALUES (?,?,?,?,?,?,?,?)", versuche)
        c.executemany("INSERT INTO sperren VALUES (?,?,?,?)", sperren)
        grenze = jetzt - TAGE * 86400
        c.execute("DELETE FROM versuche WHERE ts < ?", (grenze,))
        c.execute("DELETE FROM sperren WHERE ts < ?", (grenze,))
        c.execute("INSERT OR REPLACE INTO meta VALUES ('letzter_lauf', ?)", (str(jetzt),))
        if erst:
            c.execute("INSERT OR REPLACE INTO meta VALUES ('seit', ?)", (str(ab),))
    stand_schreiben(stand)
    c.close()
    print(f"angriffe-sammeln: {len(versuche)} Versuche, {len(sperren)} Sperr-Ereignisse" + (" (Erstlauf)" if erst else ""))


if __name__ == "__main__":
    main()
