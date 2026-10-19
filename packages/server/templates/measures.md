# Technische und organisatorische Maßnahmen{{for}}

- **Gilt für:** {{holds-for}}
- **Erzeugt:** {{made}}
- **Teil B und Anlage 2:** {{part-b-changed}}

---

## Was dieses Dokument ist

Die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO, als Anlage 1 zum Vertrag zur Auftragsverarbeitung. Teil A sagt, was die Anwendung mitbringt, und ist auf jeder Instanz derselben Fassung gleich. Jede Aussage nennt in eckigen Klammern ihre Belege aus Anhang A der Verfahrensbeschreibung: einen Test, der sie bei jeder Änderung am Quelltext prüft, oder die Stelle im Quelltext; was die Anwendung noch nicht kann, nennt den Abschnitt des Planungskonzepts. Teil B und Anlage 2 trägt ein, wer die Instanz betreibt, im Bereich der Instanz unter „Maßnahmen“.

## Teil A: Was die Anwendung mitbringt

### A.1 Anmeldung

- Ein Konto entsteht nur bei der Ersteinrichtung, über eine Einladung oder über die Kommandozeile des Servers; eine offene Registrierung gibt es nicht. Der Link einer Einladung gilt sieben Tage. [B71, B63]
- Angemeldet wird mit Passwort oder Passkey. Das Passwort steht nur als Hash in der Datenbank (Argon2id). [B410, B52]
- Der zweite Faktor, ein Code aus einer App, ist Pflicht für die Rolle Leitung und für die Verwaltung der Instanz und für alle anderen empfohlen. Er und seine Wiederherstellungscodes stehen verschlüsselt in der Datenbank (AES-256-GCM). [B36, B412, B411]
- Versuche der Anmeldung werden je Netzadresse und Weg für kurze Zeit gezählt und begrenzt. [B46]
- Eine Sitzung endet nach zwölf Stunden, ein Gerät für die Arbeit ohne Netz bleibt dreißig Tage angemeldet. Jede Person sieht und beendet ihre Sitzungen, die Leitung meldet Geräte ihrer Beschäftigten ab. Wird eine Zugehörigkeit gesperrt oder ist ihr letzter Tag vorbei, endet, was die Person dort offen hat. [B44, B42, B49, B51, B388]
- Das Cookie der Sitzung geht nur über eine verschlüsselte Verbindung, und Anfragen, die von einer fremden Seite kommen, nimmt der Server nicht an. [B413, B414]

### A.2 Rechte und Trennung

- Jede Rolle hat feste Rechte, die mitgelieferten wie die eigenen eines Betreibers, und eine eigene Rolle bekommt kein Recht, das der Leitung vorbehalten ist. Der Server prüft das Recht an jeder Adresse, die er beantwortet. [B15, B17, B382]
- Die Datenbank trennt die Betreiber einer Instanz Zeile für Zeile, auch gegenüber dem Eigentümer der Tabellen. Zwei Betreiber auf derselben Instanz sehen nichts voneinander. [B56]
- Zuständigkeitsbereiche setzt ebenfalls die Datenbank durch: eine Person sieht nur die Liegenschaften ihrer Bereiche, und ihr Gerät hält nur diese. [B19, B21]
- Ein Prüfer von außen liest nur Pflichten und Nachweise der Liegenschaften und Anlagenarten seines Zugangs und ändert nichts; nach dem letzten Tag seines Zugangs sieht er nichts mehr, und jeder seiner Zugriffe wird aufgeschrieben. [B346, B347, B348, B350, B351]
- Wer die Instanz verwaltet, sieht je Betreiber den Namen, wer ihn leitet, und wie viele dort arbeiten, und nichts von dem, was in ihm steht. [B59]
- Das Änderungsprotokoll und die Zugänge sieht nur die Leitung. [B1, B3, B14]
- Eine Tabelle zum Herunterladen bekommt nur, wer die Liste sehen darf, und eine Person nennt sie nur der Leitung. [B179, B186]

### A.3 Übertragung

- Die Anwendung verlangt eine verschlüsselte Verbindung: das Cookie der Sitzung ist darauf beschränkt, und der Server setzt Strict-Transport-Security. Die Verschlüsselung selbst stellt der vorgeschaltete Webserver her (B.4). [B413, B415]
- Eine Content-Security-Policy erlaubt dem Browser nur Verbindungen zur eigenen Instanz. Inhalte von fremden Servern, Telemetrie und einen Lizenzserver gibt es nicht. [B416]
- E-Mails an ein Konto gehen über den Mailserver der Instanz, E-Mails eines Betreibers über dessen eigenen. Das Passwort eines Mailservers steht versiegelt in der Datenbank (AES-256-GCM) und wird nie wieder angezeigt. [B254, B252, B411]
- Eine Benachrichtigung nennt, was ansteht, und den Tag, aber keinen Namen, keinen Ort und keinen eingetippten Text. Eine Push-Nachricht ist auf dem Weg über den Push-Dienst verschlüsselt. [B229, B230, B417]
- Die Geräte gleichen über dieselbe verschlüsselte Verbindung ab. Wer einen Datensatz zuletzt geändert hat, wann und von welchem Gerät, bekommt kein Gerät. [B162]

### A.4 Integrität und Eingabekontrolle

- Jede Änderung an einem Datensatz steht im Änderungsprotokoll, Feld für Feld mit dem Wert davor und danach, mit Person, Zeitpunkt, Gerät und Weg. [B31]
- Das Protokoll wird nur ergänzt. Keinen Eintrag ändert oder löscht jemand, auch nicht der Eigentümer der Tabellen; jeder Eintrag verweist über einen Fingerabdruck auf seinen Vorgänger, und eine Prüfung der Kette findet einen Eintrag, der an der Anwendung vorbei verändert wurde. Einen Wert schwärzt nur die Leitung, mit Grund, und die Kette bleibt dabei ganz. [B54, B55, B405, B407]
- Ein Nachweis wird beim Festschreiben eingefroren, mit einer Prüfsumme (SHA-256) über seinen Stand, die der Server berechnet. Berichtigt wird er durch einen neuen Nachweis, der den alten nennt. [B93, B151, B94]
- Unterschrieben wird im Namen des angemeldeten Kontos. Die Person setzt der Server ein, nicht das Gerät. [B152, B153]
- Was jemand entfernt, wird als entfernt markiert und nicht gelöscht; die Anwendung hat in der Datenbank kein Recht, eine solche Zeile zu löschen. Gelöscht oder geleert wird nur, was das Löschkonzept nennt. [B34, B60]
- Abgelegte Dateien liegen unter der Prüfsumme ihres Inhalts, und das Rückspielen einer Sicherung prüft jede Datei dagegen. [B74, B418]

### A.5 Verfügbarkeit und Wiederherstellung

- Jede Nacht sichert die Instanz Datenbank und Dateispeicher zusammen in ein Archiv und holt eine verpasste Sicherung nach. Nach der Vorgabe bleiben vierzehn Generationen. [B64]
- Ein Archiv lässt sich an einen öffentlichen Schlüssel verschlüsseln (age), dessen privater Teil an einem anderen Ort liegt. Ohne Schlüssel entsteht es unverschlüsselt. [B419]
- Zum Rückspielen und zum Prüfen eines Archivs gibt es je einen Befehl. Wann zuletzt gesichert wurde, zeigen die Einstellungen; ist die letzte Sicherung älter als zwei Tage, steht im Büro eine rote Leiste. [B420, B421]
- Ein Update spielt zuerst die Migrationen ein und tauscht erst danach die laufenden Container. Scheitert eine Migration, arbeitet die Instanz auf dem Stand davor weiter. [B422]
- Ohne Netz arbeiten die Geräte vor Ort weiter und gleichen ab, sobald es wieder Netz gibt. [B22, B145]

### A.6 Geräte der Nutzer

- Ein Gerät hält nur, was seine Person nach ihren Bereichen sieht, und das eines Prüfers nur, was sein Zugang erlaubt. [B21, B355]
- Beim Abmelden löscht die Anwendung die lokale Ablage des Geräts, für jeden Betreiber, bei dem die Person angemeldet war. [B58]

### A.7 Datenschutz durch Technikgestaltung

- Keine Statistik, keine Rangliste und keine Zahl je Person: Auswertungen nennen niemanden und gruppieren nach keiner Person. [B321, B158]
- Push schaltet jede Person für sich selbst ein und wählt die Anlässe; der Betreiber hat dafür keinen Schalter. [B234, B235]
- Was die Anwendung über eine Person hält, gibt sie als Auskunft vollständig heraus, und die Angaben eines beendeten Zugangs entfernt sie nach der Frist, die der Betreiber einstellt. [B399, B392]

### A.8 Regelmäßige Überprüfung

- Jede Zusage der Verfahrensbeschreibung hat einen Test, der bei jeder Änderung am Quelltext läuft, und ein Test hält die Verfahrensbeschreibung und diese Maßnahmen selbst gegen den Quelltext. [B397, B40, B41, B426]
- Jede Änderung durchläuft vor der Übernahme eine Prüfung auf Sicherheit und eine statische Analyse des Quelltexts. [B423, B424]
- Eine Sicherheitslücke wird über ein privates Formular gemeldet, behoben und als Advisory veröffentlicht. Die Korrektur bekommt die neueste Fassung. [B425]

### A.9 Was die Anwendung noch nicht selbst kann

- Was an keinem Nachweis hängt, löscht sie nicht nach einer Frist: Mängel, Aufgaben, Zählerstände, Buchungen im Lager und das Protokoll der Zugriffe eines Prüfers bleiben, solange die Instanz besteht. Das Löschkonzept nennt sie. [K9, K12]
- Ein Konto löscht sie nicht ganz: nach dem Ende eines Zugangs gehen Adresse, Passkeys und Geräte, der Name bleibt bei dem, was die Person unterschrieben hat. [K9, B392]
- Dateien, die als entfernt markiert sind, bleiben im Dateispeicher, bis das Fundament sie endgültig löscht. [K9]
- Die lokale Ablage eines Geräts verschlüsselt sie nicht eigens. Sie ist so geschützt wie das Gerät und sein Browser; Sperre und Verschlüsselung des Geräts sind Sache dessen, der es stellt. [K2.7]

## Teil B: Was der Auftragsverarbeiter beim Betrieb sicherstellt

{{part-b}}

## Anlage 2: Unterauftragsverarbeiter

{{subprocessors}}
