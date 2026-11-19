"""Schnellspeicher (seit 3.10.0, 19.11.2026): SQLite-Zwischenspeicher für langsame Abfragen.

Gemessen vorher: Meldungen 6,1 s beim ersten Aufruf (3 s: 27× `fail2ban-client get <jail> actions`, 2,4 s: alte
fail2ban-Logs entpacken), Docker-Images 1,2 s, Stacks 0,7 s, Volumes 0,6 s – bei jedem Öffnen bzw. nach jedem Neustart.

Zwei Werkzeuge:
  holen(schluessel, rechnen, ttl, max_alter)  „stale-while-revalidate“: frisch (< ttl) → sofort; älter (< max_alter) →
      sofort den alten Wert UND im Hintergrund neu rechnen; ganz alt/fehlt → jetzt rechnen. Hält im Speicher und in
      /data/schnellspeicher.sqlite3 (überlebt Neustarts).
  datei(pfad, signatur, rechnen)  Ergebnis für eine Datei, die sich nicht mehr ändert (rotierte Logs) – nur neu,
      wenn sich Inode/Größe/Zeit ändern.
ungueltig(praefix) verwirft Einträge (z. B. nach Docker-Aktionen).

3.11.0: Speicherort PostgreSQL (Container cc_db, 127.0.0.1:5439, Zugang /data/pg.env), wenn erreichbar – sonst
automatisch SQLite. Geschrieben wird in BEIDE (SQLite = warmer Spiegel), gelesen zuerst aus Postgres. Fällt Postgres
aus, wird 60 s lang nur SQLite benutzt und dann erneut versucht – genauso schnell, nichts geht verloren.
status() zeigt, was gerade benutzt wird.
"""
import json
import os
import sqlite3
import threading
import time

DB = os.environ.get("DASH_SCHNELLSPEICHER", "/data/schnellspeicher.sqlite3")
_lock = threading.Lock()
_mem = {}                    # schluessel -> (zeit, wert)
_laeuft = set()              # Hintergrund-Neuberechnungen
_lokal = threading.local()


def _db():
    c = getattr(_lokal, "c", None)
    if c is None:
        c = sqlite3.connect(DB, timeout=5, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("CREATE TABLE IF NOT EXISTS werte (k TEXT PRIMARY KEY, t REAL NOT NULL, v TEXT NOT NULL)")
        c.execute("CREATE TABLE IF NOT EXISTS dateien (pfad TEXT PRIMARY KEY, sig TEXT NOT NULL, v TEXT NOT NULL)")
        try:
            os.chmod(DB, 0o600)
        except OSError:
            pass
        _lokal.c = c
    return c


# ---------------------------------------------------------------- PostgreSQL (cc_db + Kopie cc_db_replica), Rückfall SQLite
# 3.12.0: zwei Server – cc_db (127.0.0.1:5439, Haupt) und cc_db_replica (5440, laufende Kopie, nur lesbar).
# Schreiben: an den Server, der NICHT im Wiederherstellungsmodus ist (normal cc_db; nach ~/bin/cc-db-umschalten.sh die
# Kopie). Lesen: Haupt-Server, sonst die Kopie. Geht gar nichts, nimmt alles SQLite.
PG_ENV = os.environ.get("DASH_PG_ENV", "/data/pg.env")
_pg = {"aus_bis": {}, "fehler": "", "bereit": False}


def _zugang():
    werte = dict(l.strip().split("=", 1) for l in open(PG_ENV) if "=" in l and not l.startswith("#"))
    ports = [int(x) for x in werte.get("PGPORTS", "5439,5440").split(",") if x.strip().isdigit()]
    return werte, ports


def _verbinden(port, werte):
    import psycopg2
    c = psycopg2.connect(host=werte.get("PGHOST", "127.0.0.1"), port=port, user=werte.get("PGUSER", "cc"),
                         dbname=werte.get("PGDATABASE", "cc"), password=werte["POSTGRES_PASSWORD"],
                         connect_timeout=2, application_name="command-center")
    c.autocommit = True
    return c


def _pg_verbindung(schreiben=False):
    """Verbindung je Thread und Rolle; None → SQLite. schreiben=True verlangt den Haupt-Server."""
    attr = "pg_w" if schreiben else "pg_r"
    c = getattr(_lokal, attr, None)
    if c is not None and not c.closed:
        return c
    try:
        werte, ports = _zugang()
    except FileNotFoundError:
        _pg["fehler"] = "kein Zugang (/data/pg.env fehlt)"
        return None
    except Exception as e:
        _pg["fehler"] = str(e)[:160]
        return None
    kopie = None
    for port in ports:
        if time.time() < _pg["aus_bis"].get(port, 0):
            continue
        try:
            v = _verbinden(port, werte)
            with v.cursor() as cur:
                cur.execute("SELECT pg_is_in_recovery()")
                in_wiederherstellung = cur.fetchone()[0]
                if not in_wiederherstellung and not _pg["bereit"]:
                    cur.execute("CREATE TABLE IF NOT EXISTS werte (k TEXT PRIMARY KEY, t DOUBLE PRECISION NOT NULL, v TEXT NOT NULL)")
                    cur.execute("CREATE TABLE IF NOT EXISTS dateien (pfad TEXT PRIMARY KEY, sig TEXT NOT NULL, v TEXT NOT NULL)")
                    _pg["bereit"] = True
            if not in_wiederherstellung:
                if kopie is not None:
                    kopie.close()
                setattr(_lokal, attr, v)
                _pg["fehler"] = ""
                return v
            if schreiben:
                v.close()
            elif kopie is None:
                kopie = v
            else:
                v.close()
        except Exception as e:
            _pg["aus_bis"][port] = time.time() + 60
            _pg["fehler"] = f"Port {port}: " + str(e).strip().split("\n")[0][:140]
    if kopie is not None:
        setattr(_lokal, attr, kopie)
        return kopie
    return None


def _pg_fehler(e, schreiben):
    attr = "pg_w" if schreiben else "pg_r"
    c = getattr(_lokal, attr, None)
    setattr(_lokal, attr, None)
    try:
        port = int(c.info.port) if c is not None else None
        if port:
            _pg["aus_bis"][port] = time.time() + 60
        if c is not None:
            c.close()
    except Exception:
        pass
    _pg["fehler"] = str(e).strip().split("\n")[0][:160]


def _pg_tun(sql, args=(), holen=False, schreiben=False):
    """SQL in Postgres. Rückgabe (ok, ergebnis) – ok=False → Aufrufer nimmt SQLite."""
    for _ in range(2):                      # einmal neu verbinden (z. B. nach Umschalten auf die Kopie)
        c = _pg_verbindung(schreiben)
        if c is None:
            return False, None
        try:
            with c.cursor() as cur:
                cur.execute(sql, args)
                return True, (cur.fetchone() if holen else None)
        except Exception as e:
            _pg_fehler(e, schreiben)
    return False, None


def status():
    out = {"speicher": "SQLite", "ort": DB, "server": []}
    try:
        werte, ports = _zugang()
    except Exception:
        out["grund"] = _pg["fehler"] or "PostgreSQL nicht eingerichtet"
        return out
    namen = {5439: "cc_db", 5440: "cc_db_replica"}
    for port in ports:
        eintrag = {"name": namen.get(port, str(port)), "port": port}
        try:
            v = _verbinden(port, werte)
            with v.cursor() as cur:
                cur.execute("SELECT pg_is_in_recovery()")
                kopie = cur.fetchone()[0]
                eintrag["rolle"] = "Kopie (nur lesen)" if kopie else "Haupt"
                if kopie:
                    cur.execute("SELECT status, EXTRACT(EPOCH FROM now() - COALESCE(pg_last_xact_replay_timestamp(), now())) FROM pg_stat_wal_receiver")
                    r = cur.fetchone()
                    eintrag["replikation"] = r[0] if r else "getrennt"
                else:
                    cur.execute("SELECT (SELECT count(*) FROM werte), (SELECT count(*) FROM dateien), pg_database_size(current_database())")
                    r = cur.fetchone()
                    eintrag.update(eintraege=r[0], dateien=r[1], groesse=r[2])
                    cur.execute("SELECT application_name, state, EXTRACT(EPOCH FROM replay_lag) FROM pg_stat_replication")
                    eintrag["kopien"] = [{"state": x[1], "verzoegerung_s": float(x[2] or 0)} for x in cur.fetchall()]
            v.close()
            eintrag["erreichbar"] = True
        except Exception as e:
            eintrag.update(erreichbar=False, fehler=str(e).strip().split("\n")[0][:120])
        out["server"].append(eintrag)
    haupt = next((x for x in out["server"] if x.get("rolle") == "Haupt"), None)
    kopie = next((x for x in out["server"] if x.get("erreichbar") and x.get("rolle", "").startswith("Kopie")), None)
    if haupt:
        out.update(speicher="PostgreSQL", ort=f"{haupt['name']} (127.0.0.1:{haupt['port']})",
                   eintraege=haupt["eintraege"], dateien=haupt["dateien"], groesse=haupt["groesse"])
    elif kopie:
        out.update(speicher="PostgreSQL-Kopie (nur lesen) + SQLite", ort=f"{kopie['name']} (127.0.0.1:{kopie['port']})",
                   grund="Haupt-Datenbank nicht erreichbar – gelesen wird aus der Kopie, geschrieben nur in SQLite")
    else:
        out["grund"] = _pg["fehler"] or "keine PostgreSQL-Datenbank erreichbar"
    return out


def _lesen(k):
    ok, r = _pg_tun("SELECT t, v FROM werte WHERE k = %s", (k,), holen=True)
    if ok:
        return (r[0], json.loads(r[1])) if r else None
    try:
        r = _db().execute("SELECT t, v FROM werte WHERE k = ?", (k,)).fetchone()
        return (r[0], json.loads(r[1])) if r else None
    except Exception:
        return None


def _schreiben(k, t, v):
    j = json.dumps(v, ensure_ascii=False)
    # Postgres ist Hauptspeicher; SQLite wird immer mitgeschrieben (warmer Rückfall, falls cc_db ausfällt)
    _pg_tun("INSERT INTO werte VALUES (%s, %s, %s) ON CONFLICT (k) DO UPDATE SET t = EXCLUDED.t, v = EXCLUDED.v", (k, t, j), schreiben=True)
    try:
        with _db() as c:
            c.execute("INSERT OR REPLACE INTO werte VALUES (?, ?, ?)", (k, t, j))
    except Exception:
        pass


def _rechnen_und_merken(k, rechnen):
    v = rechnen()
    t = time.time()
    with _lock:
        _mem[k] = (t, v)
    _schreiben(k, t, v)
    return v


def holen(k, rechnen, ttl=30, max_alter=600):
    jetzt = time.time()
    with _lock:
        hit = _mem.get(k)
    if hit is None:
        hit = _lesen(k)
        if hit:
            with _lock:
                _mem[k] = hit
    if hit:
        alter = jetzt - hit[0]
        if alter < ttl:
            return hit[1]
        if alter < max_alter:
            with _lock:
                frei = k not in _laeuft
                _laeuft.add(k)
            if frei:
                def hinten():
                    try:
                        _rechnen_und_merken(k, rechnen)
                    except Exception:
                        pass
                    finally:
                        with _lock:
                            _laeuft.discard(k)
                threading.Thread(target=hinten, daemon=True).start()
            return hit[1]
    return _rechnen_und_merken(k, rechnen)


def ungueltig(praefix):
    with _lock:
        for k in [k for k in _mem if k.startswith(praefix)]:
            _mem.pop(k, None)
    _pg_tun("DELETE FROM werte WHERE k LIKE %s", (praefix.replace("%", "") + "%",), schreiben=True)
    try:
        with _db() as c:
            c.execute("DELETE FROM werte WHERE k LIKE ?", (praefix.replace("%", "") + "%",))
    except Exception:
        pass


def datei(pfad, sig, rechnen):
    sig = json.dumps(sig)
    ok, r = _pg_tun("SELECT sig, v FROM dateien WHERE pfad = %s", (pfad,), holen=True)
    if ok and r and r[0] == sig:
        return json.loads(r[1])
    if not ok:
        try:
            r = _db().execute("SELECT sig, v FROM dateien WHERE pfad = ?", (pfad,)).fetchone()
            if r and r[0] == sig:
                return json.loads(r[1])
        except Exception:
            pass
    v = rechnen()
    j = json.dumps(v, ensure_ascii=False)
    _pg_tun("INSERT INTO dateien VALUES (%s, %s, %s) ON CONFLICT (pfad) DO UPDATE SET sig = EXCLUDED.sig, v = EXCLUDED.v", (pfad, sig, j), schreiben=True)
    try:
        with _db() as c:      # Spiegel in SQLite (warmer Rückfall)
            c.execute("INSERT OR REPLACE INTO dateien VALUES (?, ?, ?)", (pfad, sig, j))
    except Exception:
        pass
    return v
