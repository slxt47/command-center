# Sicherheit

Das Command Center verwaltet einen Server mit **Root-Rechten** (Docker-Socket, `nsenter` in den Host). Wer sich als
Superadmin anmeldet, kann den Server vollständig steuern. Deshalb:

- **Nicht ungeschützt ins Internet stellen.** Zugriff nur aus vertrauenswürdigen Netzen (`--lan`: private Netze,
  Tailscale, VPN) oder über einen HTTPS-Reverse-Proxy bzw. Cloudflare Tunnel **mit Zugangsschutz** (z. B. Cloudflare
  Access). Standard: erlaubt sind localhost und private Netze (`DASHBOARD_ALLOWED_NETS`).
- **Anmeldung** mit echten Linux-Konten (Passwort aus `/etc/shadow`) oder einem eigenen Command-Center-Passwort;
  Fehlversuche landen in `/var/lib/linux-dashboard/auth.log` (fail2ban-Jail `dashboard-auth` im Schutz-Paket).
- **Rechte:** Superadmins dürfen alles. Alle anderen nur, was ihre Gruppen erlauben – der Server prüft jede Anfrage.
  Neun Rechte sind als kritisch markiert (entsprechen praktisch Root oder Zugang zu Geheimnissen).
- **Terminal für Nicht-Superadmins** läuft als eigener Linux-Benutzer mit `no_new_privs` – `sudo`, `su` und andere
  setuid-Programme können keine Rechte erlangen.
- **Passwörter anderer Benutzer** setzt nur der Inhaber (`DASH_INHABER`).
- Cookies `HttpOnly` + `SameSite=Strict`, CSP, Schutz vor Clickjacking; eingebettete Apps laufen in einer Sandbox
  ohne Zugriff auf Command-Center-Cookies.

## Lücke melden

Bitte **nicht** als öffentliches Issue, sondern über
[GitHub Security Advisories](https://github.com/slxt47/command-center/security/advisories/new) dieses Repositorys.
Du bekommst eine Rückmeldung, sobald ich es mir angesehen habe.
