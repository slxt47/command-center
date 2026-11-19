# Datenbank (Schnellspeicher)

Langsame Abfragen (Sicherheits-Meldungen aus großen Logs, Docker-Listen) landen in einem Zwischenspeicher: sofort der
letzte Stand, neu gerechnet im Hintergrund. Gespeichert wird in **SQLite** (`/var/lib/linux-dashboard/schnellspeicher.sqlite3`) –
ohne weitere Einrichtung.

## Optional: PostgreSQL mit Kopie

[`extras/postgres/`](../extras/postgres/) enthält eine gehärtete PostgreSQL-Datenbank (`cc_db`, nur `127.0.0.1:5439`)
und eine laufende Kopie per Streaming-Replikation (`cc_db_replica`, `127.0.0.1:5440`):

```bash
cd extras/postgres
sudo ./einrichten.sh          # Passwörter erzeugen, Container starten, Zugang für das Command Center hinterlegen
sudo command-center neustart
```

Dann gilt: lesen vom Haupt-Server, sonst von der Kopie; geschrieben wird in PostgreSQL **und** SQLite (warmer
Rückfall). Fällt alles aus, läuft das Command Center mit SQLite weiter. Status: Einstellungen → Datenbank.
Kopie zur Haupt-Datenbank machen (bewusst von Hand): `sudo ./umschalten.sh befoerdern`, zurück: `./umschalten.sh zurueck`.
