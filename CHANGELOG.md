# Änderungen

## 3.15.2 – 2026-11-19

- Browser-Sitzungen zeigen die Uhrzeit des Servers statt UTC (einstellbar mit `CC_ZEITZONE` in dashboard.env).

## 3.15.1 – 2026-11-19 · neue Lizenz

- Das Repository steht ab jetzt unter der **Elastic License 2.0**: Nutzung auf eigenen Servern, Code lesen und ändern bleibt erlaubt; nicht erlaubt sind das Anbieten als gehosteter Dienst und das Entfernen oder Umgehen der Lizenzprüfung. Frühere Versionen (bis 3.15.0) bleiben MIT.

## 3.15.0 – 2026-11-19 · Module, Lizenz, Spanisch, Hilfe mit Bildern

- **Module frei wählbar:** Beim Installieren eine Liste zum An-/Abhaken – fail2ban, IDS, Firewall, Angriffs-Radar, Cloudflare, ntfy, PostgreSQL, Backup. **IDS geht jetzt auch ohne fail2ban** (sperrt dann selbst). Später: `sudo command-center module +postgres -ids`.
- **Neues Modul Backup:** jede Nacht Einstellungen und Daten (SQLite konsistent, PostgreSQL-Dump) nach `/var/backups/command-center`, 14 Tage; `sudo command-center backup [--liste | --zurueck DATEI]`.
- **Lizenz:** Schlüssel beim Installieren und bei Updates (anfragen: [lizenz.slxt.dev](https://lizenz.slxt.dev)), Karte unter Einstellungen, Hinweis 30 Tage vor Ablauf; danach läuft alles weiter, nur Updates sind gesperrt. Siehe docs/lizenz.md.
- **Spanisch** als dritte Sprache (Oberfläche, Hilfe, Installer).
- **Hilfe mit Bildern** je Bereich und **häufigen Fragen** (aufklappbar, durchsuchbar), Bild antippen = groß.
- Installer: zweisprachige Fehler behoben (Update brach nach „Docker vorhanden“ ab, wenn keine Sprache angegeben war; abgebrochener Erstversuch galt als alte Installation).

## 3.14.0 – 2026-11-19 · Deutsch & Englisch

- **Englische Oberfläche:** alle Seiten, Meldungen, Dialoge, Fehlermeldungen des Servers, Anmeldeseite, Hilfe sowie Datums- und Zahlenformate. Sprachwahl unter Einstellungen → Sprache und auf der Anmeldeseite; das Konto merkt sie sich auf allen Geräten.
- **Installer:** fragt zuerst nach der Sprache (auch bei `curl … | sudo bash`), Option `--sprache de|en`, Ausgaben zweisprachig; `sudo command-center sprache de|en` ändert die Voreinstellung (`CC_SPRACHE`).
- Weitere Sprachen: je eine Wörterbuch-Datei (`intern/i18n/`, siehe docs/konfiguration.md).

## 3.13.0 – 2026-11-19 · erste öffentliche Version

**Neu für alle Installationen**
- Ein-Zeilen-Installation (`get.sh`) für Debian, Ubuntu, Fedora, RHEL/Alma/Rocky, Arch, openSUSE; x86_64 und arm64; fertiges Image auf GHCR; Befehl `command-center` (status, update, logs, deinstallieren).
- Eingebaute **Hilfe** (Seite „Hilfe“, Taste `?`, Suche).
- Optionale Funktionen über `funktionen.json` statt fester Werte (eingebettete Apps, eigene Startseite, n8n).
- Installer ersetzt ein laufendes Command Center aus einem anderen Ordner nicht mehr ungefragt (nur mit `--ersetzen`).
- Terminal auch ohne systemd (tmux direkt) und ohne tmux (einfache Shell mit Hinweis); kein `env --chdir` mehr (BusyBox). Getestet: frische Installation per `get.sh` von GitHub, Anmeldung, alle Schnittstellen, Terminal.

**Was drin ist (Entwicklung bis 3.12)**
- **Terminal:** mehrere Tabs je Benutzer, laufen weiter bis zum Schließen (tmux über systemd, überlebt Neustarts); Einstellungen je Tab (Name, Anheften, Position), Ziehen, seitliche Tabs; Nicht-Superadmins ohne Root (`no_new_privs`).
- **Benutzer & Rechte:** 24 Rechte, Gruppen-Vorlagen, Übersicht „Wer darf was?“, Passwort-Reset nur durch den Inhaber, geschützte Dienstkonten.
- **Sicherheit:** Angriffs-Radar (Web-Scans, Logins, IDS) mit automatischer Sperre (`web-scan`, `web-exploit`); Seite „Sicherheit & Sperren“ mit Live-Graphen.
- **Docker:** Live-Messwerte jede Sekunde mit 5-Minuten-Graphen, Messung vorgewärmt (Seite in < 0,5 s gefüllt).
- **Schnellspeicher:** SQLite, optional PostgreSQL mit Streaming-Kopie (`extras/postgres`), Rückfall automatisch.
- **Oberfläche:** Bewegung überall (FLIP), reduzierbar; keine Verzeichnislisten; saubere Fehlerseiten.
