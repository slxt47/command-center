# Optionale Funktionen (`funktionen.json`)

Ohne Konfiguration ist das Command Center neutral. Wer zusätzliche Seiten nutzt, legt
`/var/lib/linux-dashboard/funktionen.json` an (Beispiel: [`config/funktionen.beispiel.json`](../config/funktionen.beispiel.json)):

| Schlüssel | Seite / Wirkung |
|---|---|
| `einbettungen.konten` / `.backups` / `.werkzeuge` / `.codes` | eingebettete Web-Apps, die **lokal** laufen (`port`, erwarteter `host`, optional `token`). Sie laufen in einer Sandbox ohne Zugriff auf das Command Center |
| `startseite.url` | Seite „Mein Dashboard“ (Kacheln einer eigenen Startseite; braucht `startseite-token`) |
| `automationen.url` | Seite „Automationen“ (n8n; braucht `n8n-api-key`) |
| `profilbild_ebenen` | zusätzliches Profilbild aus Ebenen (`static/icons/profil/…`), `true` oder Beschriftung |
| `iso_verzeichnisse` | Ziel für ISO-Downloads (erstes beschreibbares) |
| `ntfy_senden` | Skript für Push-Meldungen bei Passwort-Ereignissen |

Die Datei wird alle 30 Sekunden neu gelesen. Rechte: Seiten „Konten“, „Backups“, „IT-Tools“, „Codes“ entsprechen den
gleichnamigen Rechten.
