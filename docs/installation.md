# Installation & Update

## Schnell

```bash
curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
```

`get.sh` prüft System und Architektur (x86_64/arm64), installiert `curl`, `python3` und `git` bei Bedarf, lädt das
Command Center nach `/opt/command-center` und startet `install.sh --ja` (keine Rückfragen). `install.sh`:

1. installiert Docker, falls es fehlt (Docker-Repository für Debian/Ubuntu/Fedora/RHEL, Paketquellen für Arch/openSUSE),
2. legt `/etc/linux-dashboard/dashboard.env` an (Einstellungen, bleiben bei Updates erhalten),
3. lädt das fertige Image `ghcr.io/slxt47/command-center:<version>` – klappt das nicht, wird lokal gebaut,
4. startet den Container `linux-dashboard` (Host-Netz, Port 8420),
5. installiert auf Debian/Ubuntu das Schutz-Paket (fail2ban, Suricata-IDS, Angriffs-Radar),
6. legt den Befehl `command-center` an.

Anmelden: `http://<server>:8420` mit einem Linux-Benutzer. Superadmin ist standardmäßig `root` und der Benutzer, der
`sudo` ausgeführt hat.

## Optionen

| Option | Wirkung |
|---|---|
| `--lan` | erreichbar aus privaten Netzen (192.168/16, 10/8, 172.16/12, Tailscale 100.64/10, fd00::/8) |
| `--nur-lokal` | nur 127.0.0.1 – für Reverse-Proxy oder Tunnel auf demselben Server |
| `--erlaubte-netze "…"` | eigene Liste (CIDR, Komma); `*` = alle (nur hinter Firewall!) |
| `--port 9000` | anderer Port |
| `--superadmins root,anna` | volle Rechte für diese Konten |
| `--ohne-schutz` / `--nur-schutz` | ohne fail2ban/IDS bzw. nur das Schutz-Paket |
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
sudo command-center deinstallieren    # Container + Programm weg, Daten in /var/lib/linux-dashboard bleiben
sudo command-center deinstallieren --alles
```

## Wo liegt was?

| Pfad | Inhalt |
|---|---|
| `/opt/command-center` | Programm (Git-Klon) |
| `/etc/linux-dashboard/dashboard.env` | Einstellungen |
| `/var/lib/linux-dashboard/` | Daten: Sitzungen, Gruppen, Terminal-Tabs, Angriffs-Radar, Schnellspeicher, Protokolle |
| `/etc/linux-dashboard/schutz.conf` | Schutz-Paket |

Für eine Sicherung reichen `/etc/linux-dashboard` und `/var/lib/linux-dashboard`.
