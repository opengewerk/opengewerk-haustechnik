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
