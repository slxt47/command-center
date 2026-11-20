#!/usr/bin/env bash
#
# install.sh — Command Center + Schutz-Paket
# Schnellster Weg:  curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
#
# Installiert bzw. aktualisiert (Debian, Ubuntu, Fedora, RHEL/Alma/Rocky, Arch, openSUSE; x86_64 + arm64):
#   1. Docker (falls nötig) und den Dashboard-Container
#   2. das Schutz-Paket: fail2ban + IDS-Wächter (Suricata) + Firewall-Sperrlisten,
#      ohne Cloudflare (Cloudflare nur optional mit --cloudflare)
#
# Nutzung:
#   sudo ./install.sh                 Erstinstallation (fragt das Nötigste ab)
#   sudo ./install.sh --update        Update nach "git pull" (behält alle Einstellungen)
#   sudo ./install.sh --ja            ohne Rückfragen, mit Standardwerten
#   sudo ./install.sh --ohne-schutz   nur das Dashboard
#   sudo ./install.sh --nur-schutz    nur fail2ban/IDS (z. B. auf einem Server ohne Dashboard)
#   sudo ./install.sh --no-start      Dashboard bauen, aber nicht starten
#   sudo ./install.sh --status        installierte Versionen anzeigen
#
# Optionen für das Schutz-Paket werden durchgereicht, z. B.:
#   --trusted "203.0.113.7"  --ohne-ids  --ids-modus melden|sperren
#   --ntfy-url https://ntfy.sh --ntfy-topic mein-server [--ntfy-token tk_...]
#   --cloudflare  --firewall eigen|aus  --uebernehmen  --force
#   (Details: schutz/install-schutz.sh --help)
#
# Optionen für das Dashboard (sonst wird gefragt):
#   --lan                                             aus allen privaten Netzen erreichbar (LAN, Tailscale, VPN)
#   --nur-lokal                                       nur vom Server selbst (z. B. hinter Reverse-Proxy/Tunnel; lauscht dann auf 127.0.0.1)
#   --erlaubte-netze "192.168.0.0/16,100.64.0.0/10"   wer direkt zugreifen darf ("*" = alle)
#   --superadmins "root,david"                        volle Rechte im Dashboard
#   --port 8420
#   --sprache de|en|es                                Sprache der Oberfläche und des Installers (language)
#
# Module (Erstinstallation: Auswahlliste; sonst Standard = alle außer Cloudflare, ntfy, PostgreSQL):
#   fail2ban  ids  firewall  radar  cloudflare  ntfy  postgres  backup
#   --module "ids,backup"      genau diese Module      --mit postgres / --ohne fail2ban   dazu/weg
#   --menue                    Auswahlliste zeigen (get.sh macht das automatisch)
#
#   Später ändern: sudo command-center module +postgres -ids
#
# Lizenz: Beim Installieren und bei Updates wird ein Lizenzschlüssel geprüft (anfragen: https://lizenz.slxt.dev).
#   --lizenz CC-XXXXX-XXXXX-XXXXX-XXXXX   (sonst fragt der Installer)
#
# Einstellungen danach: /etc/linux-dashboard/dashboard.env (Dashboard) und
# /etc/linux-dashboard/schutz.conf (Schutz). Updates ändern dort keine Werte.
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO=$(pwd)
VERSION=$(cat VERSION)
ETC=/etc/linux-dashboard
ENVF=$ETC/dashboard.env
VERFILE=$ETC/version
DATA_DIR=/var/lib/linux-dashboard

MODE=install; START=1; SCHUTZ=1; DASH=1; JA=0
OPT_NETZE=""; OPT_SUPER=""; OPT_PORT=""; SPRACHE="${CC_SPRACHE:-}"; SPRACHE_GESETZT=""
OPT_MODULE=""; OPT_MIT=""; OPT_OHNE=""; MENUE=0; NTFY_GESETZT=0; OPT_LIZENZ="${CC_LIZENZ:-}"
SCHUTZ_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --update)         MODE=update ;;
    --no-start)       START=0 ;;
    --ohne-schutz)    OPT_OHNE="$OPT_OHNE fail2ban ids firewall radar cloudflare" ;;
    --module|--modules) OPT_MODULE=$2; shift ;;
    --mit|--with)     OPT_MIT="$OPT_MIT $2"; shift ;;
    --ohne|--without) OPT_OHNE="$OPT_OHNE $2"; shift ;;
    --menue|--menu)   MENUE=1 ;;
    --lizenz|--license|--licencia) OPT_LIZENZ=$2; shift ;;
    --nur-schutz)     DASH=0 ;;
    --ja|-y)          JA=1; SCHUTZ_ARGS+=(--ja) ;;
    --status)         MODE=status ;;
    --erlaubte-netze) OPT_NETZE=$2; shift ;;
    --superadmins)    OPT_SUPER=$2; shift ;;
    --port)           OPT_PORT=$2; shift ;;
    --sprache|--language) SPRACHE=$2; SPRACHE_GESETZT=1; shift ;;
    --ersetzen)       ERSETZEN=1 ;;
    --lan)            OPT_NETZE="192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,100.64.0.0/10,fd00::/8" ;;
    --nur-lokal)      OPT_NETZE="127.0.0.1/32" ;;
    --trusted|--ids-modus|--ntfy-topic|--ntfy-token)
                      SCHUTZ_ARGS+=("$1" "$2"); shift ;;
    --ntfy-url)       SCHUTZ_ARGS+=("$1" "$2"); OPT_MIT="$OPT_MIT ntfy"; NTFY_GESETZT=1; shift ;;
    --firewall)       if [ "$2" = aus ]; then OPT_OHNE="$OPT_OHNE firewall"; else OPT_MIT="$OPT_MIT firewall"; fi; shift ;;
    --ohne-ids)       OPT_OHNE="$OPT_OHNE ids" ;;
    --cloudflare)     OPT_MIT="$OPT_MIT cloudflare" ;;
    --uebernehmen|--force)
                      SCHUTZ_ARGS+=("$1") ;;
    -h|--help)        sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option / unknown option: $1 (--help)" >&2; exit 1 ;;
  esac
  shift
done

# Sprache (de/en/es): --sprache, sonst aus dashboard.env, sonst fragen (interaktiv) bzw. Deutsch
[ -n "$SPRACHE" ] && SPRACHE_GESETZT=1
[ -z "$SPRACHE" ] && SPRACHE=$(sed -n 's/^CC_SPRACHE=//p' "$ENVF" 2>/dev/null | head -1 || true)
if [ -z "$SPRACHE" ] && [ $JA -eq 0 ] && [ -t 0 ] && [ "$MODE" = install ]; then
  printf 'Sprache / Language / Idioma:  1) Deutsch  2) English  3) Español  [1]: '; read -r _s </dev/tty || true
  case "$_s" in 2|en|EN|e) SPRACHE=en ;; 3|es|ES) SPRACHE=es ;; *) SPRACHE=de ;; esac
fi
case "$SPRACHE" in en|es) ;; *) SPRACHE=de ;; esac
t() { case "$SPRACHE" in en) printf '%s' "$2" ;; es) printf '%s' "${3:-$2}" ;; *) printf '%s' "$1" ;; esac; }   # t deutsch english [español]

log()  { printf '\033[1;32m[+]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }
frage() {
  local a=""
  if [ $JA -eq 0 ] && [ -t 0 ]; then read -r -p "$1 [$2]: " a </dev/tty || true; fi
  printf '%s' "${a:-$2}"
}
ver_lt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }
env_setze() {   # env_setze KEY wert  (dashboard.env: KEY=wert ohne Anführungszeichen)
  local v=${2//\\/\\\\}; v=${v//&/\\&}; v=${v//|/\\|}
  if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$v|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi
}

if [ "$MODE" = status ]; then
  echo "Repository:        $VERSION"
  echo "Dashboard:         $(cat "$VERFILE" 2>/dev/null || t 'nicht installiert / vor 2.0' 'not installed / before 2.0' 'no instalado / anterior a 2.0')"
  echo "$(t 'Schutz-Paket:     ' 'Protection:       ' 'Protección:       ') $(cat "$ETC/schutz-version" 2>/dev/null || t 'nicht installiert' 'not installed' 'no instalado')"
  echo "$(t 'Sprache:          ' 'Language:         ' 'Idioma:           ') $SPRACHE"
  echo "$(t 'Lizenz:           ' 'License:          ' 'Licencia:         ') $(CC_SPRACHE=$SPRACHE python3 dashboard/lizenz.py 2>/dev/null | head -1 || true)"
  command -v docker >/dev/null && docker ps --filter name=^linux-dashboard$ --format 'Container:         {{.Status}}'
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { err "$(t 'Bitte als root ausführen (sudo ./install.sh).' 'Please run as root (sudo ./install.sh).' 'Ejecútalo como root (sudo ./install.sh).')"; exit 1; }

# ─── Module ─────────────────────────────────────────────────────────────────
ALLE_MODULE="fail2ban ids firewall radar cloudflare ntfy postgres backup"
SCHUTZ_MODULE="fail2ban ids firewall radar cloudflare"
MODF=$ETC/module.conf
APT=0; command -v apt-get >/dev/null 2>&1 && APT=1
hat() { case " $MODULE " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
modul_text() {
  case "$1" in
    fail2ban)   t 'sperrt nach falschen Logins (SSH, Command Center, Web-Apps)' 'bans after failed logins (SSH, Command Center, web apps)' 'bloquea tras inicios de sesión fallidos (SSH, Command Center, apps web)' ;;
    ids)        t 'Suricata erkennt Angriffe im Netzverkehr (~1–2 GB RAM)' 'Suricata detects attacks in network traffic (~1–2 GB RAM)' 'Suricata detecta ataques en el tráfico de red (~1–2 GB de RAM)' ;;
    firewall)   t 'eigene Sperr-Ketten (sonst nur ipsets für deine Firewall)' 'own blocking chains (otherwise only ipsets for your firewall)' 'cadenas de bloqueo propias (si no, solo ipsets para tu firewall)' ;;
    radar)      t 'Angriffs-Radar: Web-Scans & Exploits sammeln (Seite „Angriffe“)' 'attack radar: collects web scans & exploits (page “Attacks”)' 'radar de ataques: recopila escaneos web y exploits (página «Ataques»)' ;;
    cloudflare) t 'sperrt zusätzlich am Cloudflare-Rand (API-Token nötig)' 'also bans at the Cloudflare edge (API token needed)' 'bloquea también en el borde de Cloudflare (requiere token API)' ;;
    ntfy)       t 'Push-Meldungen aufs Handy (ntfy)' 'push notifications to your phone (ntfy)' 'notificaciones push al móvil (ntfy)' ;;
    postgres)   t 'PostgreSQL + Kopie für den Schnellspeicher (sonst SQLite)' 'PostgreSQL + replica for the fast cache (otherwise SQLite)' 'PostgreSQL + réplica para la caché rápida (si no, SQLite)' ;;
    backup)     t 'sichert Einstellungen und Daten jede Nacht (14 Tage)' 'backs up settings and data every night (14 days)' 'copia de seguridad nocturna de ajustes y datos (14 días)' ;;
  esac
}
NEU_MODULE=0
if [ -n "$OPT_MODULE" ]; then MODULE=${OPT_MODULE//,/ }
elif [ -f "$MODF" ]; then MODULE=$(sed -n 's/^MODULE="\(.*\)"/\1/p' "$MODF")
elif [ -f "$ETC/schutz-version" ] || [ -f "$VERFILE" ]; then
  # Installation von vor den Modulen: das Installierte beibehalten
  SC=$ETC/schutz.conf; sw() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}/\1/p" "$SC" 2>/dev/null | head -1 || true; }
  MODULE=""
  if [ -f "$ETC/schutz-version" ]; then
    [ "$(sw F2B_AKTIV)" != 0 ] && MODULE="$MODULE fail2ban"
    [ "$(sw IDS_AKTIV)" != 0 ] && MODULE="$MODULE ids"
    [ "$(sw FIREWALL)" != aus ] && MODULE="$MODULE firewall"
    [ "$(sw RADAR_AKTIV)" != 0 ] && MODULE="$MODULE radar"
    [ "$(sw CLOUDFLARE)" = 1 ] && MODULE="$MODULE cloudflare"
    [ -n "$(sw NTFY_URL)" ] && MODULE="$MODULE ntfy"
  fi
  [ -f "$DATA_DIR/pg.env" ] && MODULE="$MODULE postgres"
  systemctl is-enabled command-center-backup.timer >/dev/null 2>&1 && MODULE="$MODULE backup"
else
  NEU_MODULE=1
  if [ $APT -eq 1 ]; then MODULE="fail2ban ids firewall radar backup"; else MODULE="backup"; fi
fi
MODULE=" ${MODULE//,/ } ${OPT_MIT//,/ } "
for m in ${OPT_OHNE//,/ }; do MODULE=${MODULE// $m / }; done
# Auswahlliste (Erstinstallation am Terminal, auch bei curl | bash über /dev/tty)
if [ $NEU_MODULE -eq 1 ] && [ -z "$OPT_MODULE" ] && [ "$MODE" = install ] && [ $DASH -eq 1 ] \
   && { [ $MENUE -eq 1 ] || { [ $JA -eq 0 ] && [ -t 0 ]; }; } && { : </dev/tty; } 2>/dev/null; then
  while :; do
    {
      echo; echo "$(t 'Was soll installiert werden?  Nummer = an/aus, Enter = weiter' 'What should be installed?  number = on/off, Enter = continue' '¿Qué se debe instalar?  número = activar/desactivar, Enter = seguir')"
      i=0
      for m in $ALLE_MODULE; do
        i=$((i+1)); x=' '; case " $MODULE " in *" $m "*) x=x ;; esac
        nur=""; case " $SCHUTZ_MODULE " in *" $m "*) [ $APT -eq 0 ] && nur="  ($(t 'nur Debian/Ubuntu' 'Debian/Ubuntu only' 'solo Debian/Ubuntu'))" ;; esac
        printf '  [%s] %d  %-10s %s%s\n' "$x" "$i" "$m" "$(modul_text "$m")" "$nur"
      done
      printf '%s ' "$(t 'Auswahl:' 'Choice:' 'Selección:')"
    } >/dev/tty
    read -r a </dev/tty || a=""
    [ -z "$a" ] && break
    for n in ${a//,/ }; do
      m=$(echo $ALLE_MODULE | cut -d' ' -f"$n" 2>/dev/null || true); [ -n "$m" ] || continue
      case " $MODULE " in *" $m "*) MODULE=${MODULE// $m / } ;; *) MODULE="$MODULE $m " ;; esac
    done
  done
fi
if [ $APT -eq 0 ]; then
  for m in $SCHUTZ_MODULE; do
    hat "$m" && warn "$(t "Modul $m gibt es nur für Debian/Ubuntu – ausgelassen." "Module $m is only available for Debian/Ubuntu – skipped." "El módulo $m solo existe para Debian/Ubuntu – omitido.")"
    MODULE=${MODULE// $m / }
  done
fi
# Reihenfolge wie ALLE_MODULE, ohne Doppelte
_m=""; for m in $ALLE_MODULE; do hat "$m" && _m="$_m $m"; done; MODULE="${_m# }"
log "$(t 'Module' 'Modules' 'Módulos'): ${MODULE:-–}"
# ntfy: Server und Thema erfragen, wenn gewählt und nicht angegeben
if hat ntfy && [ $NTFY_GESETZT -eq 0 ] && [ $NEU_MODULE -eq 1 ] && { : </dev/tty; } 2>/dev/null; then
  printf '%s ' "$(t 'ntfy-Server (z. B. https://ntfy.sh):' 'ntfy server (e.g. https://ntfy.sh):' 'Servidor ntfy (p. ej. https://ntfy.sh):')" >/dev/tty; read -r nu </dev/tty || nu=""
  if [ -n "$nu" ]; then
    printf '%s ' "$(t 'ntfy-Thema:' 'ntfy topic:' 'Tema ntfy:') [server-$(hostname -s 2>/dev/null || echo cc)]" >/dev/tty; read -r nt </dev/tty || nt=""
    SCHUTZ_ARGS+=(--ntfy-url "$nu" --ntfy-topic "${nt:-server-$(hostname -s 2>/dev/null || echo cc)}")
  fi
fi
# Schutz-Paket nur, wenn eines seiner Module gewählt ist
SCHUTZ=0; for m in $SCHUTZ_MODULE; do hat "$m" && SCHUTZ=1; done
if [ $SCHUTZ -eq 1 ]; then
  if hat fail2ban; then SCHUTZ_ARGS+=(--mit-fail2ban); else SCHUTZ_ARGS+=(--ohne-fail2ban); fi
  if hat ids; then SCHUTZ_ARGS+=(--mit-ids); else SCHUTZ_ARGS+=(--ohne-ids); fi
  if hat radar; then SCHUTZ_ARGS+=(--mit-radar); else SCHUTZ_ARGS+=(--ohne-radar); fi
  if hat firewall; then SCHUTZ_ARGS+=(--firewall eigen); else SCHUTZ_ARGS+=(--firewall aus); fi
  if hat cloudflare; then SCHUTZ_ARGS+=(--cloudflare); else SCHUTZ_ARGS+=(--ohne-cloudflare); fi
fi

# ─── Versionen ──────────────────────────────────────────────────────────────
# Läuft schon ein Command Center aus einem ANDEREN Ordner (z. B. eigene Entwicklungs-Installation)? Dann nicht
# ungefragt ersetzen – nur mit --ersetzen.
if [ $DASH -eq 1 ] && [ "$MODE" != status ] && command -v docker >/dev/null 2>&1 && docker inspect linux-dashboard >/dev/null 2>&1; then
  ANDERER=$(docker inspect linux-dashboard --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
  if [ -n "$ANDERER" ] && [ "$ANDERER" != "$REPO" ] && [ "${ERSETZEN:-0}" != 1 ]; then
    err "$(t "Auf diesem Server läuft bereits ein Command Center aus $ANDERER." "A Command Center from $ANDERER is already running on this server." "En este servidor ya funciona un Command Center desde $ANDERER.")"
    err "$(t 'Es wird NICHT ersetzt. Update dort ausführen – oder bewusst ersetzen mit:' 'It is NOT replaced. Update it there – or replace it deliberately with:' 'NO se reemplaza. Actualízalo allí, o reemplázalo a propósito con:')  … | sudo bash -s -- --ersetzen"
    exit 1
  fi
fi

INSTALLIERT=$(cat "$VERFILE" 2>/dev/null || true)
ALT_DASH=0
# (ein Ordner nur mit lizenz.json stammt von einem abgebrochenen Versuch, nicht von einer alten Installation)
if [ -z "$INSTALLIERT" ] && { [ -n "$(ls -A "$DATA_DIR" 2>/dev/null | grep -v '^lizenz\.json$' || true)" ] || docker inspect linux-dashboard >/dev/null 2>&1; }; then
  ALT_DASH=1     # Dashboard läuft schon, aber aus einer Version vor 2.0 (ohne Versionsdatei)
fi
if [ $DASH -eq 1 ]; then
  if [ -n "$INSTALLIERT" ] && ver_lt "$VERSION" "$INSTALLIERT" && [[ " ${SCHUTZ_ARGS[*]} " != *" --force "* ]]; then
    err "$(t "Installiert ist Dashboard $INSTALLIERT, dieses Repository ist älter ($VERSION). Erst 'git pull'." "Installed is $INSTALLIERT, this repository is older ($VERSION). Run 'git pull' first." "Está instalada la $INSTALLIERT y este repositorio es más antiguo ($VERSION). Ejecuta primero 'git pull'.")"
    exit 1
  elif [ -n "$INSTALLIERT" ]; then log "Dashboard: Update $INSTALLIERT -> $VERSION"
  elif [ $ALT_DASH -eq 1 ]; then log "$(t 'Dashboard: Update einer Version vor 2.0' 'Dashboard: update of a version before 2.0' 'Panel: actualización de una versión anterior a 2.0') -> $VERSION"
  else log "$(t 'Dashboard: Erstinstallation' 'Dashboard: first installation' 'Panel: primera instalación') $VERSION"; fi
fi

# ─── Lizenz ─────────────────────────────────────────────────────────────────
if [ $DASH -eq 1 ]; then
  if ! command -v python3 >/dev/null 2>&1; then   # z. B. install.sh direkt aus einem Git-Klon auf einem Minimal-System
    if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 >/dev/null
    elif command -v dnf >/dev/null; then dnf install -y -q python3 >/dev/null
    elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed python >/dev/null
    elif command -v zypper >/dev/null; then zypper --non-interactive install python3 >/dev/null; fi || true
  fi
  command -v python3 >/dev/null 2>&1 || { err "$(t 'python3 wird benötigt.' 'python3 is required.' 'Se necesita python3.')"; exit 1; }
  mkdir -p "$DATA_DIR"
  rc=0; CC_SPRACHE=$SPRACHE CC_LIZENZ_DATEI=$DATA_DIR/lizenz.json python3 dashboard/lizenz.py --installer "$OPT_LIZENZ" || rc=$?
  if [ $rc -ne 0 ]; then
    err "$(t 'Ohne gültige Lizenz wird nicht installiert bzw. aktualisiert.' 'Without a valid license nothing is installed or updated.' 'Sin una licencia válida no se instala ni se actualiza.')"
    err "$(t 'Lizenz anfragen' 'Request a license' 'Solicitar una licencia'): https://lizenz.slxt.dev"
    exit 1
  fi
fi

# ─── Paketmanager / Docker ──────────────────────────────────────────────────
detect_pm() {
  if   command -v apt-get >/dev/null 2>&1; then echo apt
  elif command -v dnf     >/dev/null 2>&1; then echo dnf
  elif command -v yum     >/dev/null 2>&1; then echo yum
  elif command -v pacman  >/dev/null 2>&1; then echo pacman
  elif command -v zypper  >/dev/null 2>&1; then echo zypper
  else echo unknown; fi
}
PM="$(detect_pm)"

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "$(t 'Docker vorhanden' 'Docker present' 'Docker presente'): $(docker --version)"
    return
  fi
  log "$(t 'Docker nicht gefunden — installiere Docker Engine...' 'Docker not found — installing Docker Engine...' 'Docker no encontrado — instalando Docker Engine...')"
  case "$PM" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y ca-certificates curl gnupg
      install -m 0755 -d /etc/apt/keyrings
      if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
        local ID VERSION_CODENAME
        ID=$(. /etc/os-release; echo "$ID"); VERSION_CODENAME=$(. /etc/os-release; echo "$VERSION_CODENAME")
        curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
          | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
          > /etc/apt/sources.list.d/docker.list
      fi
      apt-get update -y
      apt-get install -y docker-ce docker-ce-cli containerd.io \
              docker-buildx-plugin docker-compose-plugin \
        || { warn "$(t 'Docker-CE-Repo fehlgeschlagen — nutze Distro-Pakete (docker.io).' 'Docker CE repo failed — using distro packages (docker.io).' 'Falló el repositorio de Docker CE — se usan los paquetes de la distribución (docker.io).')"; \
             apt-get install -y docker.io docker-compose-v2 || apt-get install -y docker.io; }
      ;;
    dnf|yum)
      $PM install -y dnf-plugins-core || true
      $PM config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null \
        || $PM config-manager addrepo --from-repofile=https://download.docker.com/linux/centos/docker-ce.repo 2>/dev/null || true
      $PM install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
        || $PM install -y docker docker-compose
      ;;
    pacman) pacman -Sy --noconfirm docker docker-compose ;;
    zypper) zypper --non-interactive install docker docker-compose ;;
    *) err "$(t 'Unbekannter Paketmanager. Docker bitte manuell installieren:' 'Unknown package manager. Please install Docker manually:' 'Gestor de paquetes desconocido. Instala Docker a mano:') https://docs.docker.com/engine/install/"; exit 1 ;;
  esac
  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
  log "$(t 'Docker installiert' 'Docker installed' 'Docker instalado'): $(docker --version)"
}

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"
  else err "$(t "Weder 'docker compose' noch 'docker-compose' verfügbar." "Neither 'docker compose' nor 'docker-compose' available." "No hay ni 'docker compose' ni 'docker-compose'.")"; exit 1; fi
}

# ─── Lauschadresse (.env neben docker-compose.yml) ───────────────────────────
dotenv_setze() {   # dotenv_setze KEY wert  (.env für docker compose)
  touch .env
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
# Nur lokal, wenn niemand außer dem Server selbst zugreifen darf; sonst auf allen Interfaces lauschen
# (wer zugreifen darf, prüft das Dashboard selbst über DASHBOARD_ALLOWED_NETS). Ein vorhandener Wert bleibt.
lauschadresse() {
  grep -q '^DASH_HOST=' .env 2>/dev/null && return 0
  local n; n=$(sed -n 's/^DASHBOARD_ALLOWED_NETS=//p' "$ENVF" 2>/dev/null | head -1 || true)
  case "$n" in ''|127.0.0.1|127.0.0.1/32|::1|::1/128) dotenv_setze DASH_HOST 127.0.0.1 ;; *) dotenv_setze DASH_HOST 0.0.0.0 ;; esac
}

# ─── Dashboard-Einstellungen (dashboard.env) ────────────────────────────────
dashboard_env() {
  mkdir -p "$ETC"; chmod 755 "$ETC"
  if [ -f "$ENVF" ]; then
    python3 schutz/lib/schutz.py conf-merge config/dashboard.env.example "$ENVF"
    if [ -n "$SPRACHE_GESETZT" ]; then env_setze CC_SPRACHE "$SPRACHE"; fi
    return 0
  fi
  install -m 600 config/dashboard.env.example "$ENVF"
  if [ $ALT_DASH -eq 1 ]; then
    # Vor 2.0 standen die Einstellungen in docker-compose.yml bzw. im Code.
    # Werte aus dem laufenden Container übernehmen und das alte Verhalten beibehalten.
    log "$(t 'Übernehme Einstellungen der bisherigen Installation:' 'Taking over settings of the previous installation:' 'Se toman los ajustes de la instalación anterior:')"
    local envs; envs=$(docker inspect linux-dashboard --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)
    local k v
    for k in DASHBOARD_ALLOWED_NETS DASH_PORT DASH_SUPERADMINS DASH_ADMIN_GROUP DASHBOARD_TOKEN \
             DASH_HOST_PUBLIC_IPS DASHBOARD_AUTH_LOG; do
      v=$(printf '%s\n' "$envs" | sed -n "s/^$k=//p" | head -1)
      [ -n "$v" ] && { env_setze "$k" "$v"; echo "    $k=$v"; }
    done
    # Bisher galten Proxy-Header von allen privaten Adressen (Tunnel im Docker-Netz)
    # und die Superadmins standen im Code.
    env_setze DASHBOARD_TRUSTED_PROXIES ""
    printf '%s\n' "$envs" | grep -q '^DASH_SUPERADMINS=' || env_setze DASH_SUPERADMINS "root"
    return
  fi
  # Erstinstallation: das Nötigste fragen
  local netze super port
  echo
  t "Zugriff: Das Dashboard hat Root-Rechte am Host. Ohne Tunnel/Reverse-Proxy nur aus
vertrauenswürdigen Netzen freigeben (LAN, Tailscale). localhost geht immer." "Access: the dashboard has root rights on the host. Without a tunnel/reverse proxy only allow
trusted networks (LAN, Tailscale). localhost always works." "Acceso: el panel tiene derechos de root en el host. Sin túnel/proxy inverso, permite solo
redes de confianza (LAN, Tailscale). localhost siempre funciona."; echo
  netze=${OPT_NETZE:-$(frage "$(t 'Erlaubte Netze (Komma, CIDR; * = alle)' 'Allowed networks (comma, CIDR; * = all)' 'Redes permitidas (comas, CIDR; * = todas)')" "192.168.0.0/16,10.0.0.0/8,100.64.0.0/10,fd7a:115c:a1e0::/48")}
  super=${OPT_SUPER:-$(frage "$(t 'Superadmins (Komma-getrennt)' 'Superadmins (comma-separated)' 'Superadministradores (separados por comas)')" "root${SUDO_USER:+,$SUDO_USER}")}
  port=${OPT_PORT:-$(frage "Port" "8420")}
  env_setze DASHBOARD_ALLOWED_NETS "$netze"
  env_setze DASH_SUPERADMINS "$super"
  env_setze DASH_PORT "$port"
  env_setze CC_SPRACHE "$SPRACHE"
  if [ "$netze" = "*" ]; then
    warn "$(t 'DASHBOARD_ALLOWED_NETS=* — das Dashboard ist von überall erreichbar. Dringend eine Firewall' 'DASHBOARD_ALLOWED_NETS=* — the dashboard is reachable from everywhere. Urgently put a firewall' 'DASHBOARD_ALLOWED_NETS=* — el panel es accesible desde cualquier lugar. Pon urgentemente un firewall')"
    warn "$(t 'davor setzen oder HTTPS-Reverse-Proxy/Tailscale nutzen.' 'in front or use an HTTPS reverse proxy/Tailscale.' 'delante o usa un proxy inverso HTTPS/Tailscale.')"
  fi
}

# ─── Dashboard ──────────────────────────────────────────────────────────────
if [ $DASH -eq 1 ]; then
  install_docker
  if ! docker info >/dev/null 2>&1; then
    log "$(t 'Starte Docker-Daemon...' 'Starting the Docker daemon...' 'Iniciando el demonio de Docker...')"
    systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
    sleep 2
    docker info >/dev/null 2>&1 || { err "$(t 'Docker-Daemon nicht erreichbar.' 'Docker daemon not reachable.' 'El demonio de Docker no es accesible.')"; exit 1; }
  fi
  command -v python3 >/dev/null || { [ "$PM" = apt ] && apt-get install -y -qq python3 >/dev/null; }
  # tmux: Terminal-Tabs laufen weiter, auch wenn die Seite zu ist (fehlt es, gibt es nur einfache Shells)
  if ! command -v tmux >/dev/null 2>&1; then
    case "$PM" in
      apt) DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux >/dev/null 2>&1 ;;
      dnf|yum) $PM install -y -q tmux >/dev/null 2>&1 ;;
      pacman) pacman -S --noconfirm --needed tmux >/dev/null 2>&1 ;;
      zypper) zypper --non-interactive install tmux >/dev/null 2>&1 ;;
    esac || warn "$(t 'tmux nicht installierbar – Terminal-Tabs laufen dann nur, solange sie offen sind.' 'Could not install tmux – terminal tabs then only run while they are open.' 'No se pudo instalar tmux: las pestañas del terminal solo funcionan mientras están abiertas.')"
  fi

  dashboard_env
  mkdir -p "$DATA_DIR"
  touch "$DATA_DIR/auth.log"
  # KasmVNC-Konfiguration für Browser-Sessions. Ein Verzeichnis an dieser Stelle hat
  # Docker angelegt, als die Datei fehlte (Browser-Start scheiterte dann mit HTTP 400).
  [ -d "$DATA_DIR/kasmvnc.yaml" ] && rmdir "$DATA_DIR/kasmvnc.yaml" 2>/dev/null || true
  [ -f "$DATA_DIR/kasmvnc.yaml" ] || install -m 644 config/kasmvnc.yaml "$DATA_DIR/kasmvnc.yaml"

  # Fertiges Image aus GitHub (amd64/arm64) – spart das Bauen. Klappt das nicht: lokal bauen.
  IMG="ghcr.io/slxt47/command-center:$VERSION"
  if grep -q '^CC_IMAGE=' .env 2>/dev/null || [ ! -f .env ]; then dotenv_setze CC_IMAGE "$IMG"; fi
  lauschadresse
  if [ "${CC_BAUEN:-0}" != 1 ] && compose pull -q 2>/dev/null; then
    log "$(t 'Fertiges Image geladen' 'Ready-made image pulled' 'Imagen lista descargada'): $IMG"
  else
    log "$(t 'Baue Image lokal (beim ersten Mal einige Minuten)...' 'Building the image locally (a few minutes the first time)...' 'Construyendo la imagen en local (unos minutos la primera vez)...')"
    compose build
  fi
  if [ "$START" -eq 1 ]; then
    log "$(t 'Starte Container...' 'Starting the container...' 'Iniciando el contenedor...')"
    # Alter Container (z. B. aus einem anderen Verzeichnis gestartet) wird ersetzt;
    # Daten liegen in $DATA_DIR und bleiben erhalten.
    if docker inspect linux-dashboard >/dev/null 2>&1 && \
       [ "$(docker inspect linux-dashboard --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')" != "$REPO" ]; then
      warn "$(t 'Ersetze bestehenden Container linux-dashboard (anderes Verzeichnis, --ersetzen).' 'Replacing the existing container linux-dashboard (other directory, --ersetzen).' 'Se reemplaza el contenedor linux-dashboard existente (otro directorio, --ersetzen).')"
      docker rm -f linux-dashboard >/dev/null
    fi
    # Code ist per Volume eingebunden: Neustart erzwingen, sonst laeuft der alte Code weiter.
    compose up -d --force-recreate --remove-orphans
  fi
  echo "$VERSION" > "$VERFILE"
  # Befehl „command-center“ für Status, Update, Logs, Deinstallation
  install -m 755 scripts/command-center /usr/local/bin/command-center 2>/dev/null || true
  sed -i "s|^REPO=.*|REPO=$REPO|" /usr/local/bin/command-center 2>/dev/null || true
fi

# ─── Module: PostgreSQL, Backup ─────────────────────────────────────────────
if [ $DASH -eq 1 ]; then
  WAR_PG=0; case " $(sed -n 's/^MODULE="\(.*\)"/\1/p' "$MODF" 2>/dev/null || true) " in *" postgres "*) WAR_PG=1 ;; esac
  if hat postgres; then
    log "$(t 'PostgreSQL (Datenbank + Kopie) ...' 'PostgreSQL (database + replica) ...' 'PostgreSQL (base de datos + réplica) ...')"
    if bash extras/postgres/einrichten.sh >/dev/null; then
      [ "$START" -eq 1 ] && compose restart >/dev/null 2>&1 || true
    else warn "$(t 'PostgreSQL ließ sich nicht einrichten – das Command Center nutzt SQLite.' 'PostgreSQL could not be set up – the Command Center uses SQLite.' 'No se pudo configurar PostgreSQL: el Command Center usa SQLite.')"; fi
  elif [ $WAR_PG -eq 1 ] || [ -n "$(docker ps -q -f name=^cc_db$ 2>/dev/null)" ]; then
    ( cd extras/postgres && compose stop ) >/dev/null 2>&1 || true
    [ -f "$DATA_DIR/pg.env" ] && mv "$DATA_DIR/pg.env" "$DATA_DIR/pg.env.aus"
    [ "$START" -eq 1 ] && compose restart >/dev/null 2>&1 || true
    log "$(t 'PostgreSQL gestoppt (Daten bleiben in extras/postgres/daten).' 'PostgreSQL stopped (data stays in extras/postgres/daten).' 'PostgreSQL detenido (los datos quedan en extras/postgres/daten).')"
  fi
  if hat backup; then
    install -m 755 scripts/command-center-backup /usr/local/sbin/command-center-backup
    install -m 644 scripts/systemd/command-center-backup.service scripts/systemd/command-center-backup.timer /etc/systemd/system/
    systemctl daemon-reload; systemctl enable --now command-center-backup.timer >/dev/null 2>&1 || true
    log "$(t 'Backup: jede Nacht nach /var/backups/command-center' 'Backup: every night to /var/backups/command-center' 'Copia de seguridad: cada noche en /var/backups/command-center')"
  elif systemctl is-enabled command-center-backup.timer >/dev/null 2>&1; then
    systemctl disable --now command-center-backup.timer >/dev/null 2>&1 || true
  fi
fi

# Gewählte Module merken (Updates und „command-center module“ gehen davon aus)
if [ $DASH -eq 1 ]; then mkdir -p "$ETC"; printf '# Module des Command Centers (command-center module)\nMODULE="%s"\n' "$MODULE" > "$MODF"; fi

# ─── Schutz-Paket ───────────────────────────────────────────────────────────
if [ $SCHUTZ -eq 0 ] && [ -f "$ETC/schutz-version" ] && [ -n "$OPT_MODULE$OPT_OHNE" ]; then
  log "$(t 'Schutz-Paket wird entfernt (kein Schutz-Modul gewählt) ...' 'Removing the protection package (no protection module chosen) ...' 'Eliminando el paquete de protección (ningún módulo elegido) ...')"
  CC_SPRACHE=$SPRACHE bash schutz/install-schutz.sh --deinstallieren
fi
if [ $SCHUTZ -eq 1 ]; then
  echo
  log "$(t 'Schutz-Paket' 'Protection package' 'Paquete de protección') (${MODULE:-–}) …"
  if [ $DASH -eq 0 ] && ! docker inspect linux-dashboard >/dev/null 2>&1; then
    SCHUTZ_ARGS+=(--ohne-dashboard-jail)
  fi
  CC_SPRACHE=$SPRACHE bash schutz/install-schutz.sh "${SCHUTZ_ARGS[@]}"
fi

# ─── Zusammenfassung ────────────────────────────────────────────────────────
if [ $DASH -eq 1 ] && [ "$START" -eq 1 ]; then
  PORT=$(sed -n 's/^DASH_PORT=//p' "$ENVF"); PORT=${PORT:-8420}
  # eigene IP – „hostname -I“ gibt es nicht überall (Alpine/BusyBox, Arch): Fehler dürfen den Installer nicht beenden
  IP="$( { hostname -I 2>/dev/null || ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'; } | awk 'NR==1{print $1}' || true)"
  echo
  log "$(t 'Fertig!' 'Done!' '¡Listo!')  Linux Command Center $VERSION"
  echo "        →  http://localhost:${PORT}"
  if grep -q '^DASH_HOST=127.0.0.1' .env 2>/dev/null; then
    echo "        ($(t 'nur vom Server selbst erreichbar – für Zugriff von außen: Tunnel/Reverse-Proxy oder --erlaubte-netze' 'only reachable from the server itself – for outside access: tunnel/reverse proxy or --erlaubte-netze' 'solo accesible desde el propio servidor; para acceso externo: túnel/proxy inverso o --erlaubte-netze'))"
  elif [ -n "${IP:-}" ]; then echo "        →  http://${IP}:${PORT}   ($(t 'nur aus' 'only from' 'solo desde') DASHBOARD_ALLOWED_NETS)"; fi
  echo "        →  $(t 'Login mit einem lokalen Systembenutzer (Host-Konto).' 'Sign in with a local system user (host account).' 'Inicia sesión con un usuario local del sistema (cuenta del host).')"
  echo
  echo "   $(t 'Einstellungen:' 'Settings:     ' 'Ajustes:      ')  $ENVF, $ETC/schutz.conf"
  echo "   $(t 'Sprache:      ' 'Language:     ' 'Idioma:       ')  $SPRACHE  ($(t 'ändern' 'change' 'cambiar'): sudo command-center sprache de|en|es)"
  echo "   $(t 'Module:       ' 'Modules:      ' 'Módulos:      ')  ${MODULE:-–}  ($(t 'ändern' 'change' 'cambiar'): sudo command-center module +postgres -ids)"
  hat fail2ban || hat ids && echo "   $(t 'Schutz:       ' 'Protection:   ' 'Protección:   ')  waechter status"
  echo "   $(t 'Befehle:      ' 'Commands:     ' 'Comandos:     ')  sudo command-center status | update | logs | sprache | deinstallieren"
fi
