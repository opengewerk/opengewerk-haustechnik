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
