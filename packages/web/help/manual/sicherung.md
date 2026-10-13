# Sicherung und Rückspielen

Die Sicherung läuft jede Nacht von selbst, zu der Uhrzeit, die der Bereich der Instanz festlegt, und holt eine verpasste nach. Jede Sicherung nimmt die Datenbank und den Dateispeicher zusammen mit.

Wie ein Archiv verschlüsselt wird und wohin es gehört, steht in `docker/.env.example`. Eine Sicherung, die auf derselben Platte liegt wie die Instanz, schützt nicht vor dem Ausfall dieser Platte.

## Von Hand

- Sichern, etwa vor einem Update: `docker compose -f docker/compose.yaml --profile backup run --rm backup backup.sh`
- Prüfen, ob sich die letzte Sicherung lesen lässt: `docker compose -f docker/compose.yaml --profile backup run --rm backup verify.sh latest`
- Zurückspielen: `docker compose -f docker/compose.yaml --profile backup run --rm backup restore.sh latest`

## Beim Rückspielen

1. Das Rückspielen ersetzt den Stand der Instanz durch den der Sicherung. Was danach eingetragen wurde, ist nicht mehr da.
2. Statt `latest` nennt der Befehl auch ein Archiv mit seinem Namen.
3. Jede Datei wird gegen ihre Prüfsumme geprüft.
4. Ein Archiv einer anderen Anwendung lehnen `restore.sh` und `verify.sh` ab.
