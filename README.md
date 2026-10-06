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

OpenGewerk Haustechnik ist in **Phase 1**, dem MVP für den Pilotbetrieb; Phase 0, das Fundament, ist abgeschlossen. Das Konzept ist ausgearbeitet, der Arbeitsbereich bindet das Fundament der Handwerkersoftware ein, die erste Migration legt es in einer leeren Datenbank an, und die Rechte und die vier Rollen aus Phase 1 sind an Anmeldung und Zugangsverwaltung des Fundaments gebunden. Eine Installation startet mit einem Befehl über Docker Compose, sichert sich jede Nacht und aktualisiert in zwei Schritten, mit der Oberfläche des Fundaments und dem Änderungsprotokoll in den Worten dieser Anwendung. Die Zuständigkeitsbereiche setzt die Datenbank durch, und der Ort von der Liegenschaft bis zum Raum, die Technik mit Anlagen, Komponenten, Lebenszyklus und Anlagennummer und die Pflichten mit ihrem Termin, den die Fristen-Engine aus dem letzten Nachweis führt, sind als Daten und Schnittstelle gebaut, ebenso Vorgang und Mangel, der Nachweis mit Unterschrift, Festschreibung, Berichtigung und Ungültigerklärung und die Regeln, nach denen ein Gerät ohne Netz anlegt und ändert; die Bildschirme dafür entstehen in Phase 1, zuerst die Liegenschaften im Büro mit ihren Ansprechpartnern, Gebäuden, Geschossen und Räumen. Das Format der Pakete, in denen Anlagenarten, Pflichtarten und ihre Regeln als Daten stehen, ist mit Lader und Prüfungen gebaut; die Inhalte kommen in Phase 1. Ein Pilotbetrieb mit mehreren Liegenschaften steht bereit; Version 1 ist erreicht, wenn er seine bisherige Anwendung abschalten kann.

Das vollständige Konzept liegt unter [`docs/konzept/`](docs/konzept/), die Architekturentscheidungen dieser Anwendung unter [`docs/adr/`](docs/adr/). Welche Daten über Beschäftigte die Anwendung hält, wer sie sieht und was sie nicht auswertet, steht für eine Arbeitnehmervertretung unter [`docs/verfahrensbeschreibung/`](docs/verfahrensbeschreibung/Verfahrensbeschreibung.md). Was in Phase 0 gebaut wird, steht als Issues im Meilenstein [Phase 0: Fundament](https://github.com/opengewerk/opengewerk-haustechnik/milestone/1).

## Fahrplan

Der Fahrplan in sieben Phasen, vom Fundament bis zum Vollausbau, steht in [Abschnitt 12 des Planungskonzepts](docs/konzept/Planungskonzept.md#12-fahrplan) und bewusst nur dort. Eine Abschrift daneben läuft irgendwann auseinander.

## Betrieb

Eine Installation startet mit einem Befehl, aus einem Checkout mit dem Submodul (Kapitel "Am Code arbeiten"):

```bash
sh docker/start.sh
```

Beim ersten Mal legt das Skript `docker/.env` an, erzeugt jeden Schlüssel und fragt nach der Adresse, unter der die Instanz im Browser geöffnet wird; ohne Terminal kommt sie aus `HAUSTECHNIK_ADDRESS`. Ausgegeben werden nur Namen, nie ein Wert. Danach baut es das Abbild, spielt die Migrationen ein und startet erst dann die Anwendung, in der Reihenfolge eines Updates. Eine leere Instanz zeigt im Browser die Ersteinrichtung, die nach dem Einrichtungscode aus `docker/.env` fragt und den Betreiber, das erste Konto und dessen zweiten Faktor anlegt. Die Skripte dahinter sind die des Fundaments (`upstream/opengewerk/docker`); was sie über diese Anwendung wissen müssen, steht in `docker/application.env` und `docker/compose.yaml`.

Ein Update ist derselbe Befehl, nach `git pull` und `git submodule update --init`. Er baut das Abbild neu, migriert und tauscht erst danach die laufenden Container; scheitert die Migration, arbeitet die Instanz auf dem Stand davor weiter. Signierte Abbilder zum Herunterladen kommen mit der ersten Fassung.

**Dateien und PDFs.** Was ein Betreiber ablegt, liegt im Dateispeicher, einem eigenen Volume (`files`), unter der Prüfsumme seines Inhalts; die Datenbank hält dazu je Betreiber eine Zeile. Jede Sicherung nimmt Datenbank und Dateispeicher zusammen mit, und das Rückspielen prüft jede Datei gegen ihren Namen. Ein PDF druckt der Renderer, ein Chromium in einem eigenen Container, auf derselben festen Fassung wie im Fundament. Er startet von Haus aus mit, weil die Vorlage `COMPOSE_PROFILES=renderer` setzt, und braucht rund 340 MB Arbeitsspeicher und knapp 4 GB auf der Platte. Wer nie ein PDF braucht, schaltet ihn in `docker/.env` mit einem leeren `COMPOSE_PROFILES=` ab; alles andere läuft dann weiter, und wer ein PDF verlangt, bekommt einen Satz, der das sagt. Eine Installation von vor dem Renderer bekommt seine beiden Zeilen beim nächsten `sh docker/start.sh` in ihre `.env`.

Die Sicherung läuft jede Nacht von selbst, zu der Uhrzeit, die der Bereich der Instanz festlegt, und holt eine verpasste nach. Von Hand, etwa vor einem Update, und zum Rückspielen:

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup backup.sh
docker compose -f docker/compose.yaml --profile backup run --rm backup restore.sh latest
docker compose -f docker/compose.yaml --profile backup run --rm backup verify.sh latest
```

Wie ein Archiv verschlüsselt wird und wohin es gehört, steht in `docker/.env.example`. Die Archive heißen nach der Datenbank (`haustechnik-<zeit>.tar.gz`), ein Ziel lässt sich also mit einer Installation von OpenGewerk teilen: jede Anwendung findet, behält und löscht nur ihre eigenen. Das gilt auch für ein Archiv, das statt `latest` mit seinem Namen genannt wird: eines der anderen Anwendung lehnen `restore.sh` und `verify.sh` ab, bevor sie die Datenbank fragen.

**Neben OpenGewerk auf einem Server.** Die Haustechnik hat ein eigenes Compose-Projekt (`opengewerk-haustechnik`), einen eigenen Port (23800 statt 23700), eine eigene Datenbank in einem eigenen PostgreSQL-Container und eigene Volumes, und ihre Variablen beginnen mit `HAUSTECHNIK_`. Davor gehört ein eigener Hostname: ein Browser hält Cookies je Hostname und nicht je Port, zwei Anwendungen unter einem Namen meldeten sich gegenseitig ab.

Die Kommandozeile ist der Rückweg, wenn sich jemand ausgesperrt hat, und der einzige Weg auf einem Rechner ohne Browser. Das Passwort eines neuen Kontos fragt jeder Befehl verdeckt ab; aus einem Skript kommt es aus `HAUSTECHNIK_PASSWORD`, nie aus einem Argument, denn ein Argument steht in der Prozessliste und im Verlauf der Shell.

```bash
docker compose -f docker/compose.yaml exec app node dist/add-staff.js <kennung-des-betreibers> <e-mail> "<name>" technician
docker compose -f docker/compose.yaml exec app node dist/reset-password.js <e-mail>
docker compose -f docker/compose.yaml exec app node dist/appoint-operator.js <e-mail>
docker compose -f docker/compose.yaml exec app node dist/add-tenant.js "<name des betreibers>" <e-mail> "<name der leitung>"
```

Der Lauf der Fristen läuft in der Anwendung, zehn Sekunden nach dem Start und danach jede Minute, und führt die Termine der Pflichten (#25); im Büro sagt `GET /deadlines/run`, wann er einen Betreiber zuletzt durchgegangen ist. Die Dienste für Dateien, PDFs, E-Mail und Push liegen seit #23 im Fundament. Dateispeicher und Renderer sind seit #96 gebunden: der Server nimmt den Inhalt einer Datei unter `PUT /files/<prüfsumme>` von dem an, der Dokumente ablegen darf, und reicht den Renderer an alles, was druckt; die Dokumente, die Etiketten und das PDF eines Nachweises bauen darauf auf. Mailserver, E-Mail und Push kommen mit den Benachrichtigungen, ebenfalls in Phase 1 und mit ihren Zeilen in der `.env`. Bis dahin geht eine Einladung als Link hinaus.

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
| [`packages/domain`](packages/domain) | Fachlichkeit ohne I/O: der Katalog der Rechte, die Rollen, mit denen ein Betreiber beginnt, die Wörter des Änderungsprotokolls, das Modell des Orts und der Technik und die Fragen an den Katalog der Pakete. Reicht weiter, was das Fundament exportiert, damit Server und Oberfläche ein Paket fragen |
| [`packages/catalogue`](packages/catalogue) | Der Lader der Pakete: liest beim Bau den Ordner `pakete`, prüft jedes Paket und schreibt das Bündel, das Server und Oberfläche laden; dazu der Vergleich der Fassungen mit `main` und das Probepaket als Material der Tests, das der Server in seinen Tests unter `./testing` lädt |
| [`pakete`](pakete) | Der Katalog als Daten: Anlagenarten, Pflichtarten, Regeln, Formulare, Vorlagen und Mängelklassen mit ihren Abnahmen, wie ein Beitrag sie schreibt. Das erste Paket ist `allgemein`: je Kostengruppe der technischen Anlagen eine allgemeine Anlagenart und die drei allgemeinen Mängelklassen; die Fachpakete kommen in Phase 1 |
| [`packages/server`](packages/server) | Die Datenbank dieser Anwendung (Schema, Migrationen und der Befehl, der sie einspielt), der Start einer Instanz, die auch die Oberfläche ausliefert, und die Schnittstelle: vom Fundament Anmeldung, Zugänge, der Bereich der Instanz, der Abgleich und das Änderungsprotokoll, eigene Routen für die Bereiche, den Ort, die Technik und die Pflichten, alles hinter dem Guard |
| [`packages/web`](packages/web) | Die Oberfläche mit zwei Einstiegen, `/` für das Büro und `/m` für die Arbeit vor Ort. Bisher die Hülle des Fundaments mit dem, was diese Anwendung dazu sagt: Tor und Anmeldung, "Konto", "Zugänge", das Änderungsprotokoll, der Bereich der Instanz mit seinem Protokoll, die Leiste des Abgleichs und der Konfliktbildschirm, mit Service Worker und Manifesten |
| `upstream/opengewerk/packages/platform/*` | Das Fundament: Mandantentrennung, Anmeldung, Rechte, Abgleich auf dem Gerät und auf dem Server samt seinen Routen, Audit-Log, Dateispeicher, Druck über den Renderer, Versand von E-Mail und Push, der Einstieg des Servers und die Oberfläche, die jede Anwendung zeigt, bevor ihr erster eigener Bildschirm kommt, mit den Bausteinen, aus denen sie ihre Bildschirme baut. Wird im Repository `opengewerk` geändert, nie hier |
| [`docker`](docker) | Der Betrieb dieser Anwendung: die Compose-Datei, die Vorlage der `.env`, ihre Namen für die Skripte des Fundaments (`application.env`), das Startskript und was die Prüfungen eines laufenden Stapels über sie wissen müssen (`test-material.sh`) |
| `upstream/opengewerk/docker/` | Einrichten, Starten und Sichern einer Instanz und die Prüfungen eines laufenden Stapels, als Skripte des Fundaments. Diese Anwendung ruft sie gegen ihren Ordner `docker` auf, über `docker/start.sh` und in der CI; das Abbild der Sicherung entsteht aus ihrem Ordner `backup`, die Rollen der Datenbank legt ihr `postgres-init` an |

Die Oberfläche baut Vite in ein `dist` mit beiden Einstiegen. Zwei Prüfungen laufen danach auf dem Bau, lokal wie in der CI: das Bündelbudget je Einstieg und die Suche nach Wörtern der Handwerkersoftware, denn hier heißt der Mandant "Betreiber", wer ihn führt, "Leitung", und der Einstieg für die Arbeit vor Ort "Vor Ort".

```bash
pnpm --filter @opengewerk/haustechnik-web run build
pnpm --filter @opengewerk/haustechnik-web run budget
pnpm --filter @opengewerk/haustechnik-web run words
```

In der Entwicklung liefert `pnpm --filter @opengewerk/haustechnik-web run dev` beide Einstiege aus und reicht jeden Pfad der Schnittstelle an den Server auf Port 23800 weiter. Die Markendateien liegen unter `assets/brand` als die eine Kopie, die eine selbst betriebene Anwendung braucht; ihre Quelle ist das Repository `.github` der Organisation.

### Datenbank und Migrationen

Die Migrationen liegen als SQL-Dateien unter `packages/server/migrations/`. Eine gemergte Migration wird nicht mehr geändert, auch nicht in einem Kommentar: sie ist auf einer Installation gelaufen, und der Migrationslauf lehnt eine Datei ab, die nicht mehr die ist, die er eingespielt hat. Eine Korrektur ist eine neue Migration. Jede Migration hat ihre Rücknahme unter `migrations/down/`.

Alle ausstehenden Migrationen laufen in einer Transaktion. Schlägt eine fehl, steht die Datenbank auf dem Stand davor. Der Preis: nichts in einer Migration darf außerhalb einer Transaktion laufen müssen, `CREATE INDEX CONCURRENTLY` an erster Stelle.

Die erste Migration, `0000_foundation`, legt das Fundament in einer leeren Datenbank an: Betreiber, Konten und Sitzungen, Zugehörigkeiten und Einladungen, Rollen, das Audit-Log mit Hashkette, die Tabellen des Abgleichs, Nummernkreise, versiegelte Zugangsdaten und den Bereich der Instanz. Sie ist nicht abgeschrieben. Die Tabellen hat `drizzle-kit generate` aus den Schema-Modulen des Fundaments erzeugt, und `completeInitialMigrationIn` aus `@opengewerk/platform-server/migration` hat darumgelegt, was drizzle-kit nicht schreibt: die Rolle der Anwendung, `FORCE`, die Rechte je Tabelle, die Funktionen und die Trigger. In der Datenbank heißt ein Betreiber `tenant`, wie das Fundament ihn nennt.

Zwei Tabellen des Fundaments entstehen mit Listen dieser Anwendung, und beide Listen stehen in `packages/domain`: die Nummernkreise (`asset` für die Anlagennummer, `work_order` für die Nummer eines Auftrags, `evidence` für den Nachweis) und die Zwecke versiegelter Zugangsdaten (`smtp_password`). Ein weiterer Eintrag ist eine Zeile dort und eine Migration, die ihn der Aufzählung in der Datenbank hinzufügt; ein Test hält beide gegeneinander. So ist der Nummernkreis für Aufträge gekommen: die erste Migration hatte ihn ausgelassen, `0001_work_order_numbers` trägt ihn nach. Die Einstellungen mit Gültigkeitszeitraum entstehen ebenso aus einer Liste und kommen mit der ersten Einstellung.

Bringt das Fundament eine neue Tabelle mit, kommt mit dem Anheben eine Migration dazu, die sie anlegt, so wie es die Bausteine des Fundaments beschreiben; `foundation.test.ts` vergleicht die Datenbank nach allen Migrationen mit einer aus den Bausteinen allein. So sind die Dateien eines Betreibers und sein Mailserver mit `0005_files_and_mail_settings` gekommen und die Einstellungen der Fristarten mit dem Stand des Fristenlaufs mit `0006_deadlines`, jeweils bevor etwas in dieser Anwendung sie schreibt. Eine Tabelle des Fundaments mit Spalten dieser Anwendung legt deren eigene Migration an: die Fristen kommen mit `0008_evidence_and_deadlines`, mit Pflicht, Liegenschaft und Bereich, und `foundation.test.ts` nennt diese Spalten, ihre Schlüssel, ihren Index und die Policy der Bereiche als eigene. Hingenommen wird dort nur eine einschränkende Policy, die Zeilen wegnimmt und keine öffnet.

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

### Eine Instanz ohne Docker starten

Eine Installation läuft über Docker Compose (Kapitel "Betrieb"). Für die Entwicklung startet eine Instanz auch aus dem Checkout: Migrationen einspielen wie oben, die Oberfläche bauen, dann den Server mit seiner Konfiguration.

```bash
pnpm --filter @opengewerk/haustechnik-web run build
pnpm --filter @opengewerk/haustechnik-server run build
DATABASE_URL=postgres://opengewerk_app:<passwort>@<host>:5432/haustechnik STORAGE_PATH=<verzeichnis> SESSION_SECRET=<64 hex> TRUSTED_ORIGINS=http://localhost:23800 SETUP_CODE=<XXXX-XXXX> pnpm --filter @opengewerk/haustechnik-server run start
```

Der Server lauscht auf Port 23800 und liefert die gebaute Oberfläche gleich mit aus; ohne Bau antwortet er mit der Schnittstelle allein und sagt das beim Start. Eine leere Instanz zeigt im Browser die Ersteinrichtung, die nach dem Einrichtungscode aus `SETUP_CODE` fragt und den Betreiber, das erste Konto und dessen zweiten Faktor anlegt. Mit `CLOSED=true` läuft die Instanz, meldet unter `/health` ihre Gesundheit und gibt sonst nichts heraus. Dateien legt sie unter `STORAGE_PATH` ab. Einen Renderer hat eine so gestartete Instanz nur, wenn `RENDERER_URL` und `RENDERER_TOKEN` einen nennen, etwa einen Container mit dem Abbild aus `docker/compose.yaml`; ohne die beiden sagt sie bei einem PDF, dass keiner eingerichtet ist.

### Vorschau ohne Anmeldung

Oberflächen werden in einer Vorschau geprüft, ohne dass jemand ein Konto anlegt oder ein Passwort tippt (#29). Ein Befehl legt in einer eigenen Datenbank einen Beispielbetreiber an und beantwortet jede Anfrage als eine seiner Personen:

```bash
docker compose -f docker/compose.test.yaml up -d
pnpm run preview
```

Die Vorschau baut die Oberfläche, leert die Datenbank `haustechnik_preview` im Container der Tests, spielt die Migrationen ein und legt über die Routen zwei Bereiche "Nord" und "Süd" mit je zwei Liegenschaften, Gebäuden, Geschossen, Räumen und Anlagen an, darunter ein Hauptwasserzähler mit seinem Unterzähler. Jede Anlage ist in Betrieb, ein Unterzähler ist seit dem ersten Tag des Jahres außer Betrieb, und er versorgt ein Gebäude, in dem er nicht steht. Einige Anlagen haben Pflichten, erfüllt vor kurzem, vor langem oder nie, und ein Aufzug hat einen offenen Mangel, damit das Anlagenverzeichnis jeden Zustand zeigt, und eine Seriennummer und ein Kennzeichen, an denen sich die Prüfung auf Dubletten zeigen lässt; Nachweise und Mangel schreibt die Vorschau hinter den Routen (`preview/sample-standings.ts`), bis eine Route sie schreibt. Alle Namen und Anschriften sind erfunden, die Postleitzahlen beginnen mit `0000`, die es nicht gibt; der Katalog ist der dieses Baus, also das Paket "Allgemein", und daneben das Probepaket, weil die Pakete mit Pflichtarten und Messstellen erst im Lauf von Phase 1 kommen. Ein Lüftungsgerät trägt eine allgemeine Anlagenart, damit sich der Hinweis auf das fehlende Fachpaket zeigen lässt. Danach läuft der Server unter `http://127.0.0.1:23800`, nur auf diesem Rechner und nie unter `NODE_ENV=production`.

Wer gefragt wird, ist die Leitung, wenn nichts anderes gesagt ist. `PREVIEW_ROLE` nennt eine der vier Rollen (`management`, `technical_management`, `site_management`, `technician`) und `PREVIEW_AREA` einen der Bereiche; als Haustechnik in Nord gestartet, zeigt die Vorschau nichts aus Süd, weil Rechte und Bereiche wirken wie auf einer Instanz:

```bash
PREVIEW_ROLE=technician PREVIEW_AREA=Nord pnpm run preview
```

Die Datenbank liest die Vorschau aus `PREVIEW_DATABASE_URL` und nie aus `DATABASE_URL`, ihr Name endet auf `_preview`, und sie liegt auf diesem Rechner; der Port kommt aus `PREVIEW_PORT`. Die Vorschau steht unter `packages/server/src/preview/` und kommt weder in `dist` noch in das Abbild. Gegen sie läuft auch die Prüfung "Breiten und Auflösungen", die jede Seite beider Einstiege bei jeder Breite von 320 bis 3840 Pixeln hell und dunkel misst:

```bash
docker run -d --rm --name widths-browser -p 127.0.0.1:3998:3000 -e TOKEN=probe -e TIMEOUT=1800000 ghcr.io/browserless/chromium:v2.57.0
WIDTHS_BROWSER="ws://127.0.0.1:3998?token=probe" WIDTHS_ADDRESS=http://host.docker.internal:23800 pnpm --filter @opengewerk/haustechnik-web run widths
```

### Rechte und Rollen

Was jemand darf, steht an drei Stellen, und zwei Tests halten sie zusammen:

- **Abschnitt 7 des Konzepts** nennt jedes Recht in Worten und sagt je Rolle ja oder nein. Das ist die Quelle.
- **`packages/domain/src/model/rights.ts`** ist dieselbe Liste als Code: der Katalog der Rechte, ihre Bezeichnungen und die vier Rollen, mit denen ein Betreiber beginnt. Ein Test im Serverpaket liest die Tabelle aus dem Konzept und wird rot, wenn ein Recht nur an einer der beiden Stellen steht, anders heißt oder einer anderen Rolle gehört.
- **Die Zeilen eines Betreibers.** Beim Anlegen eines Betreibers werden die Rollen als Zeilen geschrieben, und von da an zählt, was in ihnen steht: der Guard des Fundaments liest sie bei jeder Anfrage.

Ein neues Recht ist also eine Zeile im Konzept, eine im Katalog mit ihrer Bezeichnung und, wo eine Rolle es bekommt, ein Eintrag bei der Rolle. Der Schlüssel ist Ding und Tätigkeit in den Namen aus ADR 0002, etwa `asset.record`.

Der Abgleich hat zwei Rechte, "Daten abgleichen" und "Änderungen senden", und alle vier Rollen haben beide: was ein Gerät sendet, entscheidet für jeden Vorgang das Recht an dem, was er anfasst. Welches das ist, sagt `permissionFor` in `packages/server/src/api/sync-routes.ts`: das engste, das den Vorgang deckt, und das Recht der Route des Büros, sobald er mehr schreibt, als ein Gerät ohne Verbindung darf. Wie der Abgleich die Datensätze behandelt, steht unten unter "Der Abgleich".

Jede Route sagt, welches Recht sie braucht, mit `@RequiresPermission` aus `packages/server/src/api/authorization.ts`. Eine Route ohne Angabe lehnt der Guard ab, und `route-coverage.test.ts` findet sie vorher: der Test liest die Controller aus dem Modul, ein neuer Controller ist also dabei, ohne dass jemand an den Test denkt. Routen, die ohne Anmeldung antworten oder nur eine Sitzung brauchen, stehen dort als Liste; eine weitere macht den Test rot und ist damit eine Entscheidung.

Ob eine Rolle einen Betreiber führt und ob sie den zweiten Faktor verlangt, sind Angaben der Rolle und keine Rechte. Die letzte Leitung eines Betreibers lässt sich weder herabstufen noch sperren.

Solange keine Fassung erschienen ist, gibt es keine Installation, deren Zeilen hinter dem Code zurückbleiben könnten. Mit der ersten Fassung ändert sich das: eine Änderung an den Rechten einer mitgelieferten Rolle braucht dann eine Migration, die sie in die Zeilen der bestehenden Betreiber schreibt. `roles-of-a-version.test.ts` wird mit dem Pull Request rot, der die erste Fassung in den CHANGELOG schreibt, und sagt, was dann zu bauen ist.

### Zuständigkeitsbereiche

Ein Recht gilt in den Bereichen einer Person, und diese Grenze zieht die Datenbank (ADR 0003), nicht jede einzelne Abfrage. Ein Betreiber bündelt seine Liegenschaften in Bereichen (`areas`). Eine Zugehörigkeit gilt für alle Bereiche (`member_all_areas`) oder für genannte (`member_areas`), und eine Vertretung (`substitutions`) gibt jemandem an ihren Tagen die Bereiche einer anderen Person dazu, gezählt nach dem Tag in Deutschland.

Was eine Person sieht, gibt die Anwendung nicht weiter. Zwei Funktionen der Datenbank lesen es aus diesen Tabellen, aus Person und Betreiber der Transaktion: `session_sees_all_areas()` und `session_areas()`. Jede Tabelle mit einem Ort trägt `property_id` und `area_id`, einen Schlüssel auf die Liegenschaft mit `ON UPDATE CASCADE`, damit der Bereich einer Zeile immer der ihrer Liegenschaft ist, und neben der Policy des Betreibers eine zweite, restriktive Policy `within_areas` aus dem Baustein `withinAreas` in `packages/server/src/database/schema/areas.ts`. Der Baustein ruft die Funktionen als Unterabfrage auf; direkt aufgerufen liefen sie für jede Zeile, gemessen 54.160 statt 169 Puffer für das Zählen von 6000 Anlagen. Eine Transaktion ohne Person sieht keine Zeile mit Ort. Ein Lauf im Hintergrund, der für niemanden arbeitet, sagt über `inEveryArea`, dass er alle Bereiche braucht, und nur er: `every-area.test.ts` hält die Liste der Dateien, die das dürfen.

Ein neuer Betreiber bekommt mit seiner ersten Zugehörigkeit den Bereich "Alle Liegenschaften" und merkt sonst nichts davon. Leitung und Technische Leitung sehen von Haus aus alle Bereiche, die anderen den einen, solange es nur einen gibt; das gibt ein Trigger an `memberships`, weil jeder Weg in einen Betreiber eine Zugehörigkeit schreibt und keiner davon Bereiche kennt. Die Liste dieser Rollen ist `rolesSeeingEveryArea` in `packages/domain`.

`areas.test.ts` prüft die Grenze an den Tabellen des Orts, und `areaBoundaryProblems` aus `test-areas.ts` fragt den Katalog: eine Tabelle mit Ort ohne Spalte, Schlüssel oder Policy macht `tenant-isolation.test.ts` rot, ebenso eine Policy, die die Funktionen direkt aufruft, und ein Schlüssel, der auf eine Zeile mit Bereich zeigt, ohne über Betreiber und Liegenschaft zu laufen.

Die Routen liegen unter `/areas` und `/substitutions`. `GET /areas` nennt jedem, der Orte sieht, die Bereiche, in denen er arbeitet, die einer Vertretung von heute eingeschlossen. Alles Weitere gibt Abschnitt 7 des Konzepts der Leitung. `GET /areas/overview` zeigt je Bereich seine Liegenschaften, die Zahl seiner Gebäude und für wen er genannt ist; anlegen und umbenennen geht mit `POST /areas` und `PATCH /areas/:id`. Entfernen lässt sich ein Bereich erst, wenn keine Liegenschaft mehr in ihm liegt: `DELETE /areas/:id?moveTo=<Bereich>` verlegt sie vorher, mit allem darunter und in derselben Transaktion, und der letzte Bereich bleibt. Wer nur in dem entfernten arbeitete, hat danach keinen und sieht nichts mit Ortsbezug; gesperrt wird dadurch niemand. `GET /areas/members` und `PUT /areas/members/:userId` sagen je Zugang "alle" oder die genannten Bereiche; für Leitung und Technische Leitung nimmt die Route nur "alle". Eine Vertretung trägt `POST /substitutions` ein, mit Vertreter, vertretener Person, erstem und letztem Tag, und `DELETE /substitutions/:id` beendet sie sofort: es wurde nichts kopiert, also ist nichts aufzuräumen.

Rolle und Bereiche werden zusammen gesagt. Einladung, Zugehörigkeit und Rollen gehören dem Fundament; es ruft diese Anwendung in seiner eigenen Transaktion, wenn jemand eingeladen wird, beitritt oder andere Rollen bekommt (`packages/server/src/areas/additions.ts`, gebunden in `authentication/access.ts`). `POST /staff` und `PATCH /staff/:userId` nehmen dafür unter `additions` dieselbe Angabe wie `PUT /areas/members/:userId`, also `{ "all": true }` oder `{ "all": false, "areaIds": [...] }`. Eine Einladung hält ihre Bereiche in `invitation_area_choices` und `invitation_areas`, bis sie eingelöst wird, und `GET /areas/invitations` nennt sie; wer beitritt, arbeitet von der ersten Anfrage an darin. Passen Rolle und Bereiche nicht zusammen, wird beides nicht gespeichert. Eine Anfrage ohne `additions` wird genommen wie bisher: eine neue Zugehörigkeit beginnt mit der Vorgabe der Datenbank, und ein Rollenwechsel lässt die Bereiche, wie sie sind, es sei denn, die neue Rolle gilt in allen.

### Der Ort

Liegenschaft, Gebäude, Geschoss und Raum (ADR 0002) liegen in `properties`, `buildings`, `floors` und `rooms`. Jede Ebene trägt die Kennungen der Ebenen darüber und den Bereich ihrer Liegenschaft, und zusammengesetzte Schlüssel halten sie zusammen: ein Raum steht auf einem Geschoss seines Gebäudes, ein Gebäude auf seiner Liegenschaft. Die Prüfungen jeder Ebene stehen in `packages/domain/src/model/location.ts` (`propertyProblems` und die übrigen) und dieselben noch einmal als Checks in der Datenbank; `schema-matches-domain.ts` lässt den Compiler die Zeilen gegen das Modell halten. Gelöscht wird durch Markieren, und ein Trigger markiert, was darunter hängt.

Die Routen liegen unter `/properties`, `/buildings`, `/floors` und `/rooms`. Angelegt wird unter der Ebene darüber (`POST /properties/:id/buildings`, `POST /buildings/:id/floors`, `POST /floors/:id/rooms`), und Liegenschaft, Bereich und Gebäude kommen aus ihr, nie aus dem Rumpf. Ein Betreiber mit einem einzigen Bereich nennt beim Anlegen einer Liegenschaft keinen. Einen Raum verlegt `PUT /rooms/:id/floor` mit dem Recht, die Struktur zu pflegen; Nummer, Bezeichnung und Nutzung ändert, wer Räume aufnehmen darf.

Liegenschaft, Gebäude und Geschoss reisen auf die Geräte und werden dort nur gelesen; einen Raum legt ein Gerät auch ohne Verbindung an (siehe "Der Abgleich").

**Die Ansprechpartner einer Liegenschaft** (Abschnitt 4.1 des Konzepts, Nachtrag vom 05.10.2026 in ADR 0002) liegen in `contacts`. Tabelle, Regeln, Routen und die Karte im Büro sind die des Fundaments (ADR 0010 im Repository `opengewerk`); diese Anwendung sagt, woran ein Ansprechpartner hängt, wer ihn pflegt und wie ihre Wörter heißen. Er hängt an einer Liegenschaft und an nichts sonst, liegt in deren Bereich und zieht mit ihr um; wird die Liegenschaft entfernt, geht er im selben Augenblick mit. Vorname, Nachname, Funktion, Telefon und E-Mail sind Texte mit den Grenzen aus `contactLimits` (`packages/domain/src/model/contact.ts`), nur der Nachname ist Pflicht, und dieselben Regeln (`propertyContacts`) fragen Formular, Route und Abgleich. Die Routen stehen unter `/contacts`, gebunden in `packages/server/src/api/contact-routes.ts`: lesen darf, wer Liegenschaften sieht, anlegen, berichtigen und entfernen, wer Liegenschaften, Gebäude und Geschosse pflegt. Den Bereich nennt keine Anfrage, die Route liest ihn aus der Liegenschaft. Die Ansprechpartner reisen auf jedes Gerät, das die Liegenschaft hält, und ein Gerät schreibt keinen.

Im Büro stehen die Liegenschaften unter `/liegenschaften` (`packages/web/src/office/screens/properties.tsx`): die Liste mit den Gebäuden unter jeder Liegenschaft, die Seite einer Liegenschaft mit Anschrift, Notiz und Gebäuden, und das Formular, mit dem Leitung und Technische Leitung eine anlegen, ändern und entfernen. Liste und Seite liest das Gerät aus dem Abgleich, auch ohne Netz. Geschrieben wird mit Verbindung an den Routen: ändern und entfernen über den Abgleich-Client, anlegen über `makeAt` in `packages/web/src/sync/made-at.ts`, weil der Postausgang eine Liegenschaft nicht anlegt. Die Namen der Bereiche fragt die Oberfläche den Server (`GET /areas`); wer nur einen Bereich sieht, liest und wählt keinen. Die Notiz einer Liegenschaft sagt, was man vor dem Weg dorthin wissen muss; ein Code gehört nicht hinein, weil sie jeder liest, der die Liegenschaft sieht.

Auf der Seite einer Liegenschaft steht unter der Anschrift die Karte "Ansprechpartner" (`packages/web/src/office/property-contacts.tsx`): je Person eine Zeile mit Funktion, Nummer und Adresse zum Antippen. Leitung und Technische Leitung fügen hinzu, berichtigen hinter dem Stift und entfernen nach einer Rückfrage; wer nur liest, sieht weder Knopf noch Stift. Angelegt wird an der Route (`makeAt`), berichtigt und entfernt über den Abgleich-Client, beides mit Verbindung, und die Karte sagt es, bevor jemand tippt. Der Knopf "Änderungen" der Liegenschaft zeigt auch, was mit ihren Ansprechpartnern geschah.

Ein Gebäude, ein Geschoss und ein Raum haben im Büro je eine eigene Seite unter einer eigenen Adresse, `/gebaeude/<id>`, `/geschosse/<id>` und `/raeume/<id>` (`packages/web/src/office/place-addresses.ts`): die Adresse nennt einen Datensatz und nichts, woran er hängt, und bleibt, wenn ein Raum auf ein anderes Geschoss zieht. Der Pfad über der Seite führt von der Liegenschaft herunter, auf dem Telefon steht an seiner Stelle der Weg eine Ebene zurück, und in der Navigation leuchtet auf allen dreien "Liegenschaften". Die Seite eines Gebäudes (`screens/buildings.tsx`) sagt, als was es genutzt wird, sein Baujahr und seinen Bereich, und zählt je Geschoss die Räume und die Anlagen, die darin stehen; was im Gebäude und in keinem Raum steht, zählt eine eigene Zeile "Ohne Raum". Die Seite eines Geschosses (`screens/floors.tsx`) listet seine Räume nach ihrer Nummer, wie ein Mensch zählt, E.2 vor E.10. Die Raumseite (`screens/rooms.tsx`) zeigt die Anlagen, die im Raum stehen, mit ihrem Zustand am heutigen Tag, und darunter die Anlagen, die ihn versorgen, ohne in ihm zu stehen, mit dem Ort, an dem sie stehen; eine Anlage, die das ganze Gebäude versorgt, versorgt jeden seiner Räume. Alle drei liest das Gerät aus dem Abgleich, auch ohne Netz; nur die Karte "Pflichten an diesem Raum" der Raumseite fragt den Server und sagt es ohne Verbindung. Wie die Datensätze dafür gelesen werden, steht für beide Einstiege in `packages/web/src/app/place-records.ts` und `asset-records.ts`.

Angelegt, geändert und entfernt werden die drei über eigene Formulare (`screens/building-form.tsx`, `floor-form.tsx` und `room-form.tsx`, die Adressen in `placeForms`): ein neues unter dem Ort, in dem es stehen wird (`/liegenschaften/<id>/gebaeude/neu`, `/gebaeude/<id>/geschosse/neu`, `/geschosse/<id>/raeume/neu`), das eines vorhandenen unter `bearbeiten` hinter seiner Seite. Gebäude und Geschoss pflegen Leitung und Technische Leitung, mit Verbindung, und das Formular sagt es, bevor jemand tippt: angelegt wird an der Route des Orts darüber (`makeAt`), geändert und entfernt über den Abgleich-Client an der eigenen. Die Gebäudearten sind Kästchen zum Ankreuzen und behalten die Reihenfolge, in der sie gewählt wurden, damit ein Formular, in dem niemand etwas ankreuzt, nichts ändert. Einen Raum legt an und berichtigt, wer Räume aufnimmt (`room.record`, jede der vier Rollen), über den Postausgang und damit auch ohne Netz. Ihn zu verlegen und zu entfernen gehört zum Aufbau der Liegenschaft (`location.write`) und geht mit Verbindung an die Routen `PUT /rooms/:id/floor` und `DELETE /rooms/:id`, über `askAt` neben `makeAt` in `packages/web/src/sync/made-at.ts`: der Abgleich-Client legte das Entfernen eines Raums in den Postausgang, wo der Server es ablehnt. Beim Verlegen bietet die Rückfrage die Geschosse der Liegenschaft an und, solange Anlagen im Raum stehen, nur die seines Gebäudes, weil eine Anlage im Gebäude ihres Raums steht (ADR 0002); was das Gerät nicht wissen kann, eine längst entfernte Anlage, die den Raum noch nennt, lehnt der Server ab, und sein Satz steht dann in der Rückfrage. Die Rückfrage vor dem Entfernen, die sagt, was mitgeht, und das, was an der Stelle eines Formulars steht, wenn jemand es nicht ausfüllen darf, teilen sich die Formulare in `packages/web/src/office/place-forms.tsx`. Ein Formular liest einmal, womit es beginnt: jedes der vier trägt deshalb die Kennung seines Datensatzes als `key` und entsteht neu, wenn die Adresse auf einen anderen wechselt, und das Formular eines Gebäudes entsteht erst, wenn das Gebäude auf dem Gerät ist, damit seine Gebäudearten angekreuzt sind.

**Die Schließzeiten eines Gebäudes** (Abschnitt 4.1 des Konzepts, zweiter Nachtrag vom 05.10.2026 in ADR 0002) liegen in `building_closures`: Zeiten, in denen kein Rundgang entsteht, etwa die Ferien einer Schule. Eine Schließzeit reicht von einem Tag bis zu einem Tag, beide eingeschlossen, und nennt auf Wunsch ihren Anlass (`closureProblems` und `closureLimits` in `packages/domain/src/model/closure.ts`). Sie hängt an ihrem Gebäude, liegt im Bereich seiner Liegenschaft und geht mit dem Gebäude, wenn es entfernt wird. Die Routen stehen unter `/buildings/:id/closures` (`packages/server/src/api/closures.controller.ts`): lesen darf, wer Gebäude sieht, eintragen und entfernen, wer Vorgänge plant und verteilt, also auch die Objektleitung. Geändert wird keine; eine falsche wird entfernt und neu eingetragen. Die Schließzeiten reisen auf jedes Gerät, das das Gebäude hält, und ein Gerät schreibt keine. Ob ein Gebäude an einem Tag geschlossen ist, beantwortet `closureOn`; der Plan eines Rundgangs fragt es, sobald es Pläne gibt. Im Büro stehen sie als Karte "Schließzeiten" auf der Seite des Gebäudes (`packages/web/src/office/building-closures.tsx`): was läuft und was kommt, vom frühesten Tag an, Vergangenes hinter "Frühere anzeigen". Eingetragen wird mit `makeAt` an der Route des Gebäudes, entfernt mit `askAt` nach einer Rückfrage, beides mit Verbindung und nur von dem, der `activity.write` hat.

### Die Technik

Anlagen, ihre Komponenten, ihr Lebenszyklus und was sie versorgen (ADR 0002, Punkte 4 bis 9 und der Nachtrag vom 03.10.2026) liegen in `assets`, `asset_lifecycle` und `asset_supplies`. Eine Anlage steht in einem Gebäude und auf Wunsch in einem seiner Räume, und auf ihrer Liegenschaft bleibt sie. Eine Komponente ist eine Anlage unter einer Anlage im selben Gebäude, beliebig tief und ohne Kreis, und zieht mit ihr um. Die Anlagenart ist ein Schlüssel aus dem Katalog der Pakete, und die Werte ihrer Merkmale und Felder stehen in einer Spalte, geprüft gegen die Art (`assetValueProblems` in `packages/domain/src/model/asset.ts`). Eine Messstelle ist eine Anlagenart, deren Paket `meter` nennt; ihre Anlage trägt Zählernummer und Einheit. Den Zustand an einem Tag rechnet `lifecycleStateOn` aus den Einträgen des Lebenszyklus, gespeichert wird er nie. Die Nummer kommt aus dem Kreis `asset`, `AN-00001` aufwärts, und wird nach dem Löschen nicht neu vergeben.

Die Routen liegen unter `/assets`; angelegt wird unter einem Gebäude (`POST /buildings/:id/assets`) oder unter einer Anlage (`POST /assets/:id/components`). Anlegen, Ergänzen, Berichtigen und was eine Anlage versorgt (`PUT /assets/:id/supplies`) sind "aufnehmen", Umzug (`PUT /assets/:id/location`), die Anlage darüber (`PUT /assets/:id/parent`), der Lebenszyklus (`POST /assets/:id/lifecycle`) und Löschen sind "pflegen". Welche Anlagenarten es gibt, fragen die Routen den Katalog, den das Modul als Wert bekommt (`CATALOGUE` in `packages/server/src/catalogue.ts`); die Tests geben das Probepaket hinein, das `@opengewerk/haustechnik-catalogue/testing` ausgibt. Was die Datenbank selbst ablehnt, eine Komponente unter sich selbst und eine Anlage auf einer anderen Liegenschaft, meldet sie mit den Fehlerklassen `HT001` und `HT002`, die `packages/server/src/api/database-errors.ts` in einen Satz übersetzt.

Das Anlagenverzeichnis des Büros (`/anlagen`) fragt `GET /assets` seitenweise und grenzt dort ein: nach Liegenschaft oder Gebäude, Kostengruppe, Anlagenart, Zustand und Lebenszyklus, jedes ein Wort der Adresse (`office/asset-addresses.ts`). Der Zustand einer Anlage ist abgeleitet (`assetStandingOn` in `packages/domain/src/model/asset-condition.ts`, Nachtrag vom 05.10.2026 in ADR 0002) und wird auf dem Server gerechnet, aus ihren Pflichten, deren Nachweisen und ihren offenen Mängeln (`packages/server/src/database/duty-standing.ts`); dieselbe Stelle gibt der Fristen-Engine ihre Termine. Die Akte einer Anlage (`/anlagen/<id>`) liest `GET /assets/:id` mit Lebenszyklus, Versorgung, Komponenten und Zustand, und ihre Pflichten mit dem Stand von heute unter `GET /assets/:id/duties`, das das Recht "Pflichten ansehen" verlangt. Beide Bildschirme brauchen eine Verbindung, weil Nachweise nicht auf die Geräte reisen. Die Seite eines Gebäudes zählt seine Anlagen nach Kostengruppe aus dem, was das Gerät hält, und führt ins Verzeichnis.

Angelegt und geändert wird eine Anlage im Büro in einem Formular (`/anlagen/neu`, `/anlagen/<id>/bearbeiten`, für eine Komponente `/anlagen/<id>/komponenten/neu`), das die Felder der gewählten Anlagenart in der Fassung von heute zeigt und an die Routen des Servers schreibt, mit Verbindung. Ob es die Anlage schon geben kann, sagt eine Regel in `domain` (`packages/domain/src/model/asset-duplicate.ts`): gleiche Seriennummer oder gleiches Kennzeichen, ohne Rücksicht auf Leerzeichen und Großschreibung. `GET /assets/duplicates` fragt sie für alle Anlagen, die die fragende Person sieht, und nennt die Treffer; angelegt wird die neue trotzdem, wenn jemand das so entscheidet. Import und Abgleich fragen dieselbe Stelle (`packages/server/src/database/asset-duplicates.ts`). Verlegen, Versorgungsbereich und Lebenszyklus stehen an der Akte, Entfernen im Formular; Lebenszyklus, Verlegen und Entfernen bekommt nur angeboten, wer Anlagen pflegt.

### Die Pflichten und ihr Termin

Eine Pflicht (ADR 0002, Punkte 10 bis 12, und die Nachträge vom 03.10.2026) liegt in `duties`: an einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft, aus einer Pflichtart des Katalogs mit Schlüssel und Fassung oder als eigene Pflicht mit Bezeichnung, Grundlage und Quelle, mit ihrer Frist in Tagen oder Monaten und der Höchstfrist vom Tag der Bestätigung daneben, die Route und Datenbank beide halten. Ein verworfener Vorschlag liegt in `duty_dismissals`, mit Begründung und Person. Die Routen liegen unter `/duties` und `/duty-dismissals`, hinter "Pflichten ansehen" und "Das Pflichtenverzeichnis führen".

Das Pflichtenverzeichnis des Büros (`/pflichten`, Abschnitt 4.3 des Konzepts) fragt `GET /duties/register` seitenweise und grenzt dort ein: nach Zustand, Liegenschaft oder Gebäude, Anlagenart, Pflichtart und verantwortlicher Person, jedes ein Wort der Adresse (`office/duty-addresses.ts`). Der Zustand jeder Zeile ist der aus `dutyStateOn`, am Tag der Abfrage gerechnet, an derselben Stelle wie der Termin der Fristen-Engine (`dutiesOnADay` in `packages/server/src/database/duty-standing.ts`); die Reihenfolge ist "nie erfasst" vor "überfällig", dann fällig, erfüllt, ruht (`inRegisterOrder` in `packages/domain/src/model/duty-register.ts`). Eine Pflicht, die geendet hat, verlangt nichts mehr und steht in einer eigenen Liste "Beendet". Eine Pflicht ohne verantwortliche Person steht ohne Filter in der Liste, und eine Zeile darüber zählt sie. Die Seite einer Pflicht (`/pflichten/<id>`) liest `GET /duties/:id` mit ihrem Stand von heute, ihrer Anlage und dem Namen der verantwortlichen Person, und ihre Nachweise unter `GET /duties/:id/evidence`, das "Nachweise ansehen" verlangt und keine Person nennt. Die Pflichten, die an einem Raum selbst hängen, liefert `GET /rooms/:id/duties` für die Raumseite. Alle drei brauchen eine Verbindung, weil Nachweise nicht auf die Geräte reisen.

Wer für eine Pflicht verantwortlich ist, wählt in Phase 1 das Büro: wer das Pflichtenverzeichnis führt, benennt auf der Seite der Pflicht eine Person, die für den Betreiber arbeitet und nicht gesperrt ist (`PATCH /duties/:id`), und bekommt die Namen dafür unter `GET /duties/colleagues`. Auf die Pflichten einer Person eingrenzen kann das Verzeichnis nur, wer es führt, und es nennt dann keine einzige Zahl: weder im Kopf noch an einem Zustand (`namesAPerson`; Abschnitte 4.16 und 9 des Konzepts, keine Auswertung je Person). Was das für Beschäftigte heißt, steht in der Verfahrensbeschreibung, Abschnitte 3.4 und 5.

Aus den Nachweisen, die eine Pflicht erfüllt haben, rechnet `nextAppointment` in `packages/domain/src/model/duty.ts` ihren Termin, mit ihrer Frist und der Zählweise ihrer Pflichtart, und `dutyStateOn` den Zustand an einem Tag. Die Fristen-Engine des Fundaments führt den Termin als Frist der Art `duty.due` in `deadlines`, mit der Quelle in `packages/server/src/deadlines/sources.ts`: keine für eine Pflicht, die nie erfasst wurde, keine, solange ihre Anlage ruht, und keine mehr, wenn die Pflicht endet. Ein Lauf geht durch alle Bereiche eines Betreibers, die Routen unter `/deadlines` und `/settings/deadlines` sehen, was die Person sieht, hinter "Fristen ansehen" und "Fristen bearbeiten". Erinnert wird dreißig Tage vor dem fälligen Tag, bis ein Betreiber einen anderen Vorlauf einstellt; die Erinnerung steht bisher nur an der Frist, E-Mail und Push kommen mit den Benachrichtigungen in Phase 1.

### Dokumente

Ein Dokument (Abschnitt 4.10 des Konzepts, Nachtrag vom 06.10.2026 in ADR 0002) liegt in `attachments`, seine Fassungen in `attachment_versions`: die Ablage des Fundaments, gebunden in `packages/domain/src/model/document.ts` und `packages/server/src/database/schema/attachments.ts`. Es hängt an seiner Liegenschaft und dort an höchstens einem Gebäude, Raum, einer Anlage oder einem Vorgang, und es bleibt dort. Eine Fassung wird einmal geschrieben; eine neue legt sich über die alte, und jede bleibt abrufbar.

Abgelegt wird über den Dateispeicher und den Abgleich, im Büro wie vor Ort (Nachtrag vom 06.10.2026 in ADR 0006): erst die Datei an `PUT /files/:sha256`, dann das Dokument und seine Fassung im Postausgang. `fileDocument` in `packages/web/src/app/documents.ts` ist der eine Weg dafür, für beide Einstiege. Ausgegeben wird eine Datei über ihre Fassung (`GET /attachments/versions/:id/content`), nie über die Prüfsumme, und nur an den, der sieht, woran das Dokument hängt.

Eine Fassung trägt keinen Bereich, sondern fragt ihr Dokument (Nachtrag vom 06.10.2026 in ADR 0003). Wer eine Tabelle baut, deren Zeilen wie eine Fassung Teil einer Zeile mit Ort sind und nie geändert werden, trägt sie in `linesThroughARow` in `packages/server/src/database/test-areas.ts` ein; jede andere Tabelle mit Ort trägt `area_id`.

Im Büro steht der Bildschirm unter `/dokumente`, ein Dokument unter `/dokumente/<id>`; die Karte "Dokumente" (`DocumentsCard` in `packages/web/src/office/documents.tsx`) zeigt die Dokumente eines Datensatzes und legt dort ab. Kein Bildschirm nennt, wer eine Fassung abgelegt hat, und keiner die Uhrzeit: beides steht im Änderungsprotokoll.

### Vorgang und Mangel

Was getan wird, um eine Pflicht zu erfüllen oder eine Störung zu beheben, ist ein Vorgang (ADR 0002, Punkt 13, und der Nachtrag zu #26) in `activities`: ein Rundgang, eine Prüfung, eine Wartung oder ein Arbeitsauftrag, an einer Anlage, einem Raum, einem Gebäude oder der Liegenschaft, mit Stand, Fälligkeit, verantwortlicher und ausführender Person. Die Pflichten, die ein Vorgang erfüllen soll, liegen in `activity_duties`; was nur ein Auftrag hat, die Nummer aus dem Kreis `work_order` und die Art des Auftrags, in `work_orders`. Ein Mangel liegt in `defects`: an einer Anlage oder einem Ort, mit dem Vorgang, bei dem er aufgefallen ist, dem Auftrag, der ihn beseitigt, Klasse, Frist und Stand. Routen und Bildschirme kommen mit den Abläufen in Phase 1; über den Abgleich nimmt ein Vorgang schon seinen Fortschritt und die Ergebnisse seiner Pflichten, und ein Gerät meldet Mängel und legt Aufträge für eine Störung an. Die Prüfungen, die Formular, Abgleich und Route fragen, stehen in `packages/domain/src/model/activity.ts` und `defect.ts`, und die Datenbank hält dieselben Regeln.

### Der Nachweis

Ein Nachweis (ADR 0004 und der Nachtrag zu #26) ist eine Zeile in `evidence`: Pflicht, Tag, Ergebnis, Nummer aus dem Kreis `evidence`, Herkunft, wer es tat, wer festgeschrieben hat und wann, dazu der eingefrorene Stand als JSON und der Fingerabdruck darüber, SHA-256 über die kanonische Form. Der Stand hat eine Fassung, `readEvidenceState` in `packages/domain/src/model/evidence.ts` liest jede, und jede Ausgabe liest ihn statt der laufenden Datensätze. Festgeschrieben wird mit `writeEvidence` aus `packages/server/src/evidence/write.ts` in der Transaktion des Aufrufers; die Routen dafür kommen mit den Abläufen in Phase 1. Ändern, Löschen und Leeren der Tabelle lehnt ein Trigger für jede Rolle ab, den Eigentümer und einen Superuser eingeschlossen, nur der Bereich folgt seiner Liegenschaft; eine Anlage mit Nachweis wird zurückgebaut und nicht gelöscht. Ein Test, der einen Nachweis an der Anwendung vorbei schreibt, nimmt die Spalten aus `packages/server/src/database/test-evidence.ts`.

Unterschrieben wird ein Vorgang über `takeSignature` aus `packages/server/src/activities/signing.ts`: die Unterschrift trägt den Fingerabdruck der Seite, die gezeigt wurde (`SignedPage` in `packages/domain/src/model/signature.ts`), und der Server nimmt sie nur, wenn er aus seinen Datensätzen denselben errechnet. Sind alle verlangten Unterschriften da, entsteht ein Nachweis je Pflicht; ein Auftrag wartet auf seine Abnahme (`decideWorkOrder`). Unterschriften stehen in `activity_signatures`, Abnahmen und Zurückweisungen in `work_order_decisions`, beide einmal geschrieben.

Berichtigt wird ein Nachweis mit `writeEvidence` und `replaces`: der neue Nachweis derselben Pflicht nennt den ersetzten mit Grund, an der Zeile und im Stand, der dafür in Fassung 2 steht, und beide bleiben lesbar. Für ungültig erklärt wird er mit `voidEvidence` aus `packages/server/src/evidence/voiding.ts`, als eigene Zeile in `evidence_voidings`. Für die Frist zählt nur, was weder ersetzt noch für ungültig erklärt ist (`standingEvidence` in `packages/domain/src/model/evidence.ts`), und `packages/server/src/api/nothing-taken-back.test.ts` hält fest, dass keine Route Antworten, Unterschriften oder Nachweise zurücksetzt.

### Der Abgleich

Den Abgleich bringt das Fundament mit: lokale Ablage, Postausgang, eine Zusammenführung, die der Server entscheidet, und den Konfliktbildschirm (ADR 0005 im Repository `opengewerk`). Was diese Anwendung dazu sagt, steht in ADR 0006 und an drei Stellen im Code. `packages/domain/src/model/sync.ts` hat je Tabelle mit den Spalten des Abgleichs eine Richtlinie (`syncPolicies`), je Art von Datensatz die Felder, die ein Gerät ohne Verbindung anlegt und ändert (`offlineEdits`, gefragt mit `offlineEditRefusal`), und die deutschen Namen für den Konfliktbildschirm. `packages/server/src/sync/` hat die Prüfungen in der Reihenfolge, in der der Server sie fragt: was ein Gerät nicht ohne Verbindung schreibt, wird ein Konflikt `online_only`; Texte werden getrimmt; die Regeln aus `domain` und die Anlagenart aus dem Katalog lehnen ab, was ein Formular abgelehnt hätte; zuletzt der Ort, an dem eine Zeile hängt, mit Bereich, Liegenschaft und Gebäude, die der Server daraus ableitet. Die Nummer einer Anlage und eines Auftrags zieht er beim Anlegen. `packages/server/src/api/sync-routes.ts` sagt, welches Recht ein Vorgang braucht.

Eine neue Tabelle mit den Spalten des Abgleichs braucht eine Richtlinie, sonst wird `sync/policies.test.ts` rot; ebenso ein Feld, das ein Gerät schreibt, ohne Namen in `syncFieldNames`, und eine Art von Datensatz ohne Recht in `operationRights`. Nachweise reisen in Phase 0 nicht. Was ein Gerät hält, entscheidet `deviceScope` in `packages/server/src/sync/device-scope.ts`: wer alle Bereiche sieht, den ganzen Betreiber, sonst die Orte, Anlagen und Pflichten der eigenen Bereiche, die eigenen Vorgänge, solange sie offen sind, und abgeschlossene noch dreißig Tage, mit allem, was an ihnen hängt, die offenen Mängel und die, die in den eigenen Vorgängen festgestellt wurden. Die Antwort des Abrufs nennt dazu je Art einen Fingerabdruck über die Liegenschaften, die Vorgänge oder die Mängel; findet ein Gerät einen anderen, lässt es die Art fallen und holt sie neu. Eine Unterschrift vom Gerät prüft der Server wie eine über eine Route (`sync/signatures.ts`), und was ihr folgt, die Nachweise, schreibt er in derselben Transaktion; eine Seite, die nicht mehr die ist, die er errechnet, ist ein Konflikt für genau diese Unterschrift.

### Die Pakete

Welche Anlagenarten es gibt, welche Pflichten für sie in Frage kommen und nach welcher Regel ihre Frist läuft, steht als JSON unter `pakete/<name>/` (ADR 0005), mit dem Tag der letzten Prüfung gegen die Quelle und der Abnahme je Eintrag in `abnahmen.json`. Wie ein Paket aufgebaut ist und was ein Beitrag beachten muss, steht in [`pakete/README.md`](pakete/README.md); ein vollständiges Beispiel ist das Probepaket unter `packages/catalogue/test/pakete/probe/`.

Das Paket [`allgemein`](pakete/allgemein/README.md) ist der Auffang für jede Anlage, die kein Fachpaket beschreibt: je Kostengruppe der technischen Anlagen (DIN 276, zweite Ebene unter 400) eine allgemeine Anlagenart ohne Merkmale und ohne Pflichtarten. Kommt das Fachpaket, wird die Anlagenart der Anlage berichtigt. Der Bau lehnt jede Pflichtart ab, die eine allgemeine Anlagenart in ihrem Geltungsbereich nennt. Dazu bringt das Paket die drei allgemeinen Mängelklassen mit; die Klassen eines Pakets stehen in seiner `mangelklassen.json`, mit Bezeichnung und der Angabe, ob ein Mangel der Klasse die Anlage unsicher macht.

Der Bau von `@opengewerk/haustechnik-catalogue` liest den Ordner, prüft jede Datei gegen ihr Schema und die Pakete gegeneinander und schreibt das Bündel nach `dist/`; ein Fehler hält den Bau an und nennt Datei, Feld und Grund. Eine gemergte Fassung wird nicht geändert, in einem Pull Request vergleicht die CI jede mit `main`:

```bash
pnpm --filter @opengewerk/haustechnik-catalogue run build
pnpm --filter @opengewerk/haustechnik-catalogue run compare origin/main
```

Die Fragen an den Katalog stellt `catalogueOf` aus `packages/domain`, jede mit einem Tag; jeder Eintrag kommt dort nur mit seiner Prüfung und Abnahme heraus.

Ein Gerät rechnet mit dem Katalog seines Servers (Nachtrag vom 05.10.2026 in ADR 0005). Der Server liefert ihn unter `GET /catalogue` ganz aus und nennt unter `GET /catalogue/checksum` seine Prüfsumme, beide mit dem Recht `sync.read`. Die Oberfläche holt ihn einmal, hält ihn in der lokalen Ablage des Betreibers (`packages/web/src/sync/catalogue.ts`) und fragt danach nur noch die Prüfsumme, bis der Server eine andere nennt. Ein Bildschirm fragt ihn mit `useCatalogue()`, auch ohne Netz; bis ein Gerät ihn geholt hat, kommt dort nichts, und der Bildschirm sagt es. Im Büro zeigt "Katalog" die Pakete mit ihren Pflichtarten, Anlagenarten, Formularen, Regeln, Vorlagen und Mängelklassen, und die Seite einer Pflichtart ihre Regeln mit dem Zeitraum, in dem jede gilt. Jede Zeile sagt, ob der Eintrag abgenommen ist und wann er zuletzt gegen seine Quelle geprüft wurde; die Kennzeichnungen dafür stehen an einer Stelle, `packages/web/src/app/review-marks.tsx`, für jeden Bildschirm, der einen Eintrag zeigt.

### Das Änderungsprotokoll

Jede Änderung bei einem Betreiber steht in seinem Audit-Log, Feld für Feld, mit Person, Gerät und Weg, und eine Hashkette zeigt, ob das Protokoll unverändert ist. Einsehen darf es nur die Leitung (`audit.read`), unter "Einstellungen", "Änderungsprotokoll"; die Verwaltung der Instanz liest das Protokoll der Instanz unter "Protokoll" in deren Bereich. Bildschirm und Routen sind die des Fundaments.

Was dort in Worten steht, sagt diese Anwendung an einer Stelle: `auditVocabulary` in `packages/domain/src/model/audit.ts`, dasselbe für Server und Oberfläche. Die Tabellen des Fundaments benennt das Fundament selbst; von dieser Anwendung nimmt es, wie sie einen Betreiber, seine Einstellungen, seine Leitung und die Verwaltung der Instanz nennt, und die Bezeichnungen ihrer Rechte und Rollen. Ihre eigenen Tabellen stehen dort mit ihren Namen, bisher die der Zuständigkeitsbereiche, des Orts und der Technik. Jede, die kommt und die der Trigger des Audit-Logs beobachtet, braucht dort einen Namen für sich und für jede Spalte. `audit-vocabulary.test.ts` im Serverpaket hält das Vokabular gegen den Katalog der Datenbank und wird rot bei einer Tabelle oder Spalte ohne Namen und bei einer Regel, die eine Tabelle oder Spalte nennt, die es nicht gibt. Wie die Oberfläche die Werte einer Spalte schreibt und welcher Weg zu einem Datensatz führt, kommt mit dessen Bildschirmen in `packages/web/src/office/audit.ts` dazu. Den Knopf "Änderungen" haben die Datensätze mit eigener Seite, bisher Liegenschaft, Gebäude, Geschoss, Raum, Anlage und Pflicht; welche es sind, nennt `records` im Vokabular. Was das Protokoll eines Datensatzes mitnimmt, nennt `parts`: bei der Liegenschaft ihre Ansprechpartner, weil das Büro sie auf derselben Seite sieht und ändert, beim Gebäude seine Schließzeiten, und `partsWords` in der Oberfläche sagt es neben dem Datensatz ("mit ihren Ansprechpartnern", "mit seinen Schließzeiten"). Die Gebäudearten stehen im Protokoll als Schlüssel und werden in den Worten des Formulars gelesen (`lists`). Liegenschaft und Bereich eines Ansprechpartners brauchen keinen eigenen Eintrag: beide heißen wie in jeder Tabelle mit Ort (`commonFields`).

### Die Verfahrensbeschreibung

Unter [`docs/verfahrensbeschreibung/`](docs/verfahrensbeschreibung/Verfahrensbeschreibung.md) steht für einen Betriebsrat, einen Personalrat oder eine Mitarbeitervertretung, welche Daten über Beschäftigte die Anwendung hält, wer sie sieht, was sie nicht auswertet und was das Änderungsprotokoll festhält (Abschnitt 9 des Konzepts). Für den Stand von Phase 1 ist sie von Hand geschrieben; ab Phase 2 erzeugt die Anwendung sie selbst.

`processing-description.test.ts` im Serverpaket hält sie gegen den Quelltext und wird rot,

- wenn ein Beleg in ihrem Anhang A nicht mehr stimmt: ein Test heißt anders, eine Stelle steht nicht mehr so da, ein Recht liegt bei einer anderen Rolle;
- wenn eine Spalte dazukommt, die auf eine Person zeigt, und in Anhang B fehlt;
- wenn der Server unter einem ersten Abschnitt antwortet, den Anhang C nicht nennt;
- wenn eine Aussage keine Stelle im Konzept nennt oder eine Zusage keinen Test;
- wenn eine Fassung erscheint und die Zeile "Gilt für" sie nicht nennt.

Wer das auslöst, schreibt im selben Pull Request in das Dokument, was die Änderung für die Beschäftigten bedeutet. Eine Aussage, die dort mit "Zusage" beginnt, braucht einen Test, der sie hält; was noch keiner hält, gehört in ihren Abschnitt 10.

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
