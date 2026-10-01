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

### Geändert

- Planungskonzept auf v0.2: die Entscheidungen vom 01.10.2026 stehen an ihren Stellen, und
  Abschnitt 15 nennt sie im Zusammenhang. Das Fundament kommt als Pakete aus dem Repository
  `opengewerk` und wird nicht abgeschrieben; die Zuständigkeitsbereiche erzwingt die
  Datenbank; alle sieben Pflichtenpakete erscheinen vollständig vor Version 1, zuerst mit
  dem, was staatliches Recht hergibt; eigene Rollen kommen in Phase 2. Lager und
  Auswertungen rücken im Fahrplan nach Phase 2, weil der Pilotbetrieb sie braucht, bevor er
  seine bisherige Anwendung abschaltet
