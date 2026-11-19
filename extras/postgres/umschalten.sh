#!/usr/bin/env bash
# Kopie zur Haupt-Datenbank machen bzw. Kopie neu aufbauen (cc_db / cc_db_replica).
#
#   ./umschalten.sh befoerdern   cc_db ist kaputt/weg → cc_db_replica wird beschreibbar (pg_promote).
#                                                Das Command Center merkt es selbst (schreibt an den, der nicht „Kopie“ ist).
#                                                cc_db bleibt GESTOPPT, sonst gäbe es zwei Haupt-Datenbanken.
#   ./umschalten.sh zurueck      Nach dem Befördern: cc_db aus der (jetzt Haupt-)Kopie neu aufbauen?
#                                                Einfacher, weil nur Zwischenspeicher: cc_db wieder starten, Kopie neu
#                                                von cc_db holen (Daten der Kopie werden verworfen).
#   ./umschalten.sh kopie-neu    Kopie verwerfen und frisch von cc_db holen (z. B. wenn sie hängt).
#   ./umschalten.sh status       Wer ist Haupt, wer Kopie, wie weit hinterher?
set -euo pipefail
cd "$(dirname "$0")"
status() {
  for c in cc_db cc_db_replica; do
    printf '%-14s ' "$c"
    if docker exec "$c" pg_isready -U cc -d cc -q 2>/dev/null; then
      r=$(docker exec "$c" psql -U cc -d cc -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'Kopie (nur lesen)' ELSE 'Haupt' END")
      echo "$r"
    else echo "nicht erreichbar"; fi
  done
  docker exec cc_db psql -U cc -d cc -tAc "SELECT 'Replikation: ' || state || ', ' || COALESCE(replay_lag::text,'0') || ' hinterher' FROM pg_stat_replication" 2>/dev/null || true
}
kopie_neu() {
  echo "Kopie wird verworfen und neu von cc_db geholt …"
  docker compose rm -sf cc_db_replica >/dev/null 2>&1 || true          # Container ganz weg, bevor Dateien gelöscht werden
  if docker ps -a --format '{{.Names}}' | grep -qx cc_db_replica; then echo "cc_db_replica lässt sich nicht stoppen – abgebrochen"; exit 1; fi
  docker run --rm -v "$PWD/daten-replica:/d" alpine:3.22 sh -c 'find /d -mindepth 1 -delete'
  docker exec cc_db psql -U cc -d cc -qtc "SELECT pg_drop_replication_slot('cc_replica') WHERE EXISTS (SELECT FROM pg_replication_slots WHERE slot_name='cc_replica' AND NOT active)" >/dev/null || true
  docker exec cc_db psql -U cc -d cc -qtc "SELECT pg_create_physical_replication_slot('cc_replica') WHERE NOT EXISTS (SELECT FROM pg_replication_slots WHERE slot_name='cc_replica')" >/dev/null
  docker compose up -d cc_db_replica >/dev/null
  for i in $(seq 1 30); do [[ "$(docker inspect -f '{{.State.Health.Status}}' cc_db_replica)" == healthy ]] && break; sleep 2; done
  status
}
case "${1:-status}" in
  status) status ;;
  befoerdern)
    if docker exec cc_db pg_isready -U cc -d cc -q 2>/dev/null; then
      read -rp "cc_db läuft noch! Trotzdem stoppen und die Kopie befördern? [j/N] " a; [[ "$a" == j ]] || exit 1
    fi
    docker compose stop cc_db >/dev/null 2>&1 || true
    docker exec cc_db_replica psql -U cc -d cc -tAc "SELECT pg_promote()"
    echo "cc_db_replica ist jetzt Haupt-Datenbank. cc_db bleibt gestoppt (restart: unless-stopped greift nicht nach 'stop')."
    status ;;
  zurueck)
    echo "cc_db wird wieder Haupt, die Kopie neu aufgebaut (Inhalt der beförderten Kopie wird verworfen – nur Zwischenspeicher)."
    docker compose start cc_db >/dev/null
    for i in $(seq 1 30); do docker exec cc_db pg_isready -U cc -d cc -q 2>/dev/null && break; sleep 2; done
    kopie_neu ;;
  kopie-neu) kopie_neu ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
