"""Eigenes Konto (seit 3.1.0, 10.11.2026): Profilbild, E-Mail zur Wiederherstellung, Passwort ändern/zurücksetzen.

Das Passwort ist das LINUX-Passwort des Benutzers auf dem Host (Anmeldung prüft /etc/shadow) – gesetzt wird es
mit `chpasswd` über nsenter, wie in der Benutzerverwaltung. Darum streng:

Passwort-Richtlinie (Server ist maßgeblich, die Oberfläche zeigt dieselben Regeln live):
  - 12 bis 128 Zeichen, Groß- UND Kleinbuchstaben, Ziffer, Sonderzeichen
    (Ausnahme Passphrase: ab 20 Zeichen genügen drei der vier Arten)
  - enthält nicht den Benutzernamen, keine Wiederholung (aaa), keine Folge (1234, abcd, qwertz)
  - kein bekanntes/häufiges Passwort, nicht gleich dem bisherigen

Ändern (angemeldet): aktuelles Passwort nötig, Drossel, danach alle ANDEREN Sitzungen beendet, ntfy „logins“.
Zurücksetzen (Login-Seite, ohne Anmeldung):
  - nur für Konten mit BESTÄTIGTER E-Mail; Antwort immer gleich (verrät nicht, ob es das Konto gibt),
    Mail geht im Hintergrund raus (gleiche Antwortzeit)
  - Code 8 Ziffern, 10 min gültig, höchstens 5 Versuche, nur als HMAC im Speicher (nie auf Platte)
  - Drossel je IP und je Benutzer; falsche Codes landen als AUTHFAIL im Auth-Protokoll (fail2ban)
  - danach: alle Sitzungen des Benutzers beendet, ntfy-Meldung, Bestätigungs-Mail
E-Mail bestätigen: 6-stelliger Code an die neue Adresse (angemeldet), 10 min, 5 Versuche.
Profilbild: Upload wird mit Pillow geprüft und neu kodiert (quadratisch, 256 px, PNG) – nie die Rohdatei
ausliefern; oder von GitHub (github.com/<name>.png, nur Weiterleitung auf avatars.githubusercontent.com);
oder „slxt“ (optionales Ebenen-Bild, funktionen.json „profilbild_ebenen“, wechselt mit Hell/Dunkel); oder Initiale.

Dateien (alle 0600, Ordner 0700): /data/konten.json, /data/avatare/<benutzer>.png, /data/mail.env
(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
"""

import hashlib
import hmac
import io
import json
import os
import socket
import re
import secrets
import smtplib
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from dashboard.base import DATA_DIR, _ns

KONTEN = DATA_DIR / "konten.json"
AVATARE = DATA_DIR / "avatare"
MAIL_ENV = DATA_DIR / "mail.env"
NTFY_SEND = os.environ.get("DASH_NTFY_SEND", "")   # optional; sonst funktionen.json „ntfy_senden“
NTFY_THEMA = os.environ.get("DASH_NTFY_THEMA", "logins")
SERVERNAME = os.environ.get("DASH_SERVERNAME", "") or os.uname().nodename

_lock = threading.Lock()
_GEHEIM = secrets.token_bytes(32)          # HMAC für Codes; nur im Speicher
_codes = {}                                 # (art, benutzer) -> {hash, bis, versuche, email?}
_drossel = {}                               # schluessel -> [zeiten]
_BENUTZER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_EMAIL_RE = re.compile(r"^[^@\s<>\"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")
_GITHUB_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")

# ── Passwort-Richtlinie ─────────────────────────────────────────────────────────
_HAEUFIG = {
    "passwort", "password", "passw0rd", "qwertz", "qwerty", "123456", "1234567", "12345678", "123456789",
    "1234567890", "111111", "000000", "abc123", "iloveyou", "letmein", "welcome", "willkommen", "admin",
    "administrator", "root", "toor", "changeme", "sommer", "winter", "fruehling", "herbst", "hallo", "schatz",
    "geheim", "dragon", "monkey", "football", "fussball", "master", "superman", "batman", "trustno1", "server",
    "linux", "ubuntu", "debian", "dashboard", "command", "center", "commandcenter", socket.gethostname().lower(),
}
_FOLGEN = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertzuiopasdfghjklyxcvbnm", "qwertyuiopasdfghjklzxcvbnm"]


def passwort_regeln(pw, benutzer=""):
    """Liste der verletzten Regeln (leer = in Ordnung). Gleiche Schlüssel wie in der Oberfläche."""
    pw = pw or ""
    fehler = []
    arten = sum([bool(re.search(r"[a-z]", pw)), bool(re.search(r"[A-Z]", pw)),
                 bool(re.search(r"[0-9]", pw)), bool(re.search(r"[^A-Za-z0-9]", pw))])
    if len(pw) < 12:
        fehler.append("laenge")
    if len(pw) > 128:
        fehler.append("zu_lang")
    if len(pw) >= 20:
        if arten < 3:
            fehler.append("arten")
    else:
        if not (re.search(r"[a-z]", pw) and re.search(r"[A-Z]", pw)):
            fehler.append("gross_klein")
        if not re.search(r"[0-9]", pw):
            fehler.append("ziffer")
        if not re.search(r"[^A-Za-z0-9]", pw):
            fehler.append("sonder")
    klein = pw.lower()
    if benutzer and len(benutzer) >= 3 and benutzer.lower() in klein:
        fehler.append("benutzer")
    if re.search(r"(.)\1\1", pw):
        fehler.append("wiederholung")
    folge = False
    for f in _FOLGEN:
        for i in range(len(f) - 3):
            if f[i:i + 4] in klein or f[i:i + 4][::-1] in klein:
                folge = True
                break
    if folge:
        fehler.append("folge")
    kern = re.sub(r"[^a-z]", "", klein.replace("0", "o").replace("1", "i").replace("3", "e").replace("4", "a")
                  .replace("5", "s").replace("@", "a").replace("$", "s"))
    if klein in _HAEUFIG or kern in _HAEUFIG or any(w in kern and len(w) >= 6 and len(kern) - len(w) < 4 for w in _HAEUFIG):
        fehler.append("haeufig")
    if pw != pw.strip() or "\n" in pw or "\r" in pw:
        fehler.append("leerzeichen_rand")
    return fehler


_REGEL_TEXT = {
    "laenge": "mindestens 12 Zeichen", "zu_lang": "höchstens 128 Zeichen",
    "gross_klein": "Groß- und Kleinbuchstaben", "ziffer": "mindestens eine Ziffer",
    "sonder": "mindestens ein Sonderzeichen", "arten": "drei Arten von Zeichen (Passphrase ab 20 Zeichen)",
    "benutzer": "darf den Benutzernamen nicht enthalten", "wiederholung": "keine drei gleichen Zeichen hintereinander",
    "folge": "keine Folgen wie 1234, abcd oder qwertz", "haeufig": "kein bekanntes oder häufiges Passwort",
    "leerzeichen_rand": "keine Leerzeichen am Anfang oder Ende", "gleich": "muss sich vom bisherigen unterscheiden",
}


def regel_text(fehler):
    return "Passwort zu schwach: " + ", ".join(_REGEL_TEXT.get(f, f) for f in fehler) + "."


# ── Ablage ──────────────────────────────────────────────────────────────────────
def _laden():
    try:
        with open(KONTEN, encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _sichern(d):
    tmp = KONTEN.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, KONTEN)


def _eintrag(benutzer):
    return _laden().get(benutzer, {})


def _aendern(benutzer, **werte):
    with _lock:
        d = _laden()
        e = d.get(benutzer, {})
        for k, v in werte.items():
            if v is None:
                e.pop(k, None)
            else:
                e[k] = v
        d[benutzer] = e
        _sichern(d)
        return e


def _maskieren(email):
    if not email or "@" not in email:
        return ""
    name, dom = email.split("@", 1)
    return (name[:2] + "•" * max(1, min(6, len(name) - 2))) + "@" + dom


def profil(benutzer):
    e = _eintrag(benutzer)
    art = e.get("bild_art", "initial")
    if art == "bild" and not (AVATARE / f"{benutzer}.png").exists():
        art = "initial"
    return {"bild_art": art, "bild_v": e.get("bild_v", 0), "bild_vorhanden": (AVATARE / f"{benutzer}.png").exists(), "email": e.get("email", ""),
            "email_maskiert": _maskieren(e.get("email", "")), "email_bestaetigt": bool(e.get("email_bestaetigt")),
            "email_ausstehend": _maskieren((_codes.get(("email", benutzer)) or {}).get("email", "")) if
            (_codes.get(("email", benutzer)) or {}).get("bis", 0) > time.time() else "",
            "mail_bereit": mail_bereit(), "passwort_geaendert": e.get("passwort_geaendert", 0),
            "cc_passwort": _cc_hat(benutzer)}


# ── Drossel, Codes ──────────────────────────────────────────────────────────────
def _gedrosselt(schluessel, max_n, fenster):
    jetzt = time.time()
    with _lock:
        z = [t for t in _drossel.get(schluessel, []) if jetzt - t < fenster]
        z.append(jetzt)
        _drossel[schluessel] = z
        if len(_drossel) > 5000:
            for k in [k for k, v in _drossel.items() if all(jetzt - t >= 3600 for t in v)]:
                _drossel.pop(k, None)
        return len(z) > max_n


def _hash(code):
    return hmac.new(_GEHEIM, code.encode(), hashlib.sha256).hexdigest()


def _code_neu(art, benutzer, stellen, **extra):
    code = "".join(secrets.choice("0123456789") for _ in range(stellen))
    with _lock:
        _codes[(art, benutzer)] = {"hash": _hash(code), "bis": time.time() + 600, "versuche": 0, **extra}
    return code


def _code_pruefen(art, benutzer, code):
    """True/False; nach 5 Fehlversuchen oder Ablauf ist der Code weg."""
    code = re.sub(r"\D", "", code or "")
    with _lock:
        c = _codes.get((art, benutzer))
        if not c or c["bis"] < time.time():
            _codes.pop((art, benutzer), None)
            return False, None
        c["versuche"] += 1
        ok = bool(code) and hmac.compare_digest(c["hash"], _hash(code))
        if ok or c["versuche"] >= 5:
            _codes.pop((art, benutzer), None)
        return ok, c


# ── Mail, ntfy ──────────────────────────────────────────────────────────────────
def _mail_cfg():
    cfg = {}
    try:
        with open(MAIL_ENV, encoding="utf-8") as fh:
            for zeile in fh:
                k, _, v = zeile.strip().partition("=")
                if k and not k.startswith("#"):
                    cfg[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        return None
    if not cfg.get("SMTP_USER") or not cfg.get("SMTP_PASS"):
        return None
    cfg.setdefault("SMTP_HOST", "smtp.mail.me.com")
    cfg.setdefault("SMTP_PORT", "587")
    return cfg


def mail_bereit():
    return _mail_cfg() is not None


def _mail(an, betreff, text):
    cfg = _mail_cfg()
    if not cfg:
        return False
    absender = parseaddr(cfg.get("MAIL_FROM", ""))[1] or cfg["SMTP_USER"]
    m = EmailMessage()
    m["From"] = f"Command Center <{absender}>"
    m["To"] = an
    m["Subject"] = betreff
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=absender.split("@")[-1])
    m["Auto-Submitted"] = "auto-generated"
    m.set_content(text)
    try:
        with smtplib.SMTP(cfg["SMTP_HOST"], int(cfg["SMTP_PORT"]), timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(cfg["SMTP_USER"], cfg["SMTP_PASS"])
            s.send_message(m)
        return True
    except Exception:
        return False


def _hintergrund(f, *a):
    threading.Thread(target=f, args=a, daemon=True).start()


def _ntfy(titel, text, prio="high", tags="key"):
    from dashboard import funktionen
    skript = NTFY_SEND or funktionen.wert("ntfy_senden") or ""
    if not skript:
        return                      # keine Push-Anbindung eingerichtet
    try:
        subprocess.run(_ns([skript, NTFY_THEMA, titel, prio, tags, text]), capture_output=True, timeout=15)
    except Exception:
        pass


def _cc_hat(benutzer):
    from dashboard import ccpasswort
    return ccpasswort.hat(benutzer)


# ── Passwort ────────────────────────────────────────────────────────────────────
def _chpasswd(benutzer, pw):
    if not _BENUTZER_RE.match(benutzer or "") or "\n" in pw or "\r" in pw:
        return False
    r = subprocess.run(_ns(["chpasswd"]), input=f"{benutzer}:{pw}", capture_output=True, text=True, timeout=15)
    return r.returncode == 0


def _pw_setzen(benutzer, pw):
    """Eigenes CC-Passwort (3.5.0) ändern, falls vorhanden – sonst wie bisher das Linux-Passwort."""
    from dashboard import ccpasswort
    if ccpasswort.hat(benutzer):
        return ccpasswort.setzen(benutzer, pw)
    return _chpasswd(benutzer, pw)


def passwort_aendern(benutzer, aktuell, neu, ip, pruefen, sitzungen_ausser):
    """pruefen(benutzer, pw) -> True/False/None (authenticate_user); sitzungen_ausser(): andere Sitzungen beenden."""
    if _gedrosselt(("pw", benutzer), 5, 900) or _gedrosselt(("pw-ip", ip), 10, 900):
        return {"error": "Zu viele Versuche – bitte 15 Minuten warten."}, 429
    if not aktuell or pruefen(benutzer, aktuell) is not True:
        return {"error": "Das aktuelle Passwort stimmt nicht.", "feld": "aktuell"}, 400
    fehler = passwort_regeln(neu, benutzer)
    if neu == aktuell:
        fehler.append("gleich")
    if fehler:
        return {"error": regel_text(fehler), "regeln": fehler, "feld": "neu"}, 400
    if not _pw_setzen(benutzer, neu):
        return {"error": "Passwort konnte nicht gesetzt werden."}, 500
    _aendern(benutzer, passwort_geaendert=int(time.time()))
    sitzungen_ausser()
    _hintergrund(_ntfy, "Passwort geändert", f"{benutzer} hat das Passwort im Command Center ({SERVERNAME}) geändert. "
                 "Alle anderen Geräte wurden abgemeldet.")
    e = _eintrag(benutzer)
    if e.get("email_bestaetigt") and e.get("email"):
        _hintergrund(_mail, e["email"], "Passwort geändert",
                     f"Hallo {benutzer},\n\ndas Passwort deines Kontos auf {SERVERNAME} wurde gerade im Command Center "
                     "geändert. Alle anderen Geräte wurden abgemeldet.\n\nWarst du das nicht? Melde dich sofort an und "
                     "ändere es erneut, oder setze es über „Passwort vergessen?“ zurück.\n")
    return {"success": True}, 200


def reset_anfordern(benutzer, ip):
    """Immer dieselbe Antwort. Sendet nur bei bestätigter E-Mail einen Code."""
    benutzer = (benutzer or "").strip().lower()
    antwort = {"success": True, "hinweis": "Wenn für dieses Konto eine bestätigte E-Mail hinterlegt ist, "
               "kommt in wenigen Sekunden ein Code. Er gilt 10 Minuten."}
    if _gedrosselt(("reset-ip", ip), 5, 900):
        return {"error": "Zu viele Anfragen – bitte 15 Minuten warten."}, 429
    if not _BENUTZER_RE.match(benutzer) or _gedrosselt(("reset-u", benutzer), 3, 3600):
        return antwort, 200
    e = _eintrag(benutzer)
    if not (e.get("email_bestaetigt") and e.get("email")) or not mail_bereit():
        return antwort, 200
    code = _code_neu("reset", benutzer, 8)
    email = e["email"]

    def senden():
        _mail(email, "Dein Code zum Zurücksetzen des Passworts",
              f"Hallo {benutzer},\n\ndein Code zum Zurücksetzen des Passworts auf {SERVERNAME}:\n\n"
              f"    {code[:4]} {code[4:]}\n\nEr gilt 10 Minuten; nach fünf falschen Eingaben ist er ungültig.\n\n"
              "Hast du das nicht angefordert? Dann ignoriere diese Mail – dein Passwort bleibt unverändert.\n")
        _ntfy("Passwort-Reset angefordert", f"Für {benutzer} wurde ein Code an {_maskieren(email)} geschickt.", "high", "warning")
    _hintergrund(senden)
    return antwort, 200


def reset_setzen(benutzer, code, neu, ip, log, sitzungen_alle):
    benutzer = (benutzer or "").strip().lower()
    if _gedrosselt(("reset-set-ip", ip), 10, 900):
        return {"error": "Zu viele Versuche – bitte 15 Minuten warten."}, 429
    if not _BENUTZER_RE.match(benutzer):
        return {"error": "Code ungültig oder abgelaufen."}, 400
    fehler = passwort_regeln(neu, benutzer)
    if fehler:   # erst Regeln prüfen: ein zu schwaches Passwort verbraucht keinen Code-Versuch
        return {"error": regel_text(fehler), "regeln": fehler, "feld": "neu"}, 400
    ok, _ = _code_pruefen("reset", benutzer, code)
    if not ok:
        log("AUTHFAIL", benutzer, ip, "reset-code")
        return {"error": "Code ungültig oder abgelaufen.", "feld": "code"}, 400
    if not _pw_setzen(benutzer, neu):
        return {"error": "Passwort konnte nicht gesetzt werden."}, 500
    log("AUTHOK", benutzer, ip, "reset")
    _aendern(benutzer, passwort_geaendert=int(time.time()))
    sitzungen_alle()
    _hintergrund(_ntfy, "Passwort zurückgesetzt", f"Das Passwort von {benutzer} auf {SERVERNAME} wurde per E-Mail-Code "
                 "zurückgesetzt. Alle Sitzungen wurden beendet.", "urgent", "rotating_light")
    e = _eintrag(benutzer)
    if e.get("email"):
        _hintergrund(_mail, e["email"], "Passwort zurückgesetzt",
                     f"Hallo {benutzer},\n\ndein Passwort auf {SERVERNAME} wurde gerade mit einem E-Mail-Code zurückgesetzt. "
                     "Alle Sitzungen wurden beendet.\n\nWarst du das nicht? Dann hat jemand Zugriff auf dein Postfach – "
                     "ändere sofort das Mail-Passwort und melde dich beim Administrator.\n")
    return {"success": True}, 200


# ── E-Mail bestätigen ───────────────────────────────────────────────────────────
def email_anfordern(benutzer, email, ip):
    email = (email or "").strip()
    if not _EMAIL_RE.match(email):
        return {"error": "Bitte eine gültige E-Mail-Adresse eingeben.", "feld": "email"}, 400
    if not mail_bereit():
        return {"error": "Mailversand ist auf dem Server nicht eingerichtet (/data/mail.env)."}, 503
    if _gedrosselt(("email", benutzer), 3, 900) or _gedrosselt(("email-ip", ip), 6, 900):
        return {"error": "Zu viele Anfragen – bitte 15 Minuten warten."}, 429
    code = _code_neu("email", benutzer, 6, email=email)
    if not _mail(email, "Dein Bestätigungscode",
                 f"Hallo {benutzer},\n\ndein Code, um diese Adresse im Command Center ({SERVERNAME}) für das Zurücksetzen "
                 f"des Passworts zu hinterlegen:\n\n    {code}\n\nEr gilt 10 Minuten.\n"):
        with _lock:
            _codes.pop(("email", benutzer), None)
        return {"error": "Mail konnte nicht gesendet werden. Bitte später erneut versuchen."}, 502
    return {"success": True, "an": _maskieren(email)}, 200


def email_bestaetigen(benutzer, code):
    ok, c = _code_pruefen("email", benutzer, code)
    if not ok:
        return {"error": "Code ungültig oder abgelaufen.", "feld": "code"}, 400
    _aendern(benutzer, email=c["email"], email_bestaetigt=int(time.time()))
    _hintergrund(_ntfy, "E-Mail hinterlegt", f"{benutzer} hat {_maskieren(c['email'])} zum Zurücksetzen des Passworts "
                 "hinterlegt.", "default", "envelope")
    return {"success": True}, 200


def email_entfernen(benutzer):
    _aendern(benutzer, email=None, email_bestaetigt=None)
    return {"success": True}, 200


# ── Profilbild ──────────────────────────────────────────────────────────────────
def _bild_speichern(benutzer, roh):
    """Prüft und kodiert neu: quadratisch zugeschnitten, 256 px, PNG ohne Metadaten."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return {"error": "Bildbearbeitung nicht verfügbar (Pillow fehlt)."}, 500
    if not roh or len(roh) > 5 * 1024 * 1024:
        return {"error": "Bild fehlt oder ist größer als 5 MB."}, 400
    try:
        Image.MAX_IMAGE_PIXELS = 40_000_000
        im = Image.open(io.BytesIO(roh))
        if im.format not in ("PNG", "JPEG", "WEBP", "GIF"):
            return {"error": "Nur PNG, JPEG, WebP oder GIF."}, 400
        im.load()
        im = ImageOps.exif_transpose(im).convert("RGBA")
        s = min(im.size)
        im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width - s) // 2 + s, (im.height - s) // 2 + s))
        im = im.resize((256, 256), Image.LANCZOS)
        aus = io.BytesIO()
        im.save(aus, "PNG", optimize=True)
    except Exception:
        return {"error": "Das ist kein lesbares Bild."}, 400
    os.makedirs(AVATARE, mode=0o700, exist_ok=True)
    ziel = AVATARE / f"{benutzer}.png"
    tmp = AVATARE / f".{benutzer}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(aus.getvalue())
    os.replace(tmp, ziel)
    _aendern(benutzer, bild_art="bild", bild_v=int(time.time()))
    return {"success": True}, 200


def bild_hochladen(benutzer, roh, ip):
    if _gedrosselt(("bild", benutzer), 20, 3600):
        return {"error": "Zu viele Änderungen – bitte später."}, 429
    return _bild_speichern(benutzer, roh)


class _NurGithub(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = urllib.parse.urlsplit(newurl).hostname or ""
        if urllib.parse.urlsplit(newurl).scheme != "https" or host not in ("avatars.githubusercontent.com", "github.com"):
            raise urllib.error.HTTPError(newurl, code, "Weiterleitung nicht erlaubt", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def bild_github(benutzer, name, ip):
    name = (name or "").strip().lstrip("@")
    if not _GITHUB_RE.match(name):
        return {"error": "Ungültiger GitHub-Name.", "feld": "github"}, 400
    if _gedrosselt(("bild", benutzer), 20, 3600):
        return {"error": "Zu viele Änderungen – bitte später."}, 429
    oeffner = urllib.request.build_opener(_NurGithub)
    try:
        req = urllib.request.Request(f"https://github.com/{name}.png?size=256",
                                     headers={"User-Agent": "linux-command-center"})
        with oeffner.open(req, timeout=10) as r:
            roh = r.read(5 * 1024 * 1024 + 1)
    except Exception:
        return {"error": "Bild von GitHub nicht erreichbar – stimmt der Name?", "feld": "github"}, 404
    return _bild_speichern(benutzer, roh)


def bild_art(benutzer, art):
    if art not in ("initial", "slxt", "bild"):
        return {"error": "Unbekannte Auswahl."}, 400
    if art == "bild" and not (AVATARE / f"{benutzer}.png").exists():
        return {"error": "Noch kein eigenes Bild hochgeladen."}, 400
    _aendern(benutzer, bild_art=art, bild_v=int(time.time()))
    return {"success": True}, 200


def bild_loeschen(benutzer):
    try:
        os.remove(AVATARE / f"{benutzer}.png")
    except OSError:
        pass
    _aendern(benutzer, bild_art="initial", bild_v=int(time.time()))
    return {"success": True}, 200


def bild_datei(benutzer):
    p = AVATARE / f"{benutzer}.png"
    try:
        with open(p, "rb") as fh:
            return fh.read()
    except OSError:
        return None
