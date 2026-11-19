#!/bin/sh
# Start der Kopie (cc_db_replica): beim ersten Mal Grundstand von cc_db holen (pg_basebackup, Slot cc_replica),
# danach normal als „hot standby“ starten – sie folgt cc_db laufend (Streaming-Replikation) und ist nur lesbar.
set -e
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Kopie leer – hole Grundstand von cc_db …"
  mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"; chmod 700 "$PGDATA"
  until su-exec postgres pg_isready -h cc_db -p 5432 -q; do sleep 2; done
  PGPASSWORD="$REPL_PASSWORD" su-exec postgres pg_basebackup -h cc_db -p 5432 -U replikator -D "$PGDATA" -R -X stream -S cc_replica -c fast
  echo "Grundstand da – starte als Kopie."
fi
unset REPL_PASSWORD
exec docker-entrypoint.sh "$@"
