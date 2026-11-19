"""Verlauf für die Graphen auf der Übersicht (seit 3.0.0, 10.11.2026).

Ein Hintergrund-Thread misst alle SCHRITT_S Sekunden, nur aus /proc und /sys (kein Unterprozess):

    cpu   Auslastung aller Kerne in %          (/proc/stat, Differenz)
    ram   belegter Arbeitsspeicher in %        (/proc/meminfo, MemTotal − MemAvailable)
    swap  belegter Auslagerungsspeicher in %
    load  Last 1 min                           (os.getloadavg)
    rx/tx Datenverkehr der WAN-Schnittstelle in bit/s (dieselbe wie im IDS-Wächter)
    rd/wr Lesen/Schreiben aller echten Datenträger in Byte/s (/proc/diskstats, ohne loop/ram/dm/Partitionen)

Zwei Auflösungen:
    fein  letzte Stunde, je SCHRITT_S (720 Punkte)
    grob  letzte 24 Stunden, Mittel je Minute (1440 Punkte); wird alle 5 min nach /data/verlauf.json
          geschrieben (0600, atomar), damit der Verlauf einen Neustart des Containers/Servers übersteht.

Keine personenbezogenen Daten, nur Kennzahlen des Servers.
"""

import json
import os
import re
import threading
import time
from collections import deque

from dashboard.base import DATA_DIR
from dashboard.ids import IFACE

SCHRITT_S = 5
FEIN = 3600 // SCHRITT_S
GROB = 24 * 60
DATEI = DATA_DIR / "verlauf.json"
FELDER = ("cpu", "ram", "swap", "load", "rx", "tx", "rd", "wr")

_lock = threading.Lock()
_fein = deque(maxlen=FEIN)          # (t, cpu, ram, swap, load, rx, tx, rd, wr)
_grob = deque(maxlen=GROB)          # (minute_t, …Mittelwerte)
_minute = {"t": None, "summe": None, "n": 0}
_gestartet = False

_DISK_RE = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")


def _cpu_jiffies():
    with open("/proc/stat") as fh:
        f = fh.readline().split()
    werte = [int(x) for x in f[1:8]]
    return sum(werte), werte[3] + werte[4]


def _speicher():
    m = {}
    with open("/proc/meminfo") as fh:
        for zeile in fh:
            k, _, rest = zeile.partition(":")
            m[k] = int(rest.split()[0])
    total = m.get("MemTotal", 0) or 1
    ram = (total - m.get("MemAvailable", 0)) / total * 100
    st = m.get("SwapTotal", 0)
    swap = (st - m.get("SwapFree", 0)) / st * 100 if st else 0.0
    return ram, swap


def _netz():
    basis = f"/sys/class/net/{IFACE}/statistics/"
    with open(basis + "rx_bytes") as a, open(basis + "tx_bytes") as b:
        return int(a.read()), int(b.read())


def _platten():
    rd = wr = 0
    with open("/proc/diskstats") as fh:
        for zeile in fh:
            f = zeile.split()
            if len(f) > 9 and _DISK_RE.match(f[2]):
                rd += int(f[5]) * 512
                wr += int(f[9]) * 512
    return rd, wr


def _laden():
    try:
        with open(DATEI, encoding="utf-8") as fh:
            d = json.load(fh)
        grenze = time.time() - GROB * 60
        for p in d.get("grob", []):
            if len(p) == 1 + len(FELDER) and p[0] > grenze:
                _grob.append(tuple(p))
    except (OSError, ValueError, TypeError):
        pass


def _sichern():
    with _lock:
        daten = {"version": 1, "grob": [list(p) for p in _grob]}
    tmp = DATEI.with_suffix(".tmp")
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(daten, fh, separators=(",", ":"))
        os.replace(tmp, DATEI)
    except OSError:
        pass


def _minute_abschliessen(t_min):
    m = _minute
    if m["t"] is not None and m["n"]:
        mittel = tuple(round(s / m["n"], 2) for s in m["summe"])
        _grob.append((m["t"],) + mittel)
    m["t"], m["summe"], m["n"] = t_min, [0.0] * len(FELDER), 0


def _runde(werte):
    return tuple(round(v, 2) if isinstance(v, float) else v for v in werte)


def _sammler():
    letzt = None
    zuletzt_gesichert = time.time()
    while True:
        try:
            jetzt = time.time()
            ges, idle = _cpu_jiffies()
            rx, tx = _netz()
            rd, wr = _platten()
            if letzt:
                dt = jetzt - letzt["t"]
                dges = ges - letzt["ges"]
                cpu = (1 - (idle - letzt["idle"]) / dges) * 100 if dges > 0 else 0.0
                ram, swap = _speicher()
                punkt = _runde((
                    max(0.0, min(100.0, cpu)), ram, swap, os.getloadavg()[0],
                    max(0.0, (rx - letzt["rx"]) * 8 / dt), max(0.0, (tx - letzt["tx"]) * 8 / dt),
                    max(0.0, (rd - letzt["rd"]) / dt), max(0.0, (wr - letzt["wr"]) / dt),
                ))
                t_min = int(jetzt // 60 * 60)
                with _lock:
                    _fein.append((round(jetzt, 1),) + punkt)
                    if _minute["t"] != t_min:
                        _minute_abschliessen(t_min)
                    _minute["summe"] = [s + v for s, v in zip(_minute["summe"], punkt)]
                    _minute["n"] += 1
            letzt = {"t": jetzt, "ges": ges, "idle": idle, "rx": rx, "tx": tx, "rd": rd, "wr": wr}
            if jetzt - zuletzt_gesichert > 300:
                zuletzt_gesichert = jetzt
                _sichern()
        except Exception:
            letzt = None
        time.sleep(SCHRITT_S)


def starten():
    global _gestartet
    with _lock:
        if _gestartet:
            return
        _gestartet = True
    _laden()
    threading.Thread(target=_sammler, name="verlauf", daemon=True).start()


def verlauf(bereich="1h", seit=0.0):
    """Punkte für den Graphen. bereich: '1h' (fein) oder '24h' (je Minute); seit: nur neuere Punkte."""
    starten()
    with _lock:
        if bereich == "24h":
            punkte = [list(p) for p in _grob if p[0] > seit]
            schritt = 60
        else:
            punkte = [list(p) for p in _fein if p[0] > seit]
            schritt = SCHRITT_S
    return {"felder": ["t", *FELDER], "punkte": punkte, "schritt": schritt,
            "bereich": "24h" if bereich == "24h" else "1h", "jetzt": round(time.time(), 1),
            "schnittstelle": IFACE}
