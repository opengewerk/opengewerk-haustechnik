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

OpenGewerk Haustechnik steht am Anfang von **Phase 0**, dem Fundament. Das Konzept ist ausgearbeitet, der Arbeitsbereich bindet das Fundament der Handwerkersoftware ein, die erste Migration legt es in einer leeren Datenbank an, und die Rechte und die vier Rollen aus Phase 1 sind an Anmeldung und Zugangsverwaltung des Fundaments gebunden; eine Anwendung, die man starten könnte, gibt es noch nicht. Ein Pilotbetrieb mit mehreren Liegenschaften steht bereit; Version 1 ist erreicht, wenn er seine bisherige Anwendung abschalten kann.

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

Die Prüfungen laufen über Turborepo und damit über alle Pakete, die des Fundaments eingeschlossen; dieselben Schritte laufen in der CI. `pnpm run check:toolchain` vergleicht die Fassungen der Werkzeuge mit denen des Fundaments, dazu die der Abhängigkeiten, die ein Paket hier und ein Paket des Fundaments beide laden. Warum das Repository so aufgebaut ist, steht in [ADR 0001](docs/adr/0001-stack-und-fundament.md).

Ein Teil der Tests braucht ein PostgreSQL 18 und leert es vor jedem Lauf. Dafür gibt es eine eigene Testdatenbank auf Port 5434, die `docker/compose.test.yaml` startet. `pnpm run test` an der Wurzel richtet jedes Paket auf sie aus, auch die des Fundaments, die sonst die Testdatenbank ihres eigenen Repositorys suchen. Einzelne Pakete also über die Wurzel prüfen, `pnpm run test --filter=<paket>`, oder `DATABASE_URL` selbst setzen. Der Name der Datenbank muss auf `_test` enden, sonst lehnen die Tests sie ab.

| Paket | Inhalt |
| --- | --- |
| [`packages/domain`](packages/domain) | Fachlichkeit ohne I/O: der Katalog der Rechte und die Rollen, mit denen ein Betreiber beginnt. Reicht weiter, was das Fundament exportiert, damit Server und Oberfläche ein Paket fragen |
| [`packages/server`](packages/server) | Die Datenbank dieser Anwendung (Schema, Migrationen und der Befehl, der sie einspielt) und die Schnittstelle, soweit das Fundament sie mitbringt: Anmeldung, Zugänge und der Bereich der Instanz, hinter dem Guard. Gestartet wird sie noch nicht |
| `upstream/opengewerk/packages/platform/*` | Das Fundament: Mandantentrennung, Anmeldung, Rechte, Abgleich, Audit-Log. Wird im Repository `opengewerk` geändert, nie hier |

Die Oberfläche entsteht mit ihrem ersten Inhalt, ihrer Hülle.

### Datenbank und Migrationen

Die Migrationen liegen als SQL-Dateien unter `packages/server/migrations/`. Eine gemergte Migration wird nicht mehr geändert, auch nicht in einem Kommentar: sie ist auf einer Installation gelaufen, und der Migrationslauf lehnt eine Datei ab, die nicht mehr die ist, die er eingespielt hat. Eine Korrektur ist eine neue Migration. Jede Migration hat ihre Rücknahme unter `migrations/down/`.

Alle ausstehenden Migrationen laufen in einer Transaktion. Schlägt eine fehl, steht die Datenbank auf dem Stand davor. Der Preis: nichts in einer Migration darf außerhalb einer Transaktion laufen müssen, `CREATE INDEX CONCURRENTLY` an erster Stelle.

Die erste Migration, `0000_foundation`, legt das Fundament in einer leeren Datenbank an: Betreiber, Konten und Sitzungen, Zugehörigkeiten und Einladungen, Rollen, das Audit-Log mit Hashkette, die Tabellen des Abgleichs, Nummernkreise, versiegelte Zugangsdaten und den Bereich der Instanz. Sie ist nicht abgeschrieben. Die Tabellen hat `drizzle-kit generate` aus den Schema-Modulen des Fundaments erzeugt, und `completeInitialMigrationIn` aus `@opengewerk/platform-server/migration` hat darumgelegt, was drizzle-kit nicht schreibt: die Rolle der Anwendung, `FORCE`, die Rechte je Tabelle, die Funktionen und die Trigger. In der Datenbank heißt ein Betreiber `tenant`, wie das Fundament ihn nennt.

Zwei Tabellen des Fundaments entstehen mit Listen dieser Anwendung, und beide Listen stehen in `packages/domain`: die Nummernkreise (`asset` für die Anlagennummer, `work_order` für die Nummer eines Auftrags, `evidence` für den Nachweis) und die Zwecke versiegelter Zugangsdaten (`smtp_password`). Ein weiterer Eintrag ist eine Zeile dort und eine Migration, die ihn der Aufzählung in der Datenbank hinzufügt; ein Test hält beide gegeneinander. So ist der Nummernkreis für Aufträge gekommen: die erste Migration hatte ihn ausgelassen, `0001_work_order_numbers` trägt ihn nach. Die Einstellungen mit Gültigkeitszeitraum entstehen ebenso aus einer Liste und kommen mit der ersten Einstellung.

Eine neue Migration:

```bash
pnpm --filter @opengewerk/haustechnik-server run db:generate --name=<name>
```

drizzle-kit schreibt Tabellen, Schlüssel und Policies. Was eine neue Tabelle darüber hinaus braucht (`FORCE`, die Rechte der Anwendungsrolle, den Trigger des Audit-Logs), kommt von Hand dazu, ebenso die Rücknahme unter `down/` mit demselben Namen. Die Tests fragen danach den Katalog der Datenbank und werden rot, wenn eine Tabelle ohne `FORCE`, ohne Policy, ohne Recht oder ohne Audit-Trigger dasteht, und wenn zwei Betreiber in ihr keine eigene Zeile haben, an der sich prüfen lässt, dass keiner die des anderen sieht.

Eingespielt werden die Migrationen von einem eigenen Befehl, vor dem Start der Anwendung und als die Rolle, der die Tabellen gehören:

```bash
pnpm --filter @opengewerk/haustechnik-server run build
MIGRATION_DATABASE_URL=postgres://opengewerk_owner:<passwort>@<host>:5432/haustechnik pnpm --filter @opengewerk/haustechnik-server run migrate
```

Gegen eine Datenbank, die schon auf dem Stand ist, tut er nichts.

### Rechte und Rollen

Was jemand darf, steht an drei Stellen, und zwei Tests halten sie zusammen:

- **Abschnitt 7 des Konzepts** nennt jedes Recht in Worten und sagt je Rolle ja oder nein. Das ist die Quelle.
- **`packages/domain/src/model/rights.ts`** ist dieselbe Liste als Code: der Katalog der Rechte, ihre Bezeichnungen und die vier Rollen, mit denen ein Betreiber beginnt. Ein Test im Serverpaket liest die Tabelle aus dem Konzept und wird rot, wenn ein Recht nur an einer der beiden Stellen steht, anders heißt oder einer anderen Rolle gehört.
- **Die Zeilen eines Betreibers.** Beim Anlegen eines Betreibers werden die Rollen als Zeilen geschrieben, und von da an zählt, was in ihnen steht: der Guard des Fundaments liest sie bei jeder Anfrage.

Ein neues Recht ist also eine Zeile im Konzept, eine im Katalog mit ihrer Bezeichnung und, wo eine Rolle es bekommt, ein Eintrag bei der Rolle. Der Schlüssel ist Ding und Tätigkeit in den Namen aus ADR 0002, etwa `asset.record`.

Jede Route sagt, welches Recht sie braucht, mit `@RequiresPermission` aus `packages/server/src/api/authorization.ts`. Eine Route ohne Angabe lehnt der Guard ab, und `route-coverage.test.ts` findet sie vorher: der Test liest die Controller aus dem Modul, ein neuer Controller ist also dabei, ohne dass jemand an den Test denkt. Routen, die ohne Anmeldung antworten oder nur eine Sitzung brauchen, stehen dort als Liste; eine weitere macht den Test rot und ist damit eine Entscheidung.

Ob eine Rolle einen Betreiber führt und ob sie den zweiten Faktor verlangt, sind Angaben der Rolle und keine Rechte. Die letzte Leitung eines Betreibers lässt sich weder herabstufen noch sperren.

Solange keine Fassung erschienen ist, gibt es keine Installation, deren Zeilen hinter dem Code zurückbleiben könnten. Mit der ersten Fassung ändert sich das: eine Änderung an den Rechten einer mitgelieferten Rolle braucht dann eine Migration, die sie in die Zeilen der bestehenden Betreiber schreibt. `roles-of-a-version.test.ts` wird mit dem Pull Request rot, der die erste Fassung in den CHANGELOG schreibt, und sagt, was dann zu bauen ist.

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
