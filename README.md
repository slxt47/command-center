<div align="center">

<img src="static/favicon.svg" width="72" height="72" alt="">

# Command Center

**Deinen Linux-Server im Browser verwalten – Docker, VMs, Terminal, Benutzer und Sicherheit an einem Ort.**

[Produktseite](https://commandcenter.slxt.dev) · [Installation](#installation) · [Dokumentation](docs/) · [Änderungen](CHANGELOG.md)

<sub>🇬🇧 A self-hosted, German-language web control panel for Linux servers: live metrics, Docker, KVM/libvirt VMs,
persistent multi-tab terminal, fine-grained groups & permissions, fail2ban/IDS attack radar. One-line install below.</sub>

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
| **Bedienung** | Hell/Dunkel, Handy bis Desktop, ⌘K-Suche, Tastenkürzel, eingebaute Hilfe (`?`), Bewegung reduzierbar |

## Installation

Auf dem Server (Debian, Ubuntu, Fedora, RHEL/Alma/Rocky, Arch, openSUSE – x86_64 oder arm64):

```bash
curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
```

Danach im Browser `http://<server>:8420` öffnen und mit einem **Linux-Benutzer des Servers** anmelden.
Der Installer richtet Docker ein (falls nötig), lädt das fertige Image und – auf Debian/Ubuntu – das Schutz-Paket
(fail2ban + IDS). Er fragt nichts; alle Einstellungen lassen sich später ändern.

| Variante | Befehl |
|---|---|
| aus dem ganzen lokalen Netz erreichbar (LAN, Tailscale, VPN) | `… \| sudo bash -s -- --lan` |
| nur vom Server selbst (hinter Reverse-Proxy oder Tunnel) | `… \| sudo bash -s -- --nur-lokal` |
| anderer Port | `… \| sudo bash -s -- --port 9000` |
| ohne fail2ban/IDS | `… \| sudo bash -s -- --ohne-schutz` |
| weitere Superadmins | `… \| sudo bash -s -- --superadmins root,anna` |

Nach der Installation:

```bash
sudo command-center status          # Version, Container, Adresse
sudo command-center update          # neueste Version (Einstellungen bleiben)
sudo command-center logs -f         # Protokoll
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
| [Optionale Funktionen](docs/funktionen.md) | eingebettete Apps, eigene Startseite, n8n (`funktionen.json`) |
| [Datenbank](docs/datenbank.md) | Schnellspeicher: SQLite, optional PostgreSQL mit Kopie |
| [Entwicklung](docs/entwicklung.md) | Aufbau, Test-Instanz, Beiträge |

Im Command Center selbst: Seite **Hilfe** oder Taste <kbd>?</kbd>.

## Lizenz

[MIT](LICENSE) – nutzen, ändern, weitergeben erlaubt.
