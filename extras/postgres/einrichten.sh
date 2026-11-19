#!/usr/bin/env bash
# PostgreSQL (cc_db + Kopie cc_db_replica) für den Schnellspeicher einrichten. Idempotent.
#   sudo ./einrichten.sh     danach: sudo command-center neustart
set -euo pipefail
cd "$(dirname "$0")"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo."; exit 1; }
umask 077
[ -f .env ] || printf 'POSTGRES_PASSWORD=%s\nREPL_PASSWORD=%s\n' "$(openssl rand -hex 20)" "$(openssl rand -hex 20)" > .env
mkdir -p daten daten-replica
docker compose up -d cc_db
for i in $(seq 1 30); do docker exec cc_db pg_isready -U cc -d cc -q 2>/dev/null && break; sleep 2; done
set -a; . ./.env; set +a
docker exec -i -e RP="$REPL_PASSWORD" cc_db sh -s <<'S'
psql -U cc -d cc -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='replikator') THEN CREATE ROLE replikator WITH REPLICATION LOGIN; END IF; END \$\$;"
psql -U cc -d cc -qc "ALTER ROLE replikator PASSWORD '$RP'"
psql -U cc -d cc -qtc "SELECT pg_create_physical_replication_slot('cc_replica') WHERE NOT EXISTS (SELECT FROM pg_replication_slots WHERE slot_name='cc_replica')" >/dev/null
grep -q replikator "$PGDATA/pg_hba.conf" || echo "host replication replikator 10.250.76.0/28 scram-sha-256" >> "$PGDATA/pg_hba.conf"
psql -U cc -d cc -qtc "SELECT pg_reload_conf()" >/dev/null
S
docker compose up -d cc_db_replica
install -d -m 755 /var/lib/linux-dashboard
printf 'POSTGRES_PASSWORD=%s\nPGPORTS=5439,5440\n' "$POSTGRES_PASSWORD" > /var/lib/linux-dashboard/pg.env
chmod 600 /var/lib/linux-dashboard/pg.env
echo "Fertig. Jetzt: sudo command-center neustart  (Status: Einstellungen → Datenbank)"
