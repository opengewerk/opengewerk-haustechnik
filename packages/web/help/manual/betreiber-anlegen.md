# Betreiber anlegen

Ein Betreiber ist eine Organisation mit ihren Gebäuden, ihren Leuten und ihren Daten. Eine Instanz kann mehrere Betreiber führen, etwa für einen Dienstleister mit mehreren Auftraggebern. Jeder sieht nur das Eigene.

## Im Bereich der Instanz

1. Im Menü der Person „Instanz verwalten“ öffnen. Den Eintrag sieht, wer die Instanz verwaltet.
2. Unter „Betreiber“ einen neuen anlegen: der Name des Betreibers, dazu Name und E-Mail-Adresse seiner Leitung.
3. Die Leitung richtet danach ihren Betreiber ein: Bereiche, Zugänge und Liegenschaften.
4. Damit Einladungen und der Link zum Zurücksetzen eines Passworts per E-Mail hinausgehen, unter „Einstellungen“ den Mailserver der Instanz eintragen.
5. Unter „Verwaltung“ steht, wer die Instanz verwaltet. Sich selbst und das letzte Konto der Verwaltung entfernt niemand.

## Von der Kommandozeile

Die Kommandozeile ist der Rückweg, wenn sich jemand ausgesperrt hat, und der einzige Weg auf einem Rechner ohne Browser. Ein Passwort fragt jeder Befehl verdeckt ab.

- Einen Betreiber anlegen: `docker compose -f docker/compose.yaml exec app node dist/add-tenant.js "NAME DES BETREIBERS" E-MAIL "NAME DER LEITUNG"`
- Ein Passwort zurücksetzen: `docker compose -f docker/compose.yaml exec app node dist/reset-password.js E-MAIL`
- Jemanden in die Verwaltung der Instanz aufnehmen: `docker compose -f docker/compose.yaml exec app node dist/appoint-operator.js E-MAIL`
