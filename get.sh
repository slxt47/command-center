#!/usr/bin/env bash
# Command Center – Ein-Zeilen-Installation:
#
#   curl -fsSL https://raw.githubusercontent.com/slxt47/command-center/main/get.sh | sudo bash
#
# Lädt die neueste Version nach /opt/command-center und startet ./install.sh ohne Rückfragen.
# Optionen werden durchgereicht, z. B.:
#   curl -fsSL …/get.sh | sudo bash -s -- --lan            auch aus dem lokalen Netz erreichbar
#   curl -fsSL …/get.sh | sudo bash -s -- --port 9000
#   curl -fsSL …/get.sh | sudo bash -s -- --ohne-schutz    ohne fail2ban/IDS
#   curl -fsSL …/get.sh | sudo bash -s -- --sprache en     English (sonst wird gefragt / otherwise you are asked)
# Danach: `sudo command-center status | update | logs | deinstallieren`
set -euo pipefail

REPO_URL="${CC_REPO:-https://github.com/slxt47/command-center}"
ZIEL="${CC_ZIEL:-/opt/command-center}"
ZWEIG="${CC_ZWEIG:-main}"

rot()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }
gruen(){ printf '\033[1;32m%s\033[0m\n' "$*"; }

# Sprache / language: --sprache de|en, CC_SPRACHE, bestehende Installation – sonst fragen (auch bei curl | bash über /dev/tty)
SPRACHE="${CC_SPRACHE:-}"
vorher=""; for a in "$@"; do [ "$vorher" = --sprache ] || [ "$vorher" = --language ] && SPRACHE=$a; vorher=$a; done
[ -z "$SPRACHE" ] && SPRACHE=$(sed -n 's/^CC_SPRACHE=//p' /etc/linux-dashboard/dashboard.env 2>/dev/null | head -1 || true)
if [ -z "$SPRACHE" ] && [[ " $* " != *" --ja "* ]] && { : </dev/tty; } 2>/dev/null; then
  printf '\nSprache / Language / Idioma:  1) Deutsch  2) English  3) Español  [1]: ' >/dev/tty; read -r _s </dev/tty || true
  case "$_s" in 2|en|EN|e) SPRACHE=en ;; 3|es|ES) SPRACHE=es ;; *) SPRACHE=de ;; esac
fi
case "$SPRACHE" in en|es) ;; *) SPRACHE=de ;; esac
t() { case "$SPRACHE" in en) printf '%s' "$2" ;; es) printf '%s' "${3:-$2}" ;; *) printf '%s' "$1" ;; esac; }

[ "$(id -u)" -eq 0 ] || { rot "$(t 'Bitte mit sudo ausführen:' 'Please run with sudo:' 'Ejecútalo con sudo:')  curl -fsSL …/get.sh | sudo bash"; exit 1; }
[ "$(uname -s)" = Linux ] || { rot "$(t 'Das Command Center läuft auf Linux-Servern.' 'The Command Center runs on Linux servers.' 'El Command Center funciona en servidores Linux.')"; exit 1; }
case "$(uname -m)" in x86_64|amd64|aarch64|arm64) ;; *) rot "$(t 'Nicht unterstützte Architektur' 'Unsupported architecture' 'Arquitectura no admitida'): $(uname -m) (x86_64, arm64)"; exit 1 ;; esac

# Werkzeuge, die der Installer braucht (git oder tar+curl, python3)
paket() {
  if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "$@" >/dev/null
  elif command -v yum >/dev/null; then yum install -y -q "$@" >/dev/null
  elif command -v pacman >/dev/null; then pacman -Sy --noconfirm --needed "$@" >/dev/null
  elif command -v zypper >/dev/null; then zypper --non-interactive install "$@" >/dev/null
  elif command -v apk >/dev/null; then apk add --no-cache "$@" >/dev/null
  else rot "$(t 'Kein unterstützter Paketmanager gefunden – bitte von Hand installieren:' 'No supported package manager found – please install by hand:' 'No se encontró un gestor de paquetes compatible: instálalo a mano:') $*"; exit 1; fi
}
command -v curl >/dev/null || paket curl
command -v python3 >/dev/null || paket python3
command -v git >/dev/null || paket git || true

gruen "▸ $(t 'Lade Command Center nach' 'Downloading Command Center to' 'Descargando el Command Center en') $ZIEL …"
if [ -d "$ZIEL/.git" ] && command -v git >/dev/null; then
  git -C "$ZIEL" fetch -q --depth 1 origin "$ZWEIG" && git -C "$ZIEL" reset -q --hard "origin/$ZWEIG"
elif command -v git >/dev/null; then
  rm -rf -- "${ZIEL:?}.neu"; git clone -q --depth 1 -b "$ZWEIG" "$REPO_URL" "$ZIEL.neu"
  [ -d "$ZIEL" ] && mv -- "$ZIEL" "$ZIEL.alt.$(date +%s)"; mv -- "$ZIEL.neu" "$ZIEL"
else
  tmp=$(mktemp -d); curl -fsSL "$REPO_URL/archive/refs/heads/$ZWEIG.tar.gz" | tar -xz -C "$tmp"
  [ -d "$ZIEL" ] && mv -- "$ZIEL" "$ZIEL.alt.$(date +%s)"; mv -- "$tmp"/*/ "$ZIEL"
fi

# Schutz-Paket (fail2ban + IDS) gibt es für Debian/Ubuntu; sonst nur das Command Center
EXTRA=()
if ! command -v apt-get >/dev/null && [[ " $* " != *" --ohne-schutz "* ]]; then
  echo "  $(t 'Hinweis: fail2ban/IDS-Schutzpaket gibt es nur für Debian/Ubuntu – installiere nur das Command Center.' 'Note: the fail2ban/IDS protection package is only available for Debian/Ubuntu – installing only the Command Center.' 'Nota: el paquete de protección fail2ban/IDS solo existe para Debian/Ubuntu: se instala solo el Command Center.')"
  EXTRA+=(--ohne-schutz)
fi

[[ " $* " == *" --sprache "* || " $* " == *" --language "* ]] || EXTRA+=(--sprache "$SPRACHE")

cd "$ZIEL"
exec bash ./install.sh --ja --menue "${EXTRA[@]}" "$@"
