# Entwicklung

| Teil | Wo |
|---|---|
| Server | `server.py`, `dashboard/*.py` (Python-Standardbibliothek, `http.server`; optional `psycopg2`) |
| Oberfläche | `static/index.html`, `static/app.js` + Module (`angriffe.js`, `benutzer.js`, `terminal-tabs.js`, `hilfe.js`, `bewegung.js`, `graph.js` …), `static/ui.css` |
| Rechte | `dashboard/rechte.py` – **neue Endpunkte in `recht_fuer()` eintragen**, sonst nur für Superadmins |
| Schutz-Paket | `schutz/` (Bash/Python, systemd, fail2ban) |
| Image | `Dockerfile` (Debian bookworm, KasmVNC für VM-Konsolen) |

`static/`, `dashboard/` und `server.py` werden in den Container gemountet – Änderungen wirken nach
`docker compose restart`. Prüfen: `python3 -m py_compile dashboard/*.py`, `node --check static/*.js`
(läuft auch in GitHub Actions).

Beiträge sind willkommen: Issue oder Pull Request. Sicherheitslücken bitte über
[Security Advisories](../SECURITY.md).
