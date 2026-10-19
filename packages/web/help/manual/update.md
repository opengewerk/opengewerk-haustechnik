# Update

Ein Update ist derselbe Befehl wie die Installation. Er baut das Abbild neu, migriert die Datenbank und tauscht erst danach die laufenden Container. Scheitert die Migration, arbeitet die Instanz auf dem Stand davor weiter.

## Schritt für Schritt

1. Vorher sichern: `docker compose -f docker/compose.yaml --profile backup run --rm backup backup.sh`
2. Den neuen Stand holen: `git pull` und danach `git submodule update --init`
3. Starten: `sh docker/start.sh`
4. Im Browser anmelden und nachsehen, ob alles steht.

## Auf den Geräten

Ein Gerät, auf dem die Anwendung offen ist, übernimmt die neue Fassung von selbst und lädt die Seite dafür einmal neu: beim nächsten Öffnen, wenn die Seite in den Hintergrund geht, oder beim Wechsel auf eine andere Seite. Solange ein Formular Eingaben hält, die nicht gespeichert sind, eine Unterschrift läuft oder das Gerät kein Netz hat, bleibt es bei seiner Fassung. So wird niemandem ein Formular unter den Händen ausgetauscht. Eine Seite, die lange offen steht, etwa auf einem Tablet im Technikraum, fragt jede Stunde nach einer neuen Fassung.
