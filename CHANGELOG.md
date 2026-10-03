# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Initiales Repository-Gerüst: README, Lizenz, Vorlagen für Issues und Pull Requests
- Planungskonzept v0.1 unter `docs/konzept/`: Leitentscheidungen, Datenmodell vom Ort bis
  zum Nachweis, Funktionsumfang, Pflichtenpakete, rechtliche Anforderungen mit Fundstellen,
  die am 01.10.2026 gegen die amtlichen Texte geprüft sind, und der Fahrplan in sieben
  Phasen
- CI mit den Prüfungen "Kodierung und Zeilenenden" und "Schreibweise", wie in den anderen
  Repositories der Organisation: UTF-8 ohne BOM, LF, keine Gedankenstriche, keine
  umgeschriebenen Umlaute, geprüft am ganzen Bestand und nicht nur am Diff
- CodeQL, das die zu prüfenden Sprachen aus dem Dateibestand ermittelt, und Dependabot für
  die Actions der Workflows
- Der Arbeitsbereich: das Repository `opengewerk` ist als Git-Submodul unter
  `upstream/opengewerk` eingebunden, auf einem festen Commit, und seine Pakete unter
  `packages/platform/` sind Mitglieder des Arbeitsbereichs (ADR 0010 dort). Compiler-Optionen,
  Lint-Regeln, Testbasis und Formatierung werden aus dem Submodul gelesen und nicht
  abgeschrieben; `pnpm run check:toolchain` vergleicht die Fassungen der Werkzeuge mit denen
  des Fundaments. Das erste eigene Paket ist `@opengewerk/haustechnik-domain`. Ein Import aus
  der Handwerkersoftware am Fundament vorbei scheitert im Lint und an einem Test, der die
  `package.json` des Pakets liest
- CI-Job "Typprüfung, Lint und Tests" über alle Mitglieder des Arbeitsbereichs, die Pakete
  des Fundaments eingeschlossen. Er wird rot, wenn das Submodul auf einen Commit zeigt, der
  nicht auf `main` des Fundaments liegt, oder wenn die Werkzeuge von denen des Fundaments
  abweichen. Dependabot schlägt den neuen Stand des Fundaments wöchentlich vor
- ADR 0001, Derselbe Stack, das Fundament als Submodul: welche Architekturentscheidungen der
  Handwerkersoftware hier gelten, wie das Repository aufgebaut ist, wie die Pakete heißen und
  was diese Anwendung selbst nennt, damit sie neben der Handwerkersoftware auf demselben
  Server laufen kann
- Die Serverseite des Fundaments ist Mitglied des Arbeitsbereichs: `@opengewerk/platform-server`
  mit Datenbankzugriff, Migrationslauf, den Tabellen für Betreiber, Konten, Zugehörigkeiten,
  Audit-Log und Abgleich und den SQL-Bausteinen, aus denen die erste Migration dieser Anwendung
  entsteht. Ihre Tests laufen damit auch hier, in der CI gegen ein PostgreSQL 18 als Dienst und
  lokal gegen eine eigene Testdatenbank aus `docker/compose.test.yaml` auf Port 5434.
  `pnpm run test` richtet jedes Paket auf sie aus, damit die Tests des Fundaments nicht die
  Testdatenbank eines anderen Repositorys leeren, die auf demselben Rechner läuft
- ADR 0002 bis 0006, die Entscheidungen vor der ersten Tabelle: das Datenmodell vom Ort bis
  zum Nachweis mit den Namen im Code, die Zuständigkeitsbereiche in der Datenbank samt einer
  Messung gegen PostgreSQL 18 (eine Policy, die ihre Funktionen direkt aufruft, ist
  zweihundertmal langsamer als dieselbe mit Unterabfragen), der Nachweis mit eingefrorenem
  Stand und Fingerabdruck, die Pakete als Daten mit unveränderlichen Fassungen, und die
  Regeln dafür, was ein Gerät ohne Netz hält, anlegt und ändert
- Der Server dieser Anwendung beginnt mit ihrer Datenbank: das Paket
  `@opengewerk/haustechnik-server` mit dem Schema, der ersten Migration `0000_foundation` samt
  Rücknahme und dem Befehl `migrate`, der Migrationen als Eigentümer der Tabellen einspielt. Die
  Migration legt in einer leeren Datenbank an, was jede Anwendung der Organisation trägt:
  Betreiber, Konten und Sitzungen, Zugehörigkeiten und Einladungen, Rollen, das Audit-Log mit
  Hashkette, die Tabellen des Abgleichs, Nummernkreise, versiegelte Zugangsdaten und den Bereich
  der Instanz. Sie ist aus den Schema-Modulen und SQL-Bausteinen des Fundaments zusammengesetzt
  und nicht abgeschrieben. Die Nummernkreise dieser Anwendung sind `asset` für die Anlagennummer,
  `work_order` für die Nummer eines Auftrags und `evidence` für den Nachweis, der eine Zweck
  versiegelter Zugangsdaten ist `smtp_password`; die Einstellungen mit Gültigkeitszeitraum kommen
  mit der ersten Einstellung (ADR 0001, Nachträge vom 02.10.2026)
- Tests gegen die echte Datenbank, migriert als Eigentümer der Tabellen und nicht als Superuser,
  für den keine Policy gilt. Eine leere Datenbank ist nach dem Lauf bereit, und ein zweiter Lauf
  tut nichts; eine geänderte Migration wird abgelehnt; schlägt eine von mehreren fehl, bleibt die
  Datenbank auf dem Stand davor; die Rücknahme führt zu einer leeren Datenbank. Zwei Betreiber
  bekommen in jeder Tabelle eine Zeile, und geprüft wird je Tabelle, aus dem Katalog der
  Datenbank und nicht aus einer Liste, dass jeder nur seine sieht, keiner dem anderen eine
  schreibt, ändert oder löscht, und dass von innen nichts von dem zu sehen ist, was der Instanz
  gehört. Eine Tabelle, die eine spätere Migration ohne `FORCE`, ohne Policy, ohne Recht, ohne
  Audit-Trigger oder ohne eine Zeile in diesem Test bringt, macht ihn rot. Dazu der Vergleich
  der Datenbank mit den Bausteinen des Fundaments, der anzeigt, wenn das Fundament sich bewegt
  hat und diese Anwendung eine Migration schuldet
- Rechte und Rollen dieser Anwendung. Der Katalog der Rechte steht in `packages/domain`: lesen
  und schreiben für Ort, Anlagen, Pflichten, Vorgänge, Nachweise und Mängel, dazu Zugänge,
  Einstellungen und Änderungsprotokoll, jedes mit einem Schlüssel aus Ding und Tätigkeit und
  einer Bezeichnung in Worten. Wo das Konzept zwei Wörter für dasselbe Ding hat, sind es zwei
  Rechte: Anlagen aufnehmen und pflegen, Vorgänge ausführen, planen und abnehmen, Mängel
  melden und führen. Ein Betreiber beginnt mit den vier Rollen aus Phase 1, Leitung, Technische
  Leitung, Objektleitung und Haustechnik, geschrieben als Zeilen, sobald er entsteht. Die
  Leitung führt den Betreiber und arbeitet nur mit zweitem Faktor; beides sind Angaben der Rolle
  und keine Rechte, und die letzte Leitung lässt sich weder herabstufen noch sperren. Kein
  Recht ändert oder löscht einen Nachweis, ersetzt eine Unterschrift oder überspringt eine
  Abnahme
- Die Schnittstelle des Servers beginnt mit dem, was das Fundament mitbringt: Ersteinrichtung
  mit Einrichtungscode, Einmal-Link, Konto und Geräte, die Verwaltung der Zugänge und der
  Bereich der Instanz, hinter dem Guard und in den Worten dieser Anwendung (Betreiber, Leitung,
  Verwaltung der Instanz). Gestartet wird sie noch nicht, und eine Einladung geht als Link
  hinaus, bis ein Betreiber seinen Mailserver einrichten kann
- Tests dazu: je Rolle, was sie darf und was nicht; die Tabelle in Abschnitt 7 des Konzepts
  gegen den Katalog, sodass ein Recht, das nur an einer der beiden Stellen steht, anders heißt
  oder einer anderen Rolle gehört, den Lauf rot macht; jede Route des Moduls gegen den Guard,
  mit den Routen ohne Anmeldung als Liste, die sich nur mit Absicht verlängert; und gegen die
  echte Datenbank der Weg von der leeren Instanz über die Ersteinrichtung bis zur Anmeldung, bei
  der die Leitung ohne zweiten Faktor nicht weiterkommt
- Die Oberfläche beginnt mit ihrer Hülle (#13, erster Teil): das Paket
  `@opengewerk/haustechnik-web` mit den beiden Einstiegen `/` für das Büro und `/m` für die
  Arbeit vor Ort, mit Tor, Anmeldung, Ersteinrichtung, Einladung, zweitem Faktor, "Konto",
  "Zugänge", dem Bereich der Instanz, der Leiste des Abgleichs und dem Konfliktbildschirm aus dem
  Fundament. Was diese Anwendung dazu sagt, sagt sie in ihren Worten: der Mandant ist der
  Betreiber, wer ihn führt, die Leitung, wer die Instanz betreibt, die Verwaltung der Instanz,
  und die Einstiege heißen "Büro" und "Vor Ort". Name, Symbol und beide Manifeste tragen
  "OpenGewerk Haustechnik"; die Markendateien liegen als die eine erlaubte Kopie unter
  `assets/brand`. Bis die Datensätze aus Phase 1 eigene Listen haben, beginnt das Büro bei den
  Einstellungen und der Einstieg vor Ort bei den Konflikten. Die CI prüft das Bündelbudget je
  Einstieg (gebaut 150 kB vor Ort und 168 kB im Büro, Grenzen 300 und 450 kB) und den Bau auf
  Wörter der Handwerkersoftware für Betreiber, Leitung und den Einstieg vor Ort. Der Einstieg
  vor Ort öffnet auf einem Gerät, das schon angemeldet war, auch ohne Netz

### Geändert

- Planungskonzept auf v0.2: die Entscheidungen vom 01.10.2026 stehen an ihren Stellen, und
  Abschnitt 15 nennt sie im Zusammenhang. Das Fundament kommt als Pakete aus dem Repository
  `opengewerk` und wird nicht abgeschrieben; die Zuständigkeitsbereiche erzwingt die
  Datenbank; alle sieben Pflichtenpakete erscheinen vollständig vor Version 1, zuerst mit
  dem, was staatliches Recht hergibt; eigene Rollen kommen in Phase 2. Lager und
  Auswertungen rücken im Fahrplan nach Phase 2, weil der Pilotbetrieb sie braucht, bevor er
  seine bisherige Anwendung abschaltet
- Planungskonzept auf v0.3: die Technik, mit der das Fundament eingebunden wird, ist
  entschieden (Git-Submodul auf einem festen Commit) und steht nicht mehr unter den offenen
  Punkten; die Anlässe der Benachrichtigungen stehen in der Zuordnung bei Phase 0
- Die Prüfungen "Kodierung und Zeilenenden" und "Schreibweise" überspringen den Eintrag
  eines Submoduls. Seine Dateien werden in dem Repository geprüft, zu dem sie gehören
- Planungskonzept auf v0.4: Abschnitt 5 nennt `abnahmen.json`, in der Prüfung und Abnahme
  eines Katalogeintrags neben ihm stehen, und sagt, dass Regeln fortgeschrieben und berichtigt
  statt neu gefasst werden (ADR 0005). Wer eine Instanz betreibt, heißt durchgehend
  "Verwaltung der Instanz", damit "Betreiber" in der Oberfläche nur eines bedeutet
- Das Fundament ist auf den Stand mit der Anmeldung angehoben (`opengewerk/opengewerk#473`,
  `#475` und `#476`). Der Guard vor jeder Route mit Herkunftsprüfung und Sicherheits-Headern,
  Konten mit Passwort, zweitem Faktor und Passkeys, Sitzungen je Gerät, die Ersteinrichtung
  mit Einrichtungscode, der Einmal-Link und die Verwaltung der Zugänge liegen damit in
  `@opengewerk/platform-server` und kommen von dort, statt hier ein zweites Mal zu entstehen.
  Wie ein Mandant und seine Rollen in dieser Anwendung heißen, sagt sie dem Fundament selbst;
  gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen in der CI dieses
  Repositorys mit, 328 statt 154
- Das Fundament ist auf den Stand mit den Rollen als Zeilen angehoben
  (`opengewerk/opengewerk#477` und `#479`). Was jemand bei einem Betreiber darf, steht damit in
  Zeilen des Betreibers (`tenant_roles`): je Rolle der Schlüssel, die Bezeichnung, die Rechte
  und zwei Angaben, ob sie den Betreiber führt und ob sie einen zweiten Faktor verlangt. Die
  Rechte dieser Anwendung werden ihr eigener Katalog, ihre Rollen die Zeilen, mit denen ein
  Betreiber beginnt; eigene Rollen eines Betreibers, wie Phase 2 sie vorsieht, sind dann
  weitere Zeilen und kein neuer Mechanismus. Die Oberfläche bekommt die Rechte je Betreiber vom
  Server und hält keine eigene Liste, was eine Rolle darf. Gebaut ist davon hier noch nichts.
  Die Tests des Fundaments dazu laufen in der CI dieses Repositorys mit, 351 statt 328
- Das Fundament ist auf den Stand mit Zugangsdaten, Nummernkreisen und dem Bereich der Instanz
  angehoben (`opengewerk/opengewerk#480` und `#481`). Versiegelte Zugangsdaten, Einstellungen
  mit Gültigkeitszeitraum und Nummernkreise sind damit Tabellen des Fundaments, die eine
  Anwendung mit ihren eigenen Listen anlegt: welche Zwecke, welche Einstellungen und welche
  Kreise es gibt, nennt diese Anwendung, den Mechanismus dahinter schreibt sie nicht noch
  einmal. Dazu kommt der Bereich der Instanz: wer sie verwaltet, ihre Einstellungen, ihr
  Protokoll, die Liste der Betreiber und der Weg zu einem weiteren Betreiber, samt den Befehlen
  `appoint-operator` und `add-tenant`. Jeden Satz, der dabei einen Betreiber, seine Leitung oder
  die Verwaltung der Instanz nennt, gibt diese Anwendung dem Fundament mit, damit er hier so
  heißt wie im Konzept. Gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen
  in der CI dieses Repositorys mit, 432 statt 351
- Das Fundament ist auf den Stand mit seiner Oberfläche angehoben (`opengewerk/opengewerk#482`
  bis `#497`). `@opengewerk/platform-web` ist damit Mitglied des Arbeitsbereichs: Tokens und
  Bausteine der Bildschirme, der Abgleich auf dem Gerät, die Sitzung, das Tor vor der Anmeldung,
  die Hülle der beiden Einstiege, "Konto", die Zugänge und der Bereich der Instanz, Kamera, Scan
  und Unterschrift, der Konfliktbildschirm, Service Worker und Manifeste und die Prüfungen der CI
  als Werkzeug. Wie diese Anwendung heißt und was sie dazu sagt, gibt sie dem Fundament einmal
  als Wert mit, wenn ihre Oberfläche entsteht (#13); gebaut ist davon hier noch nichts. Dazu
  heißt der Kopf, in dem eine Seite ihren Betreiber nennt, jetzt `x-opengewerk-tenant`, und die
  Pfade, die der Server des Fundaments selbst beantwortet, stehen als `foundationPaths` in
  `platform-domain`. Die Tests des Fundaments laufen in der CI dieses Repositorys mit: 95 in
  `platform-domain`, 437 in `platform-server` und 693 in `platform-web`
- Das Fundament ist auf den Stand mit seinem Betrieb angehoben (`opengewerk/opengewerk#498` bis
  `#500`, #14). Der Einstieg des Servers liegt damit in `@opengewerk/platform-server`: die
  Gesundheitsprüfung unter `/health`, das Ausliefern der Oberfläche, der Server mit allem, was
  vor den Routen steht, das Herunterfahren in fester Reihenfolge und die Zeile beim Start.
  Einrichten, Starten und Sichern sind Skripte des Fundaments, die den Namen einer Anwendung und
  den Anfang ihrer Variablen aus ihrer `application.env` lesen, und die drei CI-Läufe auf einem
  ganzen Stapel sind Schritte, die eine Anwendung mit ihrem Material füllt. Benutzt wird davon
  hier noch nichts, das kommt mit dem eigenen Betrieb (#15). Dem Fundament sagt diese Anwendung
  dafür einen Satz mehr, den das Protokoll beim Start einer leeren Instanz schreibt: dass die
  Ersteinrichtung im Browser den Betreiber und den ersten Zugang anlegt. Die Tests des
  Fundaments laufen in der CI dieses Repositorys mit, in `platform-server` jetzt 479 statt 437
- Das Fundament ist auf den Stand mit dem Abgleich auf dem Server angehoben
  (`opengewerk/opengewerk#501` und `#502`, #21). Das Anwenden der Vorgänge eines Geräts, die
  Konflikte und der Abruf nach der Änderungsnummer liegen damit in
  `@opengewerk/platform-server`, ebenso die Routen unter `/sync`, denen eine Anwendung das Recht
  je Vorgang, ihre Worte für eine Ablehnung der Datenbank und die Auswahl je Gerät mitgibt. Hier
  gebunden werden die Routen mit der Leiste des Abgleichs (#13), die Richtlinien je Entität und
  die Auswahl nach Bereich mit #27. Die Tests des Fundaments laufen in der CI dieses Repositorys
  mit, in `platform-server` jetzt 526 statt 479
- Das Fundament ist auf den Stand mit den neuesten Fassungen seiner Werkzeuge angehoben
  (`opengewerk/opengewerk#503`): `vite` 8.3.2, `vitest` 5.0.3, `@tanstack/react-router`
  1.170.41, `@tanstack/react-query` 5.104.0 und `lucide-react` 1.49.0. Die Oberfläche dieser
  Anwendung beginnt damit auf der neuesten Fassung, und `vitest` steht hier wie dort auf 5.0.3.
  `@opengewerk/haustechnik-domain` sagt jetzt, dass das Laden eines Moduls nichts tut
  (`sideEffects: false`), damit der Service Worker nur die eine Liste mitnimmt, die er braucht
- `pnpm run check:toolchain` vergleicht auch die Fassungen der Abhängigkeiten, die ein Paket
  dieser Anwendung und ein Paket des Fundaments beide laden, zuerst `drizzle-orm` und `pg`. Zwei
  Fassungen davon in einem Prozess hießen Tabellen, die mit der einen angelegt und mit der
  anderen abgefragt werden; die Prüfung wird rot, sobald das Fundament eine Fassung hebt und die
  Anwendung nicht folgt
- Planungskonzept auf v0.5: Abschnitt 7 nennt für die vier Rollen aus Phase 1 jedes Recht
  einzeln, in den Worten, die ein Betreiber liest, wenn ihm eines fehlt. Zugänge, Einstellungen
  und Änderungsprotokoll hat nur die Leitung; die Struktur der Liegenschaften, das
  Pflichtenverzeichnis und die Fristen pflegen Leitung und Technische Leitung; die
  Objektleitung plant, verteilt und nimmt ab und pflegt die Anlagen ihrer Bereiche. ADR 0002
  nennt im Nachtrag die Namen für den Ort, die Rechte und die Rollen im Code

### Behoben

- Der Nummernkreis für Aufträge fehlte in der Ausgangsmigration. Das Konzept nennt für das
  Fundament drei Kreise, für Anlagen, Nachweise und Aufträge (Abschnitt 12, Phase 0; Abschnitt
  4.8; ADR 0002, Punkt 13); angelegt waren zwei. Die Migration `0001_work_order_numbers` trägt
  den dritten nach, an seiner Stelle zwischen Anlage und Nachweis, mit Rücknahme. Eine gemergte
  Migration wird nicht geändert, deshalb eine zweite. Dazu die ersten Tests für ein Update: eine
  Datenbank auf dem Stand der ersten Migration, mit Zählern eines Betreibers, bekommt den Kreis
  und behält ihre Zähler; die Rücknahme entfernt nur den Zähler der Aufträge und schreibt den
  Grund in das Protokoll des Betreibers
- Die README nannte für die Tests eines einzelnen Pakets den Aufruf
  `pnpm run test -- --filter=<paket>`. pnpm reicht das `--` mit weiter, der Filter landet dann
  beim Testläufer jedes Pakets, und der kennt ihn nicht. Richtig ist
  `pnpm run test --filter=<paket>`
