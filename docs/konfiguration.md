# Konfiguration

Alle Einstellungen stehen in `/etc/linux-dashboard/dashboard.env` (Format `KEY=wert`, ohne Anführungszeichen).
Wirksam nach `sudo command-center neustart`.

| Schlüssel | Standard | Bedeutung |
|---|---|---|
| `DASH_PORT` | `8420` | Port |
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
