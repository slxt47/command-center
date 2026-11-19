# Konfiguration

Alle Einstellungen stehen in `/etc/linux-dashboard/dashboard.env` (Format `KEY=wert`, ohne Anführungszeichen).
Wirksam nach `sudo command-center neustart`.

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `DASH_PORT` | `8420` | Port |
| `CC_SPRACHE` | `de` | Sprache für Besucher ohne eigene Wahl (`de`, `en`, `es`). Jeder Benutzer wählt seine Sprache unter Einstellungen bzw. auf der Anmeldeseite; das Konto merkt sie sich |
| `DASHBOARD_ALLOWED_NETS` | private Netze | wer direkt zugreifen darf (CIDR, Komma; `*` = alle). localhost geht immer |
| `DASHBOARD_TRUSTED_PROXIES` | `127.0.0.0/8,::1/128` | von wem `X-Forwarded-For`/`CF-Connecting-IP` geglaubt wird |
| `DASHBOARD_PUBLIC_URL` | – | Adresse für Links (z. B. Sperrseite) |
| `DASH_SUPERADMINS` | `root` | Konten mit allen Rechten |
| `DASH_INHABER` | erster Superadmin außer root | darf als Einziger Passwörter anderer Benutzer setzen |
| `DASH_ADMIN_GROUP` | `dashadmin` | alte Admin-Gruppe (entspricht heute „VM-Nutzer“) |
| `DASHBOARD_WAN_IF` | `auto` | Netzwerkschnittstelle für Verkehrs-Graphen |
| `DASHBOARD_COOKIE_SECURE` | `auto` | Secure-Cookies: `auto` (nur bei HTTPS), `1`, `0` |
| `DASH_HOST_PUBLIC_IPS` | automatisch | öffentliche IPs (Gast-Isolation für VMs) |

## Mail für „Passwort vergessen?“

Datei `/var/lib/linux-dashboard/mail.env` (0600): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
Ohne Datei gibt es keinen Mailversand; Passwörter setzt dann der Inhaber.

## Eigenes Command-Center-Passwort

Statt des Linux-Passworts kann ein Benutzer ein eigenes Passwort nur fürs Command Center haben (Linux/SSH bleibt
unverändert):

```bash
docker exec -i linux-dashboard python3 -m dashboard.ccpasswort setzen anna    # Passwort über stdin
```

Optionale Seiten (eingebettete Apps, eigene Startseite, n8n): [funktionen.md](funktionen.md).

## Sprachen

Die Oberfläche gibt es auf **Deutsch**, **Englisch** und **Spanisch** (Anmeldeseite, alle Seiten, Meldungen, Hilfe, Datums- und
Zahlenformate). Reihenfolge: eigene Wahl (Einstellungen → Sprache oder Anmeldeseite, im Konto gespeichert) →
`CC_SPRACHE` → Deutsch.

Die Übersetzungen stecken fertig gebaut in `static/icons/sprache-<code>.js`. Fehlt ein Text oder
wünschst du eine weitere Sprache, öffne ein Issue im Repo.

## Weitere Dateien

| Datei | Inhalt |
|---|---|
| `/etc/linux-dashboard/module.conf` | gewählte Module (`sudo command-center module`) |
| `/etc/linux-dashboard/schutz.conf` | Schutz-Paket (u. a. `F2B_AKTIV`, `RADAR_AKTIV`, `IDS_SPERRZEIT`, `TRUSTED_IPS`) |
| `/var/lib/linux-dashboard/lizenz.json` | Lizenz (Schlüssel, gültig bis, letzte Prüfung) – siehe [Lizenz](lizenz.md) |
| `BACKUP_ZIEL`, `BACKUP_TAGE` in `dashboard.env` | Backup-Modul: Ziel (Standard `/var/backups/command-center`) und Aufbewahrung (14 Tage) |
