<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo-dark.svg">
    <img alt="OpenGewerk" src="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo.svg" width="420">
  </picture>
</p>

<p align="center"><strong>Self-hosted Software für Betreiber und ihre Haustechnik</strong></p>

## Was ist OpenGewerk Haustechnik?

OpenGewerk Haustechnik ist ein self-hosted Open-Source-System für alle, die Gebäude betreiben und dafür eigene Haustechniker haben: Kliniken und Pflegeeinrichtungen, Bildungsträger, Wohnungsunternehmen, Kommunen, kirchliche Träger, Unternehmen mit eigener Werks- oder Haustechnik. Liegenschaften, Gebäude, Räume und technische Anlagen stehen in einem Datenmodell. Der Leitsatz lautet **Die Betreiberpflicht ist der Kern, nicht die Checkliste**: gebaut wird um die Kette Anlage, Pflicht, Termin, Vorgang, Nachweis. Welche Prüfung für welche Anlagenart gilt, in welchem Abstand, durch wen und nach welcher Vorschrift, steht in offenen Pflichtenpaketen mit Fundstelle und Gültigkeitszeitraum. Das System schlägt vor, der Betreiber entscheidet. Rundgänge und Prüfungen laufen auf dem Telefon auch ohne Netz, und ein Nachweis lässt sich nach der Unterschrift nicht mehr ändern, auch nicht vom Administrator.

## Abgrenzung zu bestehenden Lösungen

| Bestehende Lösung | Schwäche | OpenGewerk Haustechnik |
| --- | --- | --- |
| Kommerzielle CAFM-Systeme | Lizenz je Arbeitsplatz, Nutzer oder Fläche; das Regelwerk ist eine zweite Lizenz bei einem Dritten; die mobile Lösung oft ein eigener Posten | Keine Lizenzkosten, keine Nutzerlimits, Pflichtenkatalog als offene Daten, Arbeit vor Ort im Kern |
| Quelloffene Instandhaltungssoftware | Kein deutscher Pflichtenkatalog, Fristen als freie Intervalle; App, Arbeit ohne Netz oder Wartungsplanung häufig nur in der bezahlten Fassung | Alles in einem Repository unter AGPL-3.0, Pflichten mit Fundstelle, Gültigkeit und Geltungsbereich |
| Mobile Checklisten-Werkzeuge | Formulare ohne Liegenschaft, Anlagenakte und Pflicht; fast immer nur in der Cloud | Der Rundgang hängt am selben Datenmodell wie Anlage, Pflicht und Nachweis |
| Excel-Listen und Papier | Ein Termin, der nie eingetragen wurde, fällt niemandem auf; ein Nachweis lässt sich nachträglich ändern | „Nie erfasst“ ist ein eigener Zustand vor „überfällig“; Nachweise sind eingefroren |

Wo die etablierten Systeme weiter sind und bleiben, steht ebenfalls im Konzept: Flächenmanagement mit CAD und BIM, Mietverwaltung, Anbindung an ERP-Systeme. OpenGewerk Haustechnik ist Software für den technischen Gebäudebetrieb, kein IWMS, und sie steuert keine Anlagen.

## Verhältnis zu OpenGewerk

Die Handwerkersoftware [`opengewerk`](https://github.com/opengewerk/opengewerk) führt Kunde, Objekt, Anlage, Auftrag und Beleg. OpenGewerk Haustechnik ist die Betreiberseite: Liegenschaft, Gebäude, Raum, Anlage, Pflicht und Nachweis, ohne Belege und ohne Buchhaltung. Beide stehen auf demselben Fundament: Mandantentrennung in der Datenbank, Anmeldung mit zweitem Faktor, Rechte, Abgleich ohne Netz, Änderungsprotokoll, Regel-, Fristen- und Formular-Engine. Die Architekturentscheidungen dazu stehen im Repository `opengewerk` unter [`docs/adr/`](https://github.com/opengewerk/opengewerk/tree/main/docs/adr).

## Status

OpenGewerk Haustechnik steht am Anfang von **Phase 0**, dem Fundament. Das Konzept ist ausgearbeitet, und der Arbeitsbereich bindet das Fundament der Handwerkersoftware ein; eine Anwendung, die man starten könnte, gibt es noch nicht. Ein Pilotbetrieb mit mehreren Liegenschaften steht bereit; Version 1 ist erreicht, wenn er seine bisherige Anwendung abschalten kann.

Das vollständige Konzept liegt unter [`docs/konzept/`](docs/konzept/), die Architekturentscheidungen dieser Anwendung unter [`docs/adr/`](docs/adr/). Was in Phase 0 gebaut wird, steht als Issues im Meilenstein [Phase 0: Fundament](https://github.com/opengewerk/opengewerk-haustechnik/milestone/1).

## Fahrplan

Der Fahrplan in sieben Phasen, vom Fundament bis zum Vollausbau, steht in [Abschnitt 12 des Planungskonzepts](docs/konzept/Planungskonzept.md#12-fahrplan) und bewusst nur dort. Eine Abschrift daneben läuft irgendwann auseinander.

## Am Code arbeiten

Vorausgesetzt werden Node 24 und ein aktiviertes Corepack; pnpm kommt in der Version, die im Wurzelpaket steht, und wird nicht von Hand installiert.

Das Fundament liegt im Repository `opengewerk` und ist hier als Git-Submodul unter `upstream/opengewerk` eingebunden, auf einem festen Commit. Geklont wird deshalb mit dem Submodul:

```bash
git clone --recurse-submodules https://github.com/opengewerk/opengewerk-haustechnik.git
```

Wer schon ohne geklont hat, holt es nach:

```bash
git submodule update --init
```

Danach:

```bash
pnpm install
pnpm run typecheck
pnpm run lint
pnpm run format:check
docker compose -f docker/compose.test.yaml up -d
pnpm run test
```

Die Prüfungen laufen über Turborepo und damit über alle Pakete, die des Fundaments eingeschlossen; dieselben Schritte laufen in der CI. `pnpm run check:toolchain` vergleicht die Fassungen der Werkzeuge mit denen des Fundaments. Warum das Repository so aufgebaut ist, steht in [ADR 0001](docs/adr/0001-stack-und-fundament.md).

Ein Teil der Tests braucht ein PostgreSQL 18 und leert es vor jedem Lauf. Dafür gibt es eine eigene Testdatenbank auf Port 5434, die `docker/compose.test.yaml` startet. `pnpm run test` an der Wurzel richtet jedes Paket auf sie aus, auch die des Fundaments, die sonst die Testdatenbank ihres eigenen Repositorys suchen. Einzelne Pakete also über die Wurzel prüfen, `pnpm run test -- --filter=<paket>`, oder `DATABASE_URL` selbst setzen. Der Name der Datenbank muss auf `_test` enden, sonst lehnen die Tests sie ab.

| Paket | Inhalt |
| --- | --- |
| [`packages/domain`](packages/domain) | Fachlichkeit ohne I/O. Reicht weiter, was das Fundament exportiert, damit Server und Oberfläche ein Paket fragen |
| `upstream/opengewerk/packages/platform/*` | Das Fundament: Mandantentrennung, Anmeldung, Rechte, Abgleich, Audit-Log. Wird im Repository `opengewerk` geändert, nie hier |

Server und Oberfläche entstehen mit ihrem ersten Inhalt: der Server mit der Ausgangsmigration, die Oberfläche mit ihrer Hülle.

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): die Handwerkersoftware, CRM und ERP für Handwerksbetriebe.
- [`opengewerk-haustechnik`](https://github.com/opengewerk/opengewerk-haustechnik): diese Anwendung, für Betreiber von Gebäuden und ihre Haustechnik.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Hub, mit dem eine Steuerberaterkanzlei ihre Mandanten aus einer Anwendung heraus bearbeitet.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der API-Vertrag zwischen Handwerkersoftware und Kanzlei-Hub.

## Mitmachen

Besonders wertvoll sind Rückmeldungen aus dem Betrieb: welche Prüfung im Alltag untergeht, welche Fundstelle im Pflichtenkatalog fehlt oder nicht stimmt, wo ein Rundgang heute noch auf Papier läuft. Wer vom Fach ist, ob Elektro, Brandschutz, Trinkwasser, Raumluft oder Aufzüge, kann einen Eintrag des Katalogs prüfen, ohne eine Zeile Code zu schreiben.

- Fragen, Ideen und alles ohne konkreten Vorschlag gehören in die [Discussions](https://github.com/opengewerk/opengewerk-haustechnik/discussions).
- Für kurze Fragen und zum Mitreden gibt es einen [Discord-Server](https://discord.gg/NRrEvbQdxz). Er ersetzt die Discussions nicht: ein Chatverlauf ist nicht durchsuchbar, und was dort geklärt wird und für andere zählt, gehört hinterher in eine Discussion oder ein Issue.
- Zum Austausch gibt es [r/OpenGewerk](https://www.reddit.com/r/OpenGewerk/) auf Reddit. Was dort als Fehler oder Wunsch übrig bleibt, gehört als Issue hierher.
- Konkrete Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk-haustechnik/issues/new/choose).
- Sicherheitslücken bitte nicht als öffentliches Issue, sondern über das [private Sicherheitsformular](https://github.com/opengewerk/opengewerk-haustechnik/security/advisories/new). Das Verfahren steht in der [SECURITY.md](https://github.com/opengewerk/.github/blob/main/SECURITY.md) der Organisation.
- Die Beitragsregeln stehen in [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md), der Verhaltenskodex in [CODE_OF_CONDUCT.md](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer die Software als Dienst für andere betreibt, gibt seine Änderungen zurück.
