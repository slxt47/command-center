"""Angriffs-Radar (seit 3.6.0, 19.11.2026): liest /data/angriffe.sqlite3 (schreibt nur der Host-Sammler
schutz/sbin/angriffe-sammeln.py alle 5 min) und fasst für GET /api/security/angriffe?bereich=24h|7d|30d zusammen.
Nur lesend; Ergebnis 30 s zwischengespeichert.
"""
import os
import sqlite3
import threading
import time

DB = os.environ.get("ANGRIFFE_DB", "/data/angriffe.sqlite3")
BEREICHE = {"24h": (86400, 3600), "7d": (7 * 86400, 6 * 3600), "30d": (30 * 86400, 86400)}
KATEGORIEN = ("geheim", "luecke", "login", "netz")
_cache = {}
_lock = threading.Lock()


def _verbinden():
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def _rechnen(bereich):
    dauer, schritt = BEREICHE[bereich]
    jetzt = int(time.time())
    # Fächer an Ortszeit-Grenzen ausrichten (Tage beginnen um Mitternacht)
    versatz = -time.localtime(jetzt).tm_gmtoff
    ende = ((jetzt - versatz) // schritt + 1) * schritt + versatz
    start = ende - (dauer // schritt) * schritt
    vorher = start - (ende - start)
    c = _verbinden()
    try:
        meta = {r["k"]: r["v"] for r in c.execute("SELECT k, v FROM meta")}
        zeiten = list(range(start, ende, schritt))
        reihen = {k: [0] * len(zeiten) for k in KATEGORIEN}
        for r in c.execute("SELECT (ts - ?) / ? AS f, kat, COUNT(*) n FROM versuche WHERE ts >= ? AND ts < ? GROUP BY f, kat",
                           (start, schritt, start, ende)):
            if r["kat"] in reihen and 0 <= r["f"] < len(zeiten):
                reihen[r["kat"]][r["f"]] = r["n"]

        def summen(a, b):
            s = {k: 0 for k in KATEGORIEN}
            for r in c.execute("SELECT kat, COUNT(*) n FROM versuche WHERE ts >= ? AND ts < ? GROUP BY kat", (a, b)):
                s[r["kat"]] = r["n"]
            ips = c.execute("SELECT COUNT(DISTINCT ip) FROM versuche WHERE ts >= ? AND ts < ?", (a, b)).fetchone()[0]
            bans = c.execute("SELECT COUNT(*) FROM sperren WHERE aktion='ban' AND ts >= ? AND ts < ?", (a, b)).fetchone()[0]
            return {"kategorien": s, "gesamt": sum(s.values()), "ips": ips, "sperren": bans}

        jetzt_s, vorher_s = summen(start, ende), summen(vorher, start)

        # Wer ist gerade gesperrt? (letztes Ereignis je IP = ban)
        gesperrt = {r["ip"] for r in c.execute(
            "SELECT ip, aktion FROM sperren s WHERE ts = (SELECT MAX(ts) FROM sperren WHERE ip = s.ip) AND aktion='ban'")}

        top_ips = []
        for r in c.execute("""SELECT ip, COUNT(*) n, MIN(ts) erst, MAX(ts) letzt,
                                SUM(kat='geheim') g, SUM(kat='luecke') l, SUM(kat='login') a, SUM(kat='netz') z
                              FROM versuche WHERE ts >= ? AND ts < ? GROUP BY ip ORDER BY n DESC LIMIT 25""", (start, ende)):
            ziele = [x[0] for x in c.execute(
                "SELECT ziel, COUNT(*) n FROM versuche WHERE ip = ? AND ts >= ? AND ts < ? GROUP BY ziel ORDER BY n DESC LIMIT 3",
                (r["ip"], start, ende))]
            top_ips.append({"ip": r["ip"], "anzahl": r["n"], "erst": r["erst"], "letzt": r["letzt"], "ziele": ziele,
                            "kategorien": {"geheim": r["g"], "luecke": r["l"], "login": r["a"], "netz": r["z"]},
                            "gesperrt": r["ip"] in gesperrt})

        pfade = [{"pfad": r["detail"], "art": r["art"], "anzahl": r["n"], "ips": r["i"]} for r in c.execute(
            """SELECT detail, art, COUNT(*) n, COUNT(DISTINCT ip) i FROM versuche WHERE kat IN ('geheim','luecke')
               AND quelle != 'fail2ban' AND ts >= ? AND ts < ? GROUP BY detail ORDER BY n DESC LIMIT 15""", (start, ende))]
        ziele = [{"ziel": r["ziel"], "anzahl": r["n"], "ips": r["i"],
                  "web": r["w"], "login": r["a"]} for r in c.execute(
            """SELECT ziel, COUNT(*) n, COUNT(DISTINCT ip) i, SUM(kat IN ('geheim','luecke')) w, SUM(kat='login') a
               FROM versuche WHERE kat != 'netz' AND ts >= ? AND ts < ? GROUP BY ziel ORDER BY n DESC LIMIT 12""", (start, ende))]
        ids = [{"signatur": r["detail"], "anzahl": r["n"], "ips": r["i"]} for r in c.execute(
            """SELECT detail, COUNT(*) n, COUNT(DISTINCT ip) i FROM versuche WHERE kat='netz' AND ts >= ? AND ts < ?
               GROUP BY detail ORDER BY n DESC LIMIT 8""", (start, ende))]
        letzte = [dict(r) for r in c.execute(
            """SELECT ts, ip, kat, art, ziel, detail, status FROM versuche WHERE kat != 'netz'
               ORDER BY ts DESC LIMIT 40""")]
        return {
            "bereich": bereich, "start": start, "ende": ende, "schritt": schritt, "jetzt": jetzt,
            "zeiten": zeiten, "reihen": reihen, "summen": jetzt_s, "vorher": vorher_s,
            "top_ips": top_ips, "pfade": pfade, "ziele": ziele, "ids": ids, "letzte": letzte,
            "letzter_lauf": int(meta.get("letzter_lauf", 0)), "seit": int(meta.get("seit", 0)),
            "vergleich": vorher >= int(meta.get("seit", 0)),
        }
    finally:
        c.close()


def angriffe_daten(bereich="24h"):
    bereich = bereich if bereich in BEREICHE else "24h"
    if not os.path.exists(DB):
        return {"fehlt": True, "bereich": bereich}
    with _lock:
        hit = _cache.get(bereich)
        if hit and time.time() - hit[0] < 30:
            return hit[1]
    try:
        d = _rechnen(bereich)
    except sqlite3.Error as e:
        return {"fehler": f"Datenbank nicht lesbar: {e}", "bereich": bereich}
    with _lock:
        _cache[bereich] = (time.time(), d)
    return d
