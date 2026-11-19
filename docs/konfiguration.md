# Konfiguration

Alle Einstellungen stehen in `/etc/linux-dashboard/dashboard.env` (Format `KEY=wert`, ohne Anführungszeichen).
Wirksam nach `sudo command-center neustart`.

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `DASH_PORT` | `8420` | Port |
| `CC_SPRACHE` | `de` | Sprache für Besucher ohne eigene Wahl (`de`, `en`). Jeder Benutzer wählt seine Sprache unter Einstellungen bzw. auf der Anmeldeseite; das Konto merkt sie sich |
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

Die Oberfläche gibt es auf **Deutsch** und **Englisch** (Anmeldeseite, alle Seiten, Meldungen, Hilfe, Datums- und
Zahlenformate). Reihenfolge: eigene Wahl (Einstellungen → Sprache oder Anmeldeseite, im Konto gespeichert) →
`CC_SPRACHE` → Deutsch.

Eine weitere Sprache ist eine Datei: Wörterbuch `intern/i18n/<code>.json` (Paare Deutsch → Sprache) und
`intern/i18n/<code>-hilfe.js`, dann `python3 intern/i18n/bauen.py` und die Sprache in `static/icons/i18n.js`
(`SPRACHEN`) und `dashboard/prefs.py` eintragen. Fehlende Texte zeigt `python3 intern/i18n/pruefen.py <code>`.
