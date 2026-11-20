#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-schutz.sh -- Schutz-Paket des Linux Dashboards installieren/updaten
#   fail2ban (SSH, Dashboard-Login, optional Mail/Web-Apps, Dauersperre)
#   IDS-Waechter (Suricata passiv -> ids-watch -> fail2ban -> ipset)
#   Firewall-Sperrlisten (ipsets in eigenen Ketten, rein additiv)
#   Cloudflare-Rand-Sperre nur optional (CLOUDFLARE=1)
#
# Normalerweise ruft ../install.sh dieses Skript auf. Es laeuft auch allein:
#
#   sudo ./install-schutz.sh                 installieren bzw. updaten
#   sudo ./install-schutz.sh --ja            ohne Rueckfragen (Standardwerte)
#   sudo ./install-schutz.sh --anwenden      schutz.conf neu anwenden (= waechter config-anwenden)
#   sudo ./install-schutz.sh --deinstallieren [--alles]
#
# Optionen fuer die Erstinstallation (sonst wird gefragt):
#   --trusted "IP ..."        eigene Anschluesse, werden nie gesperrt
#   --ohne-ids / --mit-ids    IDS (Suricata) ab-/anschalten
#   --ohne-fail2ban / --mit-fail2ban   ohne fail2ban sperrt der IDS selbst (ipset)
#   --ohne-radar / --mit-radar         Angriffs-Radar (Web-Scans sammeln, mit fail2ban sperren)
#   --ohne-cloudflare         Cloudflare-Rand-Sperre abschalten
#   (Diese Schalter gelten auch beim Update und ueberschreiben schutz.conf.)
#   --ids-modus melden|sperren
#   --ntfy-url URL --ntfy-topic TOPIC [--ntfy-token TOKEN]
#   --cloudflare              Web-Apps liegen hinter Cloudflare (optional)
#   --firewall eigen|aus      eigene Ketten (Standard) oder nur ipsets
#   --ohne-dashboard-jail     Dashboard laeuft nicht auf diesem Server
#   --uebernehmen             manuell eingerichtete Vorversion uebernehmen
#   --force                   auch aelteres Paket ueber neueres installieren
#
# Update-Regeln: Dateien des Pakets werden ersetzt (Sicherung unter
# /var/backups/linux-dashboard-schutz/<zeit>/), DEINE Dateien nie:
#   /etc/linux-dashboard/schutz.conf, /etc/ids-watch.conf, /etc/ids-watch.whitelist,
#   /etc/linux-dashboard/blk_net4.txt, /etc/fail2ban/jail.d/waechter.local,
#   /etc/fail2ban/cloudflare.local
# Neue Schluessel werden an diese Dateien nur angehaengt.
# ---------------------------------------------------------------------------
set -euo pipefail
# Sprache der Meldungen: CC_SPRACHE (reicht install.sh durch), sonst dashboard.env, sonst Deutsch
SPRACHE=${CC_SPRACHE:-$(sed -n 's/^CC_SPRACHE=//p' /etc/linux-dashboard/dashboard.env 2>/dev/null | head -1 || true)}
t() { case "$SPRACHE" in en) printf '%s' "$2" ;; es) printf '%s' "${3:-$2}" ;; *) printf '%s' "$1" ;; esac; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARE=/usr/local/share/linux-dashboard-schutz
ETC=/etc/linux-dashboard
CONF=$ETC/schutz.conf
VERFILE=$ETC/schutz-version
MANIFEST=$SHARE/manifest
SBIN=/usr/local/sbin
F2B=/etc/fail2ban
SYSD=/etc/systemd/system
TS=$(date +%Y%m%d-%H%M%S)
BACKUP=/var/backups/linux-dashboard-schutz/$TS

if [ -f "$SRC/../VERSION" ]; then VERSION=$(cat "$SRC/../VERSION")
elif [ -f "$SRC/VERSION" ]; then VERSION=$(cat "$SRC/VERSION")
else VERSION=0.0.0; fi

MODE=install; JA=0; FORCE=0; UEBERNEHMEN=0; ALLES=0
OPT_TRUSTED=""; OPT_IDS=""; OPT_MODUS=""; OPT_NTFY_URL=""; OPT_NTFY_TOPIC=""
OPT_NTFY_TOKEN=""; OPT_CF=""; OPT_FW=""; OPT_DASHJAIL=""; OPT_F2B=""; OPT_RADAR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ja|-y)              JA=1 ;;
        --anwenden)           MODE=anwenden ;;
        --deinstallieren)     MODE=deinstallieren ;;
        --alles)              ALLES=1 ;;
        --force)              FORCE=1 ;;
        --uebernehmen)        UEBERNEHMEN=1 ;;
        --trusted)            OPT_TRUSTED=$2; shift ;;
        --ohne-ids)           OPT_IDS=0 ;;
        --mit-ids)            OPT_IDS=1 ;;
        --ohne-fail2ban)      OPT_F2B=0 ;;
        --mit-fail2ban)       OPT_F2B=1 ;;
        --ohne-radar)         OPT_RADAR=0 ;;
        --mit-radar)          OPT_RADAR=1 ;;
        --ohne-cloudflare)    OPT_CF=0 ;;
        --ids-modus)          OPT_MODUS=$2; shift ;;
        --ntfy-url)           OPT_NTFY_URL=$2; shift ;;
        --ntfy-topic)         OPT_NTFY_TOPIC=$2; shift ;;
        --ntfy-token)         OPT_NTFY_TOKEN=$2; shift ;;
        --cloudflare)         OPT_CF=1 ;;
        --firewall)           OPT_FW=$2; shift ;;
        --ohne-dashboard-jail) OPT_DASHJAIL=false ;;
        -h|--help)            sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "$(t "Unbekannte Option: $1" "Unknown option: $1" "Opción desconocida: $1")" >&2; exit 1 ;;
    esac
    shift
done

log()  { printf '\033[1;32m[schutz]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[schutz]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[schutz]\033[0m %s\n' "$*" >&2; }
frage() {   # frage <text> <standard> -> Antwort auf stdout
    local a=""
    if [ $JA -eq 0 ] && [ -t 0 ]; then
        read -r -p "$1 [$2]: " a </dev/tty || true
    fi
    printf '%s' "${a:-$2}"
}
ver_lt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }
setze() {   # setze <datei> <KEY> <wert>   (KEY="wert", vorhandene Zeile ersetzen)
    local f=$1 k=$2 v=$3
    v=${v//\\/\\\\}; v=${v//&/\\&}; v=${v//|/\\|}
    if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=\"$v\"|" "$f"
    else printf '%s="%s"\n' "$k" "$3" >> "$f"; fi
}
cget() { python3 "$SRC/lib/schutz.py" get "$1"; }

[ "$(id -u)" -eq 0 ] || { err "$(t "Bitte als root ausführen (sudo)." "Please run as root (sudo)." "Ejecútalo como root (sudo).")"; exit 1; }
command -v systemctl >/dev/null || { err "$(t "systemd wird benötigt." "systemd is required." "Se necesita systemd.")"; exit 1; }
command -v apt-get >/dev/null || { err "$(t "Nur Debian/Ubuntu (apt) werden unterstützt." "Only Debian/Ubuntu (apt) are supported." "Solo se admiten Debian/Ubuntu (apt).")"; exit 1; }

# ===========================================================================
# Deinstallation
# ===========================================================================
if [ "$MODE" = deinstallieren ]; then
    log "$(t "Deinstalliere Schutz-Paket …" "Uninstalling the protection package …" "Desinstalando el paquete de protección …")"
    for u in ids-gesundheit.timer ids-tagesbericht.timer suricata-update-waechter.timer \
             cf-ban-reconcile.timer angriffe-sammeln.timer ids-watch.service; do
        systemctl disable --now "$u" 2>/dev/null || true
    done
    if [ -f $SYSD/suricata.service.d/waechter.conf ]; then
        systemctl disable --now suricata 2>/dev/null || true
    fi
    [ -x $SBIN/waechter-firewall.sh ] && $SBIN/waechter-firewall.sh --stop >/dev/null 2>&1 || true
    systemctl disable waechter-firewall.service 2>/dev/null || true
    if [ -f "$MANIFEST" ]; then
        while read -r f; do [ -n "$f" ] && rm -f "$f"; done < "$MANIFEST"
    fi
    systemctl daemon-reload
    # Neu starten statt reload: reload beendet Jails nicht, deren Konfiguration entfernt wurde.
    # Startet fail2ban ohne unsere Jails nicht (Debian 12: sshd-Jail ohne /var/log/auth.log), wird es angehalten.
    if systemctl is-enabled --quiet fail2ban 2>/dev/null; then
        if ! { systemctl restart fail2ban 2>/dev/null && sleep 3 && systemctl is-active --quiet fail2ban; }; then
            systemctl disable --now fail2ban >/dev/null 2>&1 || true; systemctl reset-failed fail2ban >/dev/null 2>&1 || true
            warn "$(t "fail2ban startet ohne die Jails dieses Pakets nicht und wurde angehalten (Paket entfernen: apt purge fail2ban)." "fail2ban does not start without this package's jails and was stopped (remove the package: apt purge fail2ban)." "fail2ban no arranca sin los jails de este paquete y se ha detenido (quitar el paquete: apt purge fail2ban).")"
        fi
    fi
    for s in ids_ban4 ids_ban6 ssh_ban4 ssh_ban6 perm_ban4 perm_ban6 f2b_long4 f2b_long6 f2b_net4 blk_net4; do
        ipset destroy "$s" 2>/dev/null || true     # scheitert still, solange eine fremde Regel es nutzt
    done
    rm -rf "$SHARE" "$VERFILE"
    if [ $ALLES -eq 1 ]; then
        rm -f "$CONF" "$ETC/schutz-netze.generiert" "$ETC/blk_net4.txt" /etc/ids-watch.conf \
              /etc/ids-watch.whitelist $F2B/jail.d/waechter.local
        log "$(t "Konfiguration entfernt." "Configuration removed." "Configuración eliminada.")"
    else
        log "$(t "Konfiguration bleibt erhalten ($CONF, /etc/ids-watch.conf, $F2B/jail.d/waechter.local)." "Configuration is kept ($CONF, /etc/ids-watch.conf, $F2B/jail.d/waechter.local)." "La configuración se conserva ($CONF, /etc/ids-watch.conf, $F2B/jail.d/waechter.local).")"
    fi
    log "$(t "Fertig. Pakete (fail2ban, suricata) bleiben installiert: apt purge suricata" "Done. Packages (fail2ban, suricata) stay installed: apt purge suricata" "Listo. Los paquetes (fail2ban, suricata) siguen instalados: apt purge suricata")"
    exit 0
fi

# ===========================================================================
# Zustand ermitteln
# ===========================================================================
INSTALLIERT=$(cat "$VERFILE" 2>/dev/null || true)
ALTBESTAND=0
if [ -z "$INSTALLIERT" ] && [ ! -f "$MANIFEST" ] && { [ -f $SBIN/ids-watch.py ] || [ -f $F2B/action.d/audit-ipset.conf ]; }; then
    ALTBESTAND=1
fi

if [ "$MODE" = anwenden ]; then
    [ -n "$INSTALLIERT" ] || { err "$(t "Schutz-Paket ist nicht installiert." "The protection package is not installed." "El paquete de protección no está instalado.")"; exit 1; }
    log "$(t "Wende $CONF an …" "Applying $CONF …" "Aplicando $CONF …")"
elif [ $ALTBESTAND -eq 1 ] && [ $UEBERNEHMEN -eq 0 ]; then
    err "$(t "Auf diesem Server ist bereits ein von Hand eingerichteter Wächter (fail2ban/IDS) vorhanden," "This server already has a manually set up guard (fail2ban/IDS)" "Este servidor ya tiene un vigilante (fail2ban/IDS) configurado a mano")"
    err "$(t "der nicht aus diesem Paket stammt (z. B. $SBIN/ids-watch.py)." "that does not come from this package (e.g. $SBIN/ids-watch.py)." "que no procede de este paquete (p. ej. $SBIN/ids-watch.py).")"
    err "$(t "Übernehmen mit:  ./install.sh --uebernehmen   (bzw. schutz/install-schutz.sh --uebernehmen)" "Take over with:  ./install.sh --uebernehmen   (or schutz/install-schutz.sh --uebernehmen)" "Para adoptarlo:  ./install.sh --uebernehmen   (o schutz/install-schutz.sh --uebernehmen)")"
    err "$(t "Dabei werden Paket-Dateien mit gleichem Namen ersetzt (Sicherung in /var/backups/linux-dashboard-schutz/)," "Package files with the same name are replaced (backup in /var/backups/linux-dashboard-schutz/)," "Se reemplazan los archivos del paquete con el mismo nombre (copia en /var/backups/linux-dashboard-schutz/),")"
    err "$(t "eigene Jail-Dateien in $F2B/jail.d/ bleiben unverändert und gelten weiter." "your own jail files in $F2B/jail.d/ stay unchanged and remain active." "tus propios archivos de jail en $F2B/jail.d/ no cambian y siguen activos.")"
    exit 2
elif [ -n "$INSTALLIERT" ] && ver_lt "$VERSION" "$INSTALLIERT" && [ $FORCE -eq 0 ]; then
    err "$(t "Installiert ist $INSTALLIERT, dieses Paket ist älter ($VERSION). Abbruch (--force zum Erzwingen)." "$INSTALLIERT is installed, this package is older ($VERSION). Aborting (--force to override)." "Está instalada la $INSTALLIERT, este paquete es más antiguo ($VERSION). Cancelado (--force para forzar).")"
    exit 1
elif [ -n "$INSTALLIERT" ]; then
    log "$(t "Update $INSTALLIERT → $VERSION" "Update $INSTALLIERT → $VERSION" "Actualización $INSTALLIERT → $VERSION")"
elif [ $ALTBESTAND -eq 1 ]; then
    log "$(t "Übernahme der von Hand eingerichteten Vorversion → $VERSION" "Taking over the manually set up previous version → $VERSION" "Adoptando la versión anterior configurada a mano → $VERSION")"
else
    log "$(t "Erstinstallation $VERSION" "First installation $VERSION" "Primera instalación $VERSION")"
fi

# ===========================================================================
# Konfiguration (schutz.conf)
# ===========================================================================
mkdir -p "$ETC"; chmod 755 "$ETC"
NEU_CONF=0
if [ ! -f "$CONF" ]; then
    NEU_CONF=1
    install -m 600 "$SRC/config/schutz.conf.example" "$CONF"
    if [ $ALTBESTAND -eq 1 ]; then
        log "$(t "Übernehme Werte aus der Vorversion:" "Taking over values from the previous version:" "Se toman los valores de la versión anterior:")"
        while IFS='=' read -r k v; do
            v=${v#\"}; v=${v%\"}
            setze "$CONF" "$k" "$v"
            case "$k" in NTFY_TOKEN) echo "    $k=***" ;; *) echo "    $k=$v" ;; esac
        done < <(python3 "$SRC/lib/schutz.py" altbestand)
    fi
    # --- Rueckfragen / Optionen ---------------------------------------------
    t_def=$(sed -n 's/^TRUSTED_IPS="\(.*\)"/\1/p' "$CONF")
    if [ -z "$t_def" ] && [ -n "${SSH_CLIENT:-}" ]; then t_def=${SSH_CLIENT%% *}; fi
    [ -n "${SUDO_USER:-}" ] && [ -z "$t_def" ] && t_def=$(who am i 2>/dev/null | sed -n 's/.*(\([0-9a-fA-F.:]*\)).*/\1/p')
    if [ -n "$OPT_TRUSTED" ]; then t=$OPT_TRUSTED
    else
        echo
        t "Eigene Anschlüsse (Admin-IPs) werden NIE gesperrt (Tailscale/LAN sind immer frei)." \
          "Your own connections (admin IPs) are NEVER banned (Tailscale/LAN are always allowed)." \
          "Tus conexiones (IPs de administración) NUNCA se bloquean (Tailscale/LAN siempre están permitidas)."; echo
        if [ "$(cget F2B_AKTIV 2>/dev/null)" != 0 ]; then
            t "Wichtig: ein einziger ungültiger SSH-Login sperrt sonst für eine Woche." \
              "Important: otherwise a single invalid SSH login bans for a week." \
              "Importante: si no, un solo inicio de sesión SSH no válido bloquea durante una semana."; echo
        fi
        t=$(frage "$(t "Eigene IPs/Netze (Leerzeichen-getrennt, leer = keine)" "Your own IPs/networks (space-separated, empty = none)" "Tus IPs/redes (separadas por espacios, vacío = ninguna)")" "$t_def")
    fi
    setze "$CONF" TRUSTED_IPS "$t"

    if [ -n "$OPT_IDS" ]; then ids=$OPT_IDS
    else
        cur=$(sed -n 's/^IDS_AKTIV="\(.*\)"/\1/p' "$CONF")
        a=$(frage "$(t "IDS-Wächter (Suricata) installieren? Braucht ~1–2 GB RAM (j/n)" "Install the IDS guard (Suricata)? Needs ~1–2 GB RAM (y/n)" "¿Instalar el vigilante IDS (Suricata)? Necesita ~1–2 GB de RAM (s/n)")" "$([ "$cur" = 0 ] && echo n || echo j)")
        case "$a" in n*|N*) ids=0 ;; *) ids=1 ;; esac   # j/y/s = ja
    fi
    setze "$CONF" IDS_AKTIV "$ids"

    [ -n "$OPT_DASHJAIL" ] && setze "$CONF" DASHBOARD_JAIL "$OPT_DASHJAIL"

    if [ -n "$OPT_NTFY_URL" ]; then
        setze "$CONF" NTFY_URL "$OPT_NTFY_URL"; setze "$CONF" NTFY_TOPIC "$OPT_NTFY_TOPIC"
        setze "$CONF" NTFY_TOKEN "$OPT_NTFY_TOKEN"
    elif ! grep -q '^NTFY_URL="[a-z]' "$CONF"; then
        u=$(frage "$(t "ntfy-Server für Push-Meldungen (z. B. https://ntfy.sh, leer = keine Pushes)" "ntfy server for push messages (e.g. https://ntfy.sh, empty = no pushes)" "Servidor ntfy para avisos push (p. ej. https://ntfy.sh, vacío = sin avisos)")" "")
        if [ -n "$u" ]; then
            setze "$CONF" NTFY_URL "$u"
            setze "$CONF" NTFY_TOPIC "$(frage "ntfy-Topic" "server-$(hostname -s)")"
            setze "$CONF" NTFY_TOKEN "$(frage "$(t "ntfy-Zugangstoken (leer = ohne)" "ntfy access token (empty = none)" "Token de acceso de ntfy (vacío = sin token)")" "")"
        fi
    fi
else
    python3 "$SRC/lib/schutz.py" conf-merge "$SRC/config/schutz.conf.example" "$CONF"
    [ -n "$OPT_DASHJAIL" ] && setze "$CONF" DASHBOARD_JAIL "$OPT_DASHJAIL"
    [ -n "$OPT_IDS" ] && setze "$CONF" IDS_AKTIV "$OPT_IDS"
fi
# Modul-Schalter gelten bei Erstinstallation UND Update (command-center module)
case "$OPT_CF" in 1) setze "$CONF" CLOUDFLARE 1 ;; 0) setze "$CONF" CLOUDFLARE 0 ;; esac
[ -n "$OPT_FW" ] && setze "$CONF" FIREWALL "$OPT_FW"
[ -n "$OPT_F2B" ] && setze "$CONF" F2B_AKTIV "$OPT_F2B"
[ -n "$OPT_RADAR" ] && setze "$CONF" RADAR_AKTIV "$OPT_RADAR"
chmod 600 "$CONF"

IDS=$(cget IDS_AKTIV); CF=$(cget CLOUDFLARE); FW=$(cget FIREWALL); FB=$(cget F2B_AKTIV); RADAR=$(cget RADAR_AKTIV)
if [ "$FB" != 1 ] && [ "$CF" = 1 ]; then
    warn "$(t "Cloudflare-Rand-Sperre braucht fail2ban – ohne fail2ban abgeschaltet." "Cloudflare edge blocking needs fail2ban – turned off without fail2ban." "El bloqueo en el borde de Cloudflare necesita fail2ban: desactivado sin fail2ban.")"; CF=0; setze "$CONF" CLOUDFLARE 0
fi
if [ "$FB" != 1 ] && [ "$(cget DASHBOARD_JAIL)" != false ]; then
    warn "$(t "Ohne fail2ban gibt es keine Sperre nach falschen Logins (SSH, Command Center)." "Without fail2ban there is no ban after failed logins (SSH, Command Center)." "Sin fail2ban no hay bloqueo tras inicios de sesión fallidos (SSH, Command Center).")"
fi
log "Module: fail2ban=$FB IDS=$IDS Radar=$RADAR Firewall=$FW Cloudflare=$CF"

# ===========================================================================
# Pakete
# ===========================================================================
if [ "$MODE" != anwenden ]; then
    export DEBIAN_FRONTEND=noninteractive
    OS_ID=$(. /etc/os-release; echo "${ID:-}")   # nicht global sourcen: setzt sonst $VERSION
    PKGS="ipset iptables jq curl python3 python3-yaml python3-systemd conntrack"
    [ "$FB" = 1 ] && PKGS="fail2ban $PKGS"
    if [ "$IDS" = 1 ] && ! command -v suricata >/dev/null; then
        if [ "$OS_ID" = ubuntu ] && [ "$(cget SURICATA_PPA)" = 1 ]; then
            log "$(t "Füge OISF-PPA für aktuelles Suricata hinzu …" "Adding the OISF PPA for a current Suricata …" "Añadiendo el PPA de OISF para un Suricata actual …")"
            apt-get update -qq
            apt-get install -y -qq software-properties-common >/dev/null
            add-apt-repository -y ppa:oisf/suricata-stable >/dev/null
        fi
        SURICATA_NOETIG=1
    fi
    log "$(t "Installiere Pakete: $PKGS${SURICATA_NOETIG:+ suricata}" "Installing packages: $PKGS${SURICATA_NOETIG:+ suricata}" "Instalando paquetes: $PKGS${SURICATA_NOETIG:+ suricata}")"
    apt-get update -qq
    # shellcheck disable=SC2086
    apt-get install -y -qq $PKGS >/dev/null
    if [ -n "${SURICATA_NOETIG:-}" ]; then
        if apt-cache policy suricata 2>/dev/null | grep -q 'Candidate: [0-9]'; then
            apt-get install -y -qq suricata >/dev/null
        elif [ "$OS_ID" = debian ]; then
            # Debian 12: Suricata gibt es nur in den Backports
            CODENAME=$(. /etc/os-release; echo "$VERSION_CODENAME")
            log "$(t "Suricata aus ${CODENAME}-backports …" "Suricata from ${CODENAME}-backports …" "Suricata desde ${CODENAME}-backports …")"
            echo "deb http://deb.debian.org/debian ${CODENAME}-backports main" \
                > /etc/apt/sources.list.d/linux-dashboard-backports.list
            apt-get update -qq
            apt-get install -y -qq -t "${CODENAME}-backports" suricata >/dev/null
        else
            err "$(t "Suricata ist für dieses System nicht verfügbar – IDS mit --ohne-ids abschalten." "Suricata is not available for this system – turn the IDS off with --ohne-ids." "Suricata no está disponible para este sistema: desactiva el IDS con --ohne-ids.")"
            exit 1
        fi
    fi
    if [ "$IDS" = 1 ] && ! command -v suricata-update >/dev/null; then
        apt-get install -y -qq suricata-update >/dev/null || warn "$(t "suricata-update nicht installierbar" "suricata-update could not be installed" "No se pudo instalar suricata-update")"
    fi
fi

# ===========================================================================
# Weitere Konfigurationsdateien (gehoeren dem Benutzer, nur anlegen/ergaenzen)
# ===========================================================================
anlegen() {   # anlegen <beispiel> <ziel> <modus>
    if [ ! -f "$2" ]; then install -m "$3" "$1" "$2"; log "$(t "angelegt: $2" "created: $2" "creado: $2")"
    else python3 "$SRC/lib/schutz.py" conf-merge "$1" "$2"; fi
}
anlegen "$SRC/config/blk_net4.txt.example" "$ETC/blk_net4.txt" 644
if [ "$FB" = 1 ] && [ ! -f $F2B/jail.d/waechter.local ]; then
    install -m 644 "$SRC/config/jail-waechter.local.example" $F2B/jail.d/waechter.local
fi
if [ "$IDS" = 1 ]; then
    if [ ! -f /etc/ids-watch.conf ]; then
        install -m 644 "$SRC/config/ids-watch.conf.example" /etc/ids-watch.conf
        m=$OPT_MODUS
        if [ -z "$m" ]; then
            echo
            t "IDS-Modus: 'melden' protokolliert nur, was gesperrt würde (empfohlen für die ersten Tage)," \
              "IDS mode: 'melden' only logs what would be banned (recommended for the first days)," \
              "Modo IDS: 'melden' solo registra lo que se bloquearía (recomendado los primeros días),"; echo
            t "'sperren' sperrt Angreifer und bösartige Ziele sofort." \
              "'sperren' bans attackers and malicious targets right away." \
              "'sperren' bloquea al momento a atacantes y destinos maliciosos."; echo
            m=$(frage "$(t "IDS-Modus (melden/sperren)" "IDS mode (melden = report only / sperren = block)" "Modo IDS (melden = solo avisar / sperren = bloquear)")" "melden")
        fi
        case "$m" in sperren) ;; *) m=melden ;; esac
        sed -i "s/^MODUS=.*/MODUS=$m/" /etc/ids-watch.conf
        log "$(t "IDS-Modus: $m (später: waechter ids-modus sperren)" "IDS mode: $m (later: waechter ids-modus sperren)" "Modo IDS: $m (más tarde: waechter ids-modus sperren)")"
    else
        python3 "$SRC/lib/schutz.py" conf-merge "$SRC/config/ids-watch.conf.example" /etc/ids-watch.conf
        if [ $ALTBESTAND -eq 1 ]; then
            while IFS='=' read -r k v; do
                [ -n "$k" ] || continue
                sed -i "s|^$k=.*|$k=$v|" /etc/ids-watch.conf
                log "$(t "Altbestand: $k=$v (ids-watch.conf)" "Existing: $k=$v (ids-watch.conf)" "Existente: $k=$v (ids-watch.conf)")"
            done < <(python3 "$SRC/lib/schutz.py" altbestand-ids)
        fi
    fi
    [ -f /etc/ids-watch.whitelist ] || install -m 644 "$SRC/config/ids-watch.whitelist.example" /etc/ids-watch.whitelist
    # Ohne fail2ban sperrt ids-watch selbst
    sed -i "s/^DIREKT_SPERREN=.*/DIREKT_SPERREN=$([ "$FB" = 1 ] && echo 0 || echo 1)/; s/^SPERRZEIT=.*/SPERRZEIT=$(cget IDS_SPERRZEIT)/" /etc/ids-watch.conf
fi
if [ "$CF" = 1 ] && [ ! -f $F2B/cloudflare.local ]; then
    install -m 600 "$SRC/config/cloudflare.local.example" $F2B/cloudflare.local
    warn "$(t "Cloudflare: Token in $F2B/cloudflare.local eintragen, dann $SBIN/cf-ban-setup.sh ausführen." "Cloudflare: enter the token in $F2B/cloudflare.local, then run $SBIN/cf-ban-setup.sh." "Cloudflare: pon el token en $F2B/cloudflare.local y ejecuta $SBIN/cf-ban-setup.sh.")"
fi

# ===========================================================================
# Netze berechnen
# ===========================================================================
python3 "$SRC/lib/schutz.py" netze
log "$(t "Netze" "Networks" "Redes"): WAN=$(sed -n 's/^WAN_IF="\(.*\)"/\1/p' "$ETC/schutz-netze.generiert" 2>/dev/null), $(t "Server" "server" "servidor") $(sed -n 's/^SERVER_NETZE="\(.*\)"/\1/p' "$ETC/schutz-netze.generiert" 2>/dev/null)"

# ===========================================================================
# Paket-Dateien installieren (mit Sicherung und Manifest)
# ===========================================================================
mkdir -p "$SHARE"
NEUES_MANIFEST=$(mktemp)
sichern() {
    if [ -e "$1" ]; then
        mkdir -p "$BACKUP$(dirname "$1")"
        cp -a "$1" "$BACKUP$1"
    fi
}
inst() {    # inst <quelle> <ziel> <modus>
    if [ -e "$2" ] && cmp -s "$1" "$2"; then
        chmod "$3" "$2"
    else
        sichern "$2"
        install -D -m "$3" "$1" "$2"
    fi
    echo "$2" >> "$NEUES_MANIFEST"
}
render() {  # render <vorlage> <ziel> <modus>
    local tmp; tmp=$(mktemp)
    python3 "$SRC/lib/schutz.py" render "$1" "$tmp"
    inst "$tmp" "$2" "$3"
    rm -f "$tmp"
}

# Skripte
for f in waechter waechter-push waechter-firewall.sh webauth-unban.sh f2b-dauersperre-notify.sh \
         ids-push.sh gen-suricata-ids-yaml.py; do
    inst "$SRC/sbin/$f" "$SBIN/$f" 750
done
if [ "$IDS" = 1 ]; then
    for f in ids-watch.py ids-gesundheit.py ids-tagesbericht.sh; do inst "$SRC/sbin/$f" "$SBIN/$f" 750; done
fi
if [ "$CF" = 1 ]; then
    for f in cf-ban.sh cf-ban-reconcile.sh cf-ban-setup.sh; do inst "$SRC/sbin/$f" "$SBIN/$f" 700; done
fi
if [ "$RADAR" = 1 ]; then
    inst "$SRC/sbin/angriffe-sammeln.py" "$SBIN/angriffe-sammeln.py" 750
fi

# fail2ban (nur mit F2B_AKTIV=1; sonst entfernt das Manifest frueher installierte Paket-Dateien)
if [ "$FB" = 1 ]; then
    for f in "$SRC"/fail2ban/action.d/*.conf; do
        b=$(basename "$f")
        [ "$b" = cf-block.conf ] && [ "$CF" != 1 ] && continue
        inst "$f" "$F2B/action.d/$b" 644
    done
    for f in "$SRC"/fail2ban/filter.d/*.conf; do inst "$f" "$F2B/filter.d/$(basename "$f")" 644; done
    render "$SRC/fail2ban/filter.d/mail-subnet24.conf.in" "$F2B/filter.d/mail-subnet24.conf" 644
    render "$SRC/fail2ban/jail.d/waechter.conf.in" "$F2B/jail.d/waechter.conf" 644
    render "$SRC/fail2ban/jail.d/angriffe.conf.in" "$F2B/jail.d/angriffe.conf" 644
    render "$SRC/fail2ban/fail2ban.d/waechter.conf.in" "$F2B/fail2ban.d/waechter.conf" 644
fi

# systemd + logrotate
inst "$SRC/systemd/waechter-firewall.service" "$SYSD/waechter-firewall.service" 644
if [ "$IDS" = 1 ]; then
    for u in ids-watch.service ids-gesundheit.service ids-gesundheit.timer ids-tagesbericht.service \
             ids-tagesbericht.timer suricata-update-waechter.service suricata-update-waechter.timer; do
        inst "$SRC/systemd/$u" "$SYSD/$u" 644
    done
    render "$SRC/systemd/suricata-waechter.conf.in" "$SYSD/suricata.service.d/waechter.conf" 644
    if [ ! -f /etc/logrotate.d/suricata ]; then
        inst "$SRC/logrotate/suricata-waechter" /etc/logrotate.d/suricata-waechter 644
    fi
fi
if [ "$CF" = 1 ]; then
    for u in cf-ban-reconcile.service cf-ban-reconcile.timer; do inst "$SRC/systemd/$u" "$SYSD/$u" 644; done
fi
if [ "$RADAR" = 1 ]; then
    for u in angriffe-sammeln.service angriffe-sammeln.timer; do inst "$SRC/systemd/$u" "$SYSD/$u" 644; done
fi
inst "$SRC/logrotate/linux-dashboard-schutz" /etc/logrotate.d/linux-dashboard-schutz 644

# Altbestand: Dateien der manuellen Vorversion, die durch Paket-Dateien mit
# anderem Namen ersetzt werden, sichern und stilllegen.
if [ $ALTBESTAND -eq 1 ] && [ "$MODE" != anwenden ]; then
    if [ -f $SYSD/suricata.service.d/ids.conf ]; then
        sichern $SYSD/suricata.service.d/ids.conf; rm -f $SYSD/suricata.service.d/ids.conf
        log "$(t "Altbestand: suricata-Drop-in ids.conf ersetzt durch waechter.conf" "Existing: suricata drop-in ids.conf replaced by waechter.conf" "Existente: drop-in de suricata ids.conf sustituido por waechter.conf")"
    fi
    if [ -f $SYSD/suricata-update.timer ] && [ "$IDS" = 1 ]; then
        systemctl disable --now suricata-update.timer 2>/dev/null || true
        sichern $SYSD/suricata-update.timer; sichern $SYSD/suricata-update.service
        rm -f $SYSD/suricata-update.timer $SYSD/suricata-update.service
        log "$(t "Altbestand: suricata-update.timer ersetzt durch suricata-update-waechter.timer" "Existing: suricata-update.timer replaced by suricata-update-waechter.timer" "Existente: suricata-update.timer sustituido por suricata-update-waechter.timer")"
    fi
    if [ -f /etc/logrotate.d/ids-watch ]; then
        sichern /etc/logrotate.d/ids-watch; rm -f /etc/logrotate.d/ids-watch
    fi
fi

# Dateien, die frueher zum Paket gehoerten und jetzt nicht mehr: entfernen
if [ -f "$MANIFEST" ]; then
    sort -u "$MANIFEST" > "$NEUES_MANIFEST.alt"
    sort -u "$NEUES_MANIFEST" > "$NEUES_MANIFEST.neu"
    comm -23 "$NEUES_MANIFEST.alt" "$NEUES_MANIFEST.neu" | while read -r f; do
        [ -n "$f" ] && [ -e "$f" ] || continue
        sichern "$f"; rm -f "$f"; log "$(t "entfernt (nicht mehr benötigt): $f" "removed (no longer needed): $f" "eliminado (ya no se necesita): $f")"
    done
    rm -f "$NEUES_MANIFEST.alt" "$NEUES_MANIFEST.neu"
fi

# Kopie des Pakets fuer "waechter config-anwenden" und Deinstallation
if [ "$SRC" != "$SHARE" ]; then
    rm -rf "$SHARE.neu"; mkdir -p "$SHARE.neu"
    cp -a "$SRC"/. "$SHARE.neu"/
    echo "$VERSION" > "$SHARE.neu/VERSION"
    rm -rf "$SHARE.alt"; [ -d "$SHARE" ] && mv "$SHARE" "$SHARE.alt"
    mv "$SHARE.neu" "$SHARE"; rm -rf "$SHARE.alt"
fi
sort -u "$NEUES_MANIFEST" > "$MANIFEST"; rm -f "$NEUES_MANIFEST"
systemctl daemon-reload

# ===========================================================================
# Firewall
# ===========================================================================
if [ "$FW" = eigen ]; then
    systemctl enable waechter-firewall.service >/dev/null 2>&1
    systemctl restart waechter-firewall.service
    log "$(t "Firewall: Ketten WAECHTER-* aktiv" "Firewall: chains WAECHTER-* active" "Firewall: cadenas WAECHTER-* activas")"
else
    systemctl disable --now waechter-firewall.service >/dev/null 2>&1 || true
    $SBIN/waechter-firewall.sh --nur-sets >/dev/null
    log "$(t "Firewall: nur ipsets (FIREWALL=aus) – die eigene Firewall muss die Sets einhängen" "Firewall: ipsets only (FIREWALL=aus) – your own firewall must hook in the sets" "Firewall: solo ipsets (FIREWALL=aus): tu propio firewall debe enlazar los conjuntos")"
fi

# ===========================================================================
# IDS (Suricata)
# ===========================================================================
if [ "$IDS" = 1 ]; then
    id suricata >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin suricata
    install -d -m 750 -o suricata -g suricata /var/log/suricata /run/suricata
    chown -R suricata:suricata /var/log/suricata
    install -d -m 755 /var/lib/suricata /var/lib/suricata/rules /var/lib/ids-watch
    touch /var/log/ids-watch.log; chmod 640 /var/log/ids-watch.log
    WAN=$(cget WAN_IF)
    $SBIN/gen-suricata-ids-yaml.py --iface "$WAN" --home "$(cget SURICATA_HOME_NET)" \
        --threads "$(cget IDS_THREADS)" 2>/dev/null
    if [ ! -s /var/lib/suricata/rules/suricata.rules ] || [ "$MODE" != anwenden ]; then
        log "$(t "Lade Suricata-Regeln (ET Open) …" "Loading Suricata rules (ET Open) …" "Cargando reglas de Suricata (ET Open) …")"
        suricata-update --suricata-conf /etc/suricata/suricata-ids.yaml -q >/dev/null 2>&1 \
            || warn "$(t "suricata-update fehlgeschlagen (Netz?) – nächster Versuch per Timer" "suricata-update failed (network?) – next attempt via timer" "suricata-update falló (¿red?): siguiente intento por temporizador")"
    fi
    if [ -s /var/lib/suricata/rules/suricata.rules ]; then
        if ! suricata -T -c /etc/suricata/suricata-ids.yaml >/tmp/suricata-test.$$ 2>&1; then
            err "$(t "Suricata-Konfigtest fehlgeschlagen:" "Suricata configuration test failed:" "Falló la prueba de configuración de Suricata:")"; tail -5 /tmp/suricata-test.$$ >&2
        fi
        rm -f /tmp/suricata-test.$$
    fi
    systemctl enable suricata.service >/dev/null 2>&1
    systemctl restart suricata.service || warn "$(t "Suricata startet nicht: journalctl -u suricata" "Suricata does not start: journalctl -u suricata" "Suricata no arranca: journalctl -u suricata")"
    systemctl enable --now suricata-update-waechter.timer ids-gesundheit.timer ids-tagesbericht.timer >/dev/null 2>&1
    systemctl enable ids-watch.service >/dev/null 2>&1
    systemctl restart ids-watch.service
    log "$(t "IDS-Wächter aktiv (Interface $WAN, Modus $(sed -n 's/^MODUS=//p' /etc/ids-watch.conf))" "IDS guard active (interface $WAN, mode $(sed -n 's/^MODUS=//p' /etc/ids-watch.conf))" "Vigilante IDS activo (interfaz $WAN, modo $(sed -n 's/^MODUS=//p' /etc/ids-watch.conf))")"
else
    for u in ids-watch.service ids-gesundheit.timer ids-tagesbericht.timer suricata-update-waechter.timer; do
        systemctl disable --now "$u" >/dev/null 2>&1 || true
    done
    # Modul IDS abgewählt: das von diesem Paket eingerichtete Suricata anhalten (spart 1–2 GB RAM).
    # Ein eigenes Suricata ohne unsere Konfiguration bleibt unberührt.
    if [ -f /etc/suricata/suricata-ids.yaml ] && systemctl is-enabled --quiet suricata.service 2>/dev/null; then
        systemctl disable --now suricata.service >/dev/null 2>&1 || true; systemctl reset-failed suricata.service >/dev/null 2>&1 || true
        log "$(t "IDS aus: Suricata angehalten (Paket bleibt installiert: apt purge suricata)" "IDS off: Suricata stopped (package stays installed: apt purge suricata)" "IDS desactivado: Suricata detenido (el paquete sigue instalado: apt purge suricata)")"
    fi
fi
if [ "$CF" = 1 ]; then
    systemctl enable --now cf-ban-reconcile.timer >/dev/null 2>&1
else
    systemctl disable --now cf-ban-reconcile.timer >/dev/null 2>&1 || true
fi
if [ "$RADAR" = 1 ]; then
    install -d -m 750 /var/log/angriffe; touch /var/log/angriffe/web.log
    systemctl enable --now angriffe-sammeln.timer >/dev/null 2>&1
    log "$(t "Angriffs-Radar aktiv (alle 2 min)" "Attack radar active (every 2 min)" "Radar de ataques activo (cada 2 min)")"
else
    systemctl disable --now angriffe-sammeln.timer >/dev/null 2>&1 || true
fi

# ===========================================================================
# fail2ban: pruefen, sonst zurueckrollen
# ===========================================================================
mkdir -p /var/log/webauth
touch /var/log/fail2ban.log
if [ "$(cget DASHBOARD_JAIL)" != false ]; then
    mkdir -p /var/lib/linux-dashboard; touch /var/lib/linux-dashboard/auth.log
fi
if [ "$FB" != 1 ]; then
    # Frueher installierte Paket-Jails sind per Manifest entfernt; fremde fail2ban-Konfiguration bleibt unberuehrt.
    command -v fail2ban-client >/dev/null && systemctl is-active --quiet fail2ban && { fail2ban-client reload >/dev/null 2>&1 || true; }
    log "$(t "fail2ban: nicht Teil dieser Installation (F2B_AKTIV=0)" "fail2ban: not part of this installation (F2B_AKTIV=0)" "fail2ban: no forma parte de esta instalación (F2B_AKTIV=0)")"
elif ! fail2ban-client -t >/tmp/f2b-test.$$ 2>&1; then
    err "$(t "fail2ban-Konfiguration fehlerhaft:" "fail2ban configuration has errors:" "La configuración de fail2ban tiene errores:")"; grep -iE 'error|fehler' /tmp/f2b-test.$$ | tail -8 >&2
    if [ -d "$BACKUP$F2B" ]; then
        err "$(t "Stelle die vorherigen fail2ban-Dateien wieder her ($BACKUP$F2B)." "Restoring the previous fail2ban files ($BACKUP$F2B)." "Restaurando los archivos anteriores de fail2ban ($BACKUP$F2B).")"
        cp -a "$BACKUP$F2B"/. $F2B/
    fi
    rm -f /tmp/f2b-test.$$
    exit 1
fi
if [ "$FB" = 1 ]; then
    rm -f /tmp/f2b-test.$$
    systemctl enable fail2ban >/dev/null 2>&1
    if systemctl is-active --quiet fail2ban; then
        fail2ban-client reload >/dev/null || systemctl restart fail2ban
    else
        systemctl restart fail2ban
    fi
    for _ in $(seq 1 20); do
        jails=$(fail2ban-client status 2>/dev/null | sed -n 's/^.*Jail list:\s*//p' || true)
        [ -n "$jails" ] && break
        sleep 1
    done
    log "$(t "fail2ban: ${jails:-KEINE JAILS AKTIV – journalctl -u fail2ban}" "fail2ban: ${jails:-NO JAILS ACTIVE – journalctl -u fail2ban}" "fail2ban: ${jails:-NINGÚN JAIL ACTIVO – journalctl -u fail2ban}")"
fi

if [ "$MODE" != anwenden ]; then
    echo "$VERSION" > "$VERFILE"
    [ -d "$BACKUP" ] && log "$(t "Sicherung der ersetzten Dateien: $BACKUP" "Backup of the replaced files: $BACKUP" "Copia de los archivos reemplazados: $BACKUP")"
fi
log "$(t "Fertig. Status: waechter status   |   Freigeben: waechter freigeben <ip>" "Done. Status: waechter status   |   Unban: waechter freigeben <ip>" "Listo. Estado: waechter status   |   Desbloquear: waechter freigeben <ip>")"
