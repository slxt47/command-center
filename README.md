<div align="center">

<img src="static/favicon.svg" width="72" height="72" alt="">

# Command Center

**Deinen Linux-Server im Browser verwalten – Docker, VMs, Terminal, Benutzer und Sicherheit an einem Ort.**

[Produktseite](https://commandcenter.slxt.dev) · [Installation](#installation) · [Dokumentation](docs/) · [Änderungen](CHANGELOG.md)

<sub>🇬🇧 A self-hosted web control panel for Linux servers – **in English or German**: live metrics, Docker, KVM/libvirt VMs,
persistent multi-tab terminal, fine-grained groups & permissions, fail2ban/IDS attack radar.
Install: `curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash -s -- --sprache en` · Interfaz en español: `--sprache es`.
A license key is required: [lizenz.slxt.dev](https://lizenz.slxt.dev).</sub>

</div>

---

## Was es kann

| | |
|---|---|
| **Übersicht** | CPU, RAM, Netzwerk, Datenträger – live und als Verlauf bis 24 Stunden, interaktive Graphen |
| **Docker** | Container, Images, Netze, Volumes, Compose-Stacks; Live-Messwerte jede Sekunde, Logs, Konsole, Dateien |
| **Virtuelle Maschinen** | libvirt/KVM: anlegen, Konsole im Browser (VNC/SPICE), Snapshots, Geräte, Netze, ISOs |
| **Terminal** | Mehrere Tabs, die weiterlaufen, bis du sie schließt – auch über Neustarts. Anheften, verschieben, seitliche Tabs |
| **Benutzer & Rechte** | 24 Rechte, Gruppen-Vorlagen, Übersicht „Wer darf was?“. Nicht-Superadmins bekommen eine Shell ohne `sudo`/`su` |
| **Sicherheit** | fail2ban + Suricata-IDS, gesperrte IPs, Meldungen, **Angriffs-Radar** mit automatischer Sperre von Scannern |
| **Bedienung** | Deutsch, Englisch, Spanisch, Hell/Dunkel, Handy bis Desktop, ⌘K-Suche, Tastenkürzel, eingebaute Hilfe (`?`), Bewegung reduzierbar |

## Installation

Auf dem Server (Debian, Ubuntu, Fedora, RHEL/Alma/Rocky, Arch, openSUSE – x86_64 oder arm64):

```bash
curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
```

Danach im Browser `http://<server>:8420` öffnen und mit einem **Linux-Benutzer des Servers** anmelden.
Der Installer fragt nach **Sprache** (Deutsch/English/Español), **Modulen** (fail2ban, IDS – auch ohne fail2ban –,
Firewall, Angriffs-Radar, Cloudflare, ntfy, PostgreSQL, Backup; einfach an- und abhaken) und dem **Lizenzschlüssel**.
Lizenz anfragen: **[lizenz.slxt.dev](https://lizenz.slxt.dev)**. Alles lässt sich später ändern.

| Variante | Befehl |
|---|---|
| aus dem ganzen lokalen Netz erreichbar (LAN, Tailscale, VPN) | `… \| sudo bash -s -- --lan` |
| nur vom Server selbst (hinter Reverse-Proxy oder Tunnel) | `… \| sudo bash -s -- --nur-lokal` |
| anderer Port | `… \| sudo bash -s -- --port 9000` |
| Sprache gleich festlegen (ohne Rückfrage) | `… \| sudo bash -s -- --sprache en` |
| Lizenz gleich mitgeben | `… \| sudo bash -s -- --lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX` |
| nur bestimmte Module | `… \| sudo bash -s -- --module "ids,backup"` |
| ohne fail2ban/IDS | `… \| sudo bash -s -- --ohne-schutz` |
| weitere Superadmins | `… \| sudo bash -s -- --superadmins root,anna` |

Nach der Installation:

```bash
sudo command-center status          # Version, Container, Adresse
sudo command-center update          # neueste Version (Einstellungen bleiben)
sudo command-center logs -f         # Protokoll
sudo command-center sprache en      # Sprache für neue Besucher (de|en|es)
sudo command-center module +postgres -ids   # Module ändern
sudo command-center lizenz          # Lizenz anzeigen / eintragen
sudo command-center backup          # Sicherung jetzt
sudo command-center deinstallieren  # entfernen (Daten bleiben, außer mit --alles)
```

Ohne `curl | bash`: `git clone https://github.com/slxt47/command-center && cd command-center && sudo ./install.sh`.

> **Sicherheit:** Das Command Center hat Root-Rechte auf dem Server. Stell es nie ungeschützt ins Internet –
> nutze LAN/VPN (Tailscale, WireGuard) oder einen HTTPS-Reverse-Proxy bzw. Cloudflare Tunnel mit Zugangsschutz.
> Mehr in [SECURITY.md](SECURITY.md).

## Voraussetzungen

- Linux mit systemd, x86_64 oder arm64, ~1 GB freier RAM, Docker (wird installiert)
- Optional: libvirt/KVM für VMs, fail2ban + Suricata für das Schutz-Paket (Debian/Ubuntu)

## Dokumentation

| | |
|---|---|
| [Installation & Update](docs/installation.md) | alle Optionen, Reverse-Proxy, Cloudflare Tunnel, Deinstallation |
| [Konfiguration](docs/konfiguration.md) | `dashboard.env`, Zugriff, Ports, Superadmins, Inhaber |
| [Benutzer & Rechte](docs/rechte.md) | Rechte, Gruppen, Inhaber, Terminal ohne Root |
| [Schutz-Paket & Angriffs-Radar](docs/schutz.md) | fail2ban, IDS, automatische Sperren |
| [Lizenz](docs/lizenz.md) | Schlüssel anfragen, eintragen, Ablauf |
| [Optionale Funktionen](docs/funktionen.md) | eingebettete Apps, eigene Startseite, n8n (`funktionen.json`) |
| [Datenbank](docs/datenbank.md) | Schnellspeicher: SQLite, optional PostgreSQL mit Kopie |
| [Entwicklung](docs/entwicklung.md) | Aufbau, Test-Instanz, Beiträge |

Im Command Center selbst: Seite **Hilfe** (mit Bildern und häufigen Fragen) oder Taste <kbd>?</kbd>.

## Lizenz

[Elastic License 2.0](LICENSE) (seit 3.15.1). Kurz gesagt:

- **Erlaubt:** auf eigenen Servern nutzen (privat und in Firmen), den Code lesen, ändern und für dich anpassen.
- **Nicht erlaubt:** das Command Center als gehosteten Dienst an andere anbieten, die Lizenzprüfung entfernen oder
  umgehen, Lizenz- und Urheberhinweise entfernen.
- Für die Installation brauchst du einen Lizenzschlüssel: [lizenz.slxt.dev](https://lizenz.slxt.dev).

Versionen bis einschließlich 3.15.0 sind unter der MIT-Lizenz erschienen und bleiben es.
