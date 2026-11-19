# Schutz-Paket & Angriffs-Radar

Wird auf Debian/Ubuntu mitinstalliert (`schutz/install-schutz.sh`), abschaltbar mit `--ohne-schutz`.

| Teil | Was es tut |
|---|---|
| **fail2ban** | SSH, Command-Center-Login und weitere Jails; Sperre an der Firewall (optional auch am Cloudflare-Rand) |
| **IDS-Wächter** | Suricata passiv → `ids-watch` → bekannte Angreifer-Netze werden gesperrt (`--ids-modus sperren`) |
| **Firewall-Sperrlisten** | eigene ipsets/Ketten, rein additiv |
| **Angriffs-Radar** | `angriffe-sammeln.timer` (alle 2 min): Web-Scans aus allen Container-Logs (nginx-Format), Login-Fehlversuche, IDS-Treffer → Seite „Angriffe“ |
| **Automatische Sperre** | Jails `web-scan` (3 Scans/Stunde) und `web-exploit` (1 Exploit-Versuch) → 1 Tag, bei Wiederholung verdoppelt bis 4 Wochen |

Erkannt werden u. a. Suche nach `.env`, `.git`, Schlüsseln, Konfigurationen von KI-Werkzeugen, WordPress/PHP/Admin-Scans,
`../`, `${jndi`, `/proc/self/environ`. Normaler Verkehr wird nicht gespeichert; Aufbewahrung 90 Tage.

Befehle: `waechter status`, `sudo fail2ban-client status web-scan`, `sudo journalctl -u angriffe-sammeln`.

**Tipp:** Webserver sollten versteckte Pfade mit `404` beantworten statt `403` (`location ~ /\.(?!well-known/) { log_not_found off; return 404; }`) – das spart Fehlerzeilen und verrät nichts.
