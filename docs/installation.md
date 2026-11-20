# Installation & Update

## Schnell

```bash
curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
```

`get.sh` prüft System und Architektur (x86_64/arm64), installiert `curl`, `python3` und `git` bei Bedarf, lädt das
Command Center nach `/opt/command-center` und startet `install.sh`. Gefragt wird nur dreierlei (am Terminal, auch bei
`curl … | sudo bash`):

1. **Sprache** – Deutsch, English, Español (`--sprache de|en|es`),
2. **Module** – was installiert wird (Liste zum An-/Abhaken, siehe unten; `--module …`),
3. **Lizenzschlüssel** – anfragen unter [lizenz.slxt.dev](https://lizenz.slxt.dev) (`--lizenz CC-…`, siehe [Lizenz](lizenz.md)).

Danach `install.sh`: Docker (falls nötig), `/etc/linux-dashboard/dashboard.env`, fertiges Image
`ghcr.io/slxt47/command-center:<version>` (sonst lokaler Build), Container `linux-dashboard` (Host-Netz, Port 8420),
die gewählten Module und den Befehl `command-center`.

## Module

| Modul | Standard | Was es tut |
|---|---|---|
| `fail2ban` | an | sperrt nach falschen Logins (SSH, Command Center, Web-Apps) |
| `ids` | an | Suricata erkennt Angriffe im Netzverkehr (~1–2 GB RAM). **Geht auch ohne fail2ban** – dann sperrt der IDS selbst (ipset mit Ablaufzeit `IDS_SPERRZEIT`) |
| `firewall` | an | eigene Sperr-Ketten; ohne: nur ipsets, die deine eigene Firewall einhängt |
| `radar` | an | Angriffs-Radar (Seite „Angriffe“); mit fail2ban auch automatische Sperren |
| `cloudflare` | aus | sperrt zusätzlich am Cloudflare-Rand (braucht fail2ban und einen API-Token) |
| `ntfy` | aus | Push-Meldungen aufs Handy |
| `postgres` | aus | PostgreSQL + Kopie als Schnellspeicher (sonst SQLite) |
| `backup` | an | sichert Einstellungen und Daten jede Nacht nach `/var/backups/command-center` (14 Tage) |

`fail2ban`, `ids`, `firewall`, `radar`, `cloudflare` gibt es nur für Debian/Ubuntu. Ohne Terminal (z. B. Automatisierung)
gelten die Standardwerte bzw.:

```bash
… | sudo bash -s -- --sprache en --lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX --module "ids,backup"
… | sudo bash -s -- --ohne fail2ban --mit postgres
```

Später ändern: `sudo command-center module` (anzeigen), `sudo command-center module +postgres -ids`.
Die Auswahl steht in `/etc/linux-dashboard/module.conf`.

Anmelden: `http://<server>:8420` mit einem Linux-Benutzer. Superadmin ist standardmäßig `root` und der Benutzer, der
`sudo` ausgeführt hat.

## Optionen

| Option | Wirkung |
|---|---|
| `--lan` | erreichbar aus privaten Netzen (192.168/16, 10/8, 172.16/12, Tailscale 100.64/10, fd00::/8) |
| `--nur-lokal` | nur 127.0.0.1 – für Reverse-Proxy oder Tunnel auf demselben Server |
| `--erlaubte-netze "…"` | eigene Liste (CIDR, Komma); `*` = alle (nur hinter Firewall!) |
| `--port 9000` | anderer Port |
| `--sprache en` | Sprache der Oberfläche und des Installers (`de`, `en`, `es`); ohne Angabe fragt der Installer |
| `--lizenz CC-…` | Lizenzschlüssel (ohne Angabe fragt der Installer) |
| `--module "…"`, `--mit …`, `--ohne …` | Module festlegen, dazunehmen, weglassen |
| `--superadmins root,anna` | volle Rechte für diese Konten |
| `--ersetzen` | ein schon laufendes Command Center aus einem anderen Ordner ersetzen (sonst bricht der Installer ab) |
| `--ohne-schutz` / `--nur-schutz` | ohne fail2ban/IDS/Firewall/Radar bzw. nur das Schutz-Paket |
| `--ids-modus melden\|sperren`, `--trusted "IP …"` | Schutz-Paket: nur melden oder sperren; eigene Anschlüsse nie sperren |
| `--ntfy-url … --ntfy-topic …` | Push-Meldungen über ntfy |

Mit `get.sh`: `curl -fsSL …/get.sh | sudo bash -s -- --lan --port 9000`. Lokal gebaut statt Image: `CC_BAUEN=1`.

## Hinter einem Reverse-Proxy oder Cloudflare Tunnel

Mit `--nur-lokal` installieren und den Proxy auf `http://127.0.0.1:8420` zeigen lassen. WebSockets müssen durchgereicht
werden (Terminal, Logs, Konsolen). Beispiel Caddy:

```
cc.example.org {
    reverse_proxy 127.0.0.1:8420
}
```

Bei Cloudflare Tunnel zusätzlich **Cloudflare Access** davor setzen. `DASHBOARD_TRUSTED_PROXIES` bleibt auf
`127.0.0.0/8,::1/128`, damit die echte Besucher-IP (für fail2ban) übernommen wird.

## Update & Entfernen

```bash
sudo command-center update            # neueste Version, Einstellungen und Daten bleiben
sudo command-center sprache en        # Voreinstellung der Sprache ändern (de|en|es)
sudo command-center lizenz            # Lizenz anzeigen; mit CC-… neuen Schlüssel eintragen
sudo command-center backup            # Sicherung jetzt (--liste, --zurueck DATEI)
sudo command-center deinstallieren    # Container + Programm weg, Daten in /var/lib/linux-dashboard bleiben
sudo command-center deinstallieren --alles   # zusätzlich Einstellungen, Daten und Schutz-Paket (ohne Terminal: --ja)
```

## Wo liegt was?

| Pfad | Inhalt |
|---|---|
| `/opt/command-center` | Programm (Git-Klon) |
| `/etc/linux-dashboard/dashboard.env` | Einstellungen |
| `/var/lib/linux-dashboard/` | Daten: Sitzungen, Gruppen, Terminal-Tabs, Angriffs-Radar, Schnellspeicher, Protokolle |
| `/etc/linux-dashboard/schutz.conf` | Schutz-Paket |

Für eine Sicherung reichen `/etc/linux-dashboard` und `/var/lib/linux-dashboard`.
