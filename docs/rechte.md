# Benutzer, Gruppen & Rechte

Anmelden kann sich jeder **Linux-Benutzer** des Servers. Was er sieht und darf, bestimmen:

- **Superadmins** (`DASH_SUPERADMINS`): alles.
- **Gruppen**: Rechte = Gruppe „Alle Angemeldeten“ + alle Gruppen, in denen der Benutzer ist.

## Rechte

| Bereich | Rechte (⚠ = kritisch) |
|---|---|
| Zugriff | Browser-Sitzungen, Verbindungen, Eigene virtuelle Maschinen |
| System | Prozesse ansehen, ⚠ Prozesse beenden, Dienste ansehen, ⚠ Dienste steuern, Updates ansehen, ⚠ Updates installieren, ⚠ Server-Terminal |
| Container | Docker ansehen, Container starten/stoppen, ⚠ Docker verwalten |
| Sicherheit | Sicherheit ansehen, IPs sperren/entsperren, Benachrichtigungen, Benutzer ansehen, ⚠ Benutzer verwalten |
| Werkzeuge | Mein Dashboard bearbeiten, Automationen, IT-Tools, ⚠ Backups, ⚠ Konten, ⚠ 2FA-Codes |

Kritisch heißt: damit kann man den Server praktisch übernehmen oder an Geheimnisse kommen.

## Gruppen-Vorlagen

Alle Angemeldeten · Beobachter · Docker-Betreuer · Docker-Admin · System-Admin · Sicherheit · VM-Nutzer ·
Benutzerpflege · Werkzeuge · Tresor – änderbar, eigene anlegbar (nur Superadmins). Speicher:
`/var/lib/linux-dashboard/gruppen.json`.

## Regeln, die immer gelten

- Der **Server** prüft jedes Recht bei jeder Anfrage; das Menü blendet nur aus.
- **Passwörter anderer** setzt nur der **Inhaber** (`DASH_INHABER`) – auch kein anderer Superadmin.
- **Benutzerpflege** vergibt nur Gruppen, deren Rechte sie selbst hat, ändert keine eigenen Gruppen, löscht keine
  Superadmins, legt neue Konten ohne SSH-Zugang an.
- **Dienstkonten** (UID ≥ 60000) sind geschützt.
- **Terminal ohne Root:** Nicht-Superadmins bekommen die Shell als eigener Benutzer mit `no_new_privs` – `sudo`/`su`
  wirken nicht. Zusätzlich empfehlenswert: `su` nur für die sudo-Gruppe (`auth required pam_wheel.so group=sudo` in `/etc/pam.d/su`).
