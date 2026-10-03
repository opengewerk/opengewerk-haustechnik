---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.2, Leitentscheidung 7 und Abschnitt 2.1; ADR 0001 bis 0010 im Repository `opengewerk`
informed: Mitwirkende der Organisation opengewerk
---

# Derselbe Stack, das Fundament als Submodul

## Kontext und Problemstellung

OpenGewerk Haustechnik ist eine eigene Anwendung mit eigenem Repository, eigener Fassung und eigenen Betreibern. Sie führt andere Dinge als die Handwerkersoftware: Liegenschaft, Gebäude, Raum, Anlage, Pflicht und Nachweis statt Kunde, Auftrag und Beleg. Leitentscheidung 7 des Planungskonzepts legt fest, dass sie dabei auf demselben Fundament steht, eingebunden und nie abgeschrieben: Mandantentrennung, Anmeldung, Rechte, Abgleich ohne Netz, Audit-Log, Regel-, Fristen- und Formular-Engine werden nicht ein zweites Mal gebaut.

Wie eine weitere Anwendung das Fundament bezieht, hat [ADR 0010 im Repository `opengewerk`](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0010-fundament-als-pakete.md) entschieden: das Fundament liegt dort in eigenen Paketen unter `packages/platform/`, und die Anwendung bindet das Repository als Git-Submodul auf einem festen Commit ein.

Offen ist, was daraus für dieses Repository folgt:

- Welche Architekturentscheidungen der Handwerkersoftware gelten hier, und wo wird eine neue getroffen?
- Wie ist das Repository aufgebaut, und wie heißen seine Pakete?
- Wie bleiben die Werkzeuge dieselben wie im Fundament, ohne dass ihre Konfiguration ein zweites Mal geschrieben wird?
- Was nennt diese Anwendung selbst, damit sie neben der Handwerkersoftware auf demselben Server laufen kann?

## Entscheidungstreiber

- Es gibt genau eine Fassung des Fundaments. Eine Sicherheitskorrektur dort muss hier ankommen, und es muss sich ablesen lassen, ob sie angekommen ist.
- Was sich abschreiben ließe, läuft auseinander. Die Prüfung "Schreibweise" soll in fünf Repositories der Organisation dieselbe sein und trägt in einem davon seit dem 25.09.2026 drei Wortstämme mehr als in den anderen.
- Was fachlich ist, kennt das Fundament nicht, und was Handwerk ist, kennt diese Anwendung nicht.
- Wer das Repository klont, soll es mit wenigen Befehlen bauen und prüfen können.
- Zwei Anwendungen laufen nebeneinander auf einem Server.

## Betrachtete Optionen

Für die Namen der Pakete:

1. **Dieselben Namen wie in der Handwerkersoftware**, also `@opengewerk/domain`, `@opengewerk/server` und `@opengewerk/web`.
2. **Ein eigener Scope**, also `@opengewerk-haustechnik/domain`.
3. **Derselbe Scope mit dem Namen der Anwendung**, also `@opengewerk/haustechnik-domain`.

Für die Konfiguration der Werkzeuge:

- A. **Abschrift**: `tsconfig.base.json`, Lint-Regeln, Formatierung und Testbasis werden hierher kopiert.
- B. **Verweis in das Submodul**: die Dateien hier lesen die des Fundaments.

Für die Prüfungen des Fundaments in der CI dieses Repositorys:

- a. **Nur die eigenen Pakete prüfen**, das Fundament nur bauen.
- b. **Alle Mitglieder des Arbeitsbereichs prüfen**, die Pakete des Fundaments eingeschlossen.

## Entscheidung

Gewählt wurden **3**, **B** und **b**.

**Welche Entscheidungen gelten**

1. Die ADRs 0002 bis 0010 des Repositorys `opengewerk` gelten hier unverändert:

   | ADR dort | Was es hier bedeutet |
   | --- | --- |
   | 0002 | TypeScript durchgängig, NestJS, ein Paket `domain` ohne I/O, das im Browser und auf dem Server gleich rechnet |
   | 0003 | PostgreSQL mit Row-Level Security und `FORCE`, Drizzle, UUIDv7, Verweise über den Mandanten |
   | 0004 | React und Vite als eine PWA mit zwei Einstiegen: `/` für das Büro, `/m` für die Arbeit vor Ort |
   | 0005 | Eigener Abgleich mit Postausgang und serverautoritativer Zusammenführung, Konfliktregeln je Entität |
   | 0006 | Eingebaute Anmeldung über better-auth, Rollen und Rechte, dazu die Trennung in der Datenbank |
   | 0007 | Inhaltsadressierter Dateispeicher, PDF über Chromium in einem eigenen Container |
   | 0008 | Fachliches als Datenpakete mit den Tests, die prüfen, was ein Beitrag ohne Code falsch machen kann; hier sind es die Pakete mit Pflichtenkatalog, Anlagenarten, Regeln und Formularen |
   | 0009 | pnpm mit Turborepo, Node 24, TypeScript 7, Vitest mit fast-check, ESLint mit Prettier, PostgreSQL 18 |
   | 0010 | Das Fundament als Pakete unter `packages/platform/`, eingebunden als Submodul auf einem festen Commit |

2. **Eine Entscheidung über das Fundament fällt im Repository `opengewerk`**, als ADR dort. Ein ADR hier entscheidet, was nur diese Anwendung betrifft: ihr Datenmodell, ihre Zuständigkeitsbereiche, ihren Nachweis, ihre Pakete, ihre Regeln für den Abgleich. Braucht diese Anwendung etwas anderes vom Fundament, wird es dort geändert und hier der Stand angehoben; eine abweichende Fassung im eigenen Repository gibt es nicht.

**Aufbau und Namen**

3. Das Repository:

   ```
   opengewerk-haustechnik/
     upstream/opengewerk/   # das Repository opengewerk als Submodul, auf einem festen Commit
     packages/
       domain/              # Fachlichkeit ohne I/O
       server/              # entsteht mit der Ausgangsmigration
       web/                 # entsteht mit der Hülle der Oberfläche
     pakete/<name>/         # Pflichtenkatalog, Anlagenarten, Regeln und Formulare als Daten
     docker/                # Betrieb
     docs/adr/, docs/konzept/
   ```

4. Die Pakete heißen `@opengewerk/haustechnik-domain`, `@opengewerk/haustechnik-server` und `@opengewerk/haustechnik-web`. Ein Paket entsteht mit seinem ersten Inhalt und nicht als leere Hülle davor.

5. **Mitglieder des Arbeitsbereichs sind aus dem Submodul nur die Pakete unter `packages/platform/`.** Die Pakete der Handwerkersoftware daneben sind es nicht. Ein Import von dort scheitert deshalb als fehlendes Modul, eine Lint-Regel sagt, welche Regel das ist, und ein Test liest die `package.json` jedes eigenen Pakets und wird rot, wenn dort ein Paket der Handwerkersoftware steht. Das Fundament wird über den Namen seines Pakets importiert, nie über einen Pfad in das Submodul.

**Werkzeuge**

6. Die Reihen sind dieselben wie in ADR 0009, weil diese Anwendung die Pakete des Fundaments mit ihren eigenen Werkzeugen übersetzt. Was sich per Verweis teilen lässt, wird nicht abgeschrieben: die Optionen des Compilers, die Regeln des Linters, die Testbasis und die Formatierung liest dieses Repository aus dem Submodul.

7. Fassungen in einer `package.json` lassen sich nicht per Verweis teilen. `pnpm run check:toolchain` vergleicht sie mit denen des Fundaments und läuft in der CI: ein Pull Request, der den Stand des Fundaments anhebt, bleibt rot, bis die Werkzeuge gefolgt sind.

8. **Die CI prüft alle Mitglieder des Arbeitsbereichs**, auch die Pakete des Fundaments: Typprüfung, Lint mit dessen eigener Konfiguration und Tests. Diese Anwendung hat eine eigene Lockdatei, und mittelbare Abhängigkeiten können in ihr anders aufgelöst sein als im Repository `opengewerk`. Ein Unterschied, der etwas bricht, soll hier auffallen und nicht in einer Installation.

**Der Stand des Fundaments**

9. Der Zeiger des Submoduls nennt immer einen Commit auf `main` des Repositorys `opengewerk`. Während eine Änderung am Fundament entsteht, darf ein Zweig hier auf den Commit eines Zweigs dort zeigen, um beides zusammen zu prüfen; gemergt wird hier erst, wenn dort gemergt ist. Die CI prüft das: der Commit eines Zweigs verschwindet nach dem Merge, und ein Repository, das auf ihn zeigt, ließe sich danach nicht mehr klonen.

10. Angehoben wird der Stand mit einem Pull Request, der den Zeiger und die Lockdatei bewegt. Dependabot schlägt ihn wöchentlich vor.

**Was diese Anwendung nennt**

11. Was ein Mensch sieht oder was nach außen einen Namen trägt, nennt die Anwendung und nicht das Fundament (ADR 0010, Punkt 10):

    | Was | Wert |
    | --- | --- |
    | Produktname | OpenGewerk Haustechnik |
    | Der Mandant in der Oberfläche | Betreiber |
    | Compose-Projekt | `opengewerk-haustechnik` |
    | Port der Anwendung | 23800 |
    | Abbild | trägt den Namen des Repositorys |

    Die Handwerkersoftware läuft auf Port 23700 unter dem Projektnamen `opengewerk`. Zwei Anwendungen unter demselben Projektnamen teilten sich die Volumes, zwei unter demselben Hostnamen die Sitzungs-Cookies; jede bekommt deshalb auch ihren eigenen Hostnamen und ihren eigenen PostgreSQL-Container.

### Konsequenzen

Gut:

- Es gibt hier keine zweite Fassung von irgendetwas, das das Fundament entscheidet: weder Code noch Compiler-Optionen noch Lint-Regeln.
- Am Commit des Submoduls lässt sich ablesen, welchen Stand des Fundaments eine Fassung dieser Anwendung enthält.
- Die Namen der Pakete sagen, zu welcher Anwendung ein Paket gehört, und der Test des Fundaments, der Abhängigkeiten auf `@opengewerk/` ohne `platform-` ablehnt, fängt auch ein Paket dieser Anwendung.

Schlecht:

- Wer klont, braucht `--recurse-submodules`. Ohne das Submodul scheitert schon die Installation, mit einer Meldung, die den Grund nicht nennt; die README und `check:toolchain` sagen ihn.
- Eine Änderung, die das Fundament braucht, hat zwei Schritte in fester Reihenfolge: erst dort mergen, dann hier den Stand anheben.
- Zwei Lockdateien heißt zwei Auflösungen. Dieselbe Fassung des Fundaments kann hier mit einer anderen Fassung einer mittelbaren Abhängigkeit laufen als dort. Punkt 8 ist die Antwort darauf, keine Garantie.
- Die Tests des Fundaments, die eine Datenbank brauchen, brauchen sie dann auch in der CI dieses Repositorys.

Nachträge:

- **Nachtrag vom 02.10.2026, die Ausgangsmigration und was die Anwendung dabei nennt.** Mit dem Server (`#10`) kommen zu Punkt 11 Namen dazu, die das Fundament von einer Anwendung verlangt, bevor sie startet. Die Variable, in der die Compose-Datei die Fassung eines Release übergibt, heißt `HAUSTECHNIK_VERSION`, und die, aus der ein Befehl ohne Terminal ein neues Passwort liest, `HAUSTECHNIK_PASSWORD`. Beide heißen bewusst anders als bei der Handwerkersoftware: beide Anwendungen laufen nebeneinander auf einem Server, und ein Skript, das der einen ein Passwort übergibt, soll die andere nicht erreichen. In der Datenbank bleiben die Namen des Fundaments, die Rollen `opengewerk_owner` und `opengewerk_app` und die Tabelle `tenants`; jede Anwendung hat ihren eigenen PostgreSQL-Container (Punkt 11), die Rollen zweier Anwendungen begegnen sich also nicht.

  Die erste Migration, `0000_foundation`, ist aus den Schema-Modulen und SQL-Bausteinen des Fundaments zusammengesetzt (ADR 0010, Punkt 9) und danach eingefroren wie jede Migration: die Tabellen von `drizzle-kit generate`, die Rolle, `FORCE`, die Rechte, die Funktionen und die Trigger von `completeInitialMigrationIn`. Ein Test vergleicht die Datenbank nach allen Migrationen mit einer, die aus den Bausteinen allein gebaut ist. Weicht er ab, hat sich das Fundament bewegt, und diese Anwendung schuldet ihrer Datenbank eine eigene Migration, die nachzieht. Punkt 10 bekommt damit einen Zusatz: wer den Stand des Fundaments anhebt und dabei einen geänderten Baustein mitbringt, bringt diese Migration im selben Pull Request mit. `check:toolchain` (Punkt 7) vergleicht seitdem auch die Fassungen dessen, was ein Paket dieser Anwendung und ein Paket des Fundaments beide laden, zuerst `drizzle-orm` und `pg`: zwei Fassungen davon in einem Prozess hießen Tabellen, die mit der einen angelegt und mit der anderen abgefragt werden.

  Zwei Tabellen des Fundaments entstehen mit Listen dieser Anwendung (ADR 0010, Nachtrag vom 02.10.2026), und beide Listen stehen in `packages/domain`. Die Nummernkreise sind `asset` für die Anlagennummer (ADR 0002, Punkt 8) und `evidence` für den Nachweis (ADR 0004, Punkt 10); das Muster, mit dem ein Kreis beginnt, steht nicht in der Migration, sondern wird festgelegt, wo die erste Nummer gezogen wird, mit der Anlage (`#20`) und dem Nachweis (`#26`). Der eine Zweck versiegelter Zugangsdaten ist `smtp_password`, das Passwort des Mailservers, über den ein Betreiber seine E-Mails verschickt. Die Einstellungen mit Gültigkeitszeitraum entstehen ebenso aus einer Liste. Das Konzept nennt für Phase 0 keine Einstellung, und eine Aufzählung ohne Wert ist keine; die Tabelle kommt deshalb mit der ersten Einstellung, in der Migration, die sie bringt.

- **Nachtrag vom 02.10.2026, Berichtigung: drei Nummernkreise, nicht zwei.** Der Nachtrag darüber nennt zwei Nummernkreise. Das war falsch. Das Konzept nennt für das Fundament drei, für Anlagen, Nachweise und Aufträge (Abschnitt 12, Phase 0), ein Auftrag trägt eine Nummer (Abschnitt 4.8), und ADR 0002 führt die Nummer eines Auftrags in Punkt 13. Der dritte Kreis heißt `work_order`. Weil die erste Migration zu diesem Zeitpunkt schon gemergt war, trägt ihn die Migration `0001_work_order_numbers` nach, an seiner Stelle zwischen `asset` und `evidence`; die Liste in `packages/domain` nennt alle drei in dieser Reihenfolge. Sein Vorgabemuster wird wie bei den anderen festgelegt, wo die erste Nummer gezogen wird, mit dem Auftrag (`#26`).
- **Nachtrag vom 03.10.2026, die Hülle der Oberfläche.** Mit `#13` entsteht das Paket `@opengewerk/haustechnik-web` unter `packages/web`, wie Punkt 4 es nennt. Seine Bildschirme sind bisher die des Fundaments, und was diese Anwendung dazu sagt, steht an zwei Stellen: im Wert, den beide Einstiege teilen (`src/app/application.tsx`), und in dem, den nur das Büro dazugibt (`src/office/application.tsx`), damit ein Telefon vor Ort die Einstellungen, "Zugänge" und den Bereich der Instanz nicht mitlädt. Zu Punkt 11 kommen drei Namen dazu: die Einstiege heißen nach Abschnitt 10 des Konzepts "Büro" (`/`) und "Vor Ort" (`/m`), und das Produkt heißt in Titel, Manifesten und Tor "OpenGewerk Haustechnik". Die Bildmarke ist die der Organisation, ohne eigene Variante; die Dateien liegen als die eine Kopie unter `assets/brand` und kommen aus dem Repository `.github`. Der Entwicklungsserver reicht die Pfade der Schnittstelle an Port 23800 weiter, und `serverPaths` in `packages/domain` ist die Liste der eigenen Pfade, bisher leer; ein Test hält sie gegen die Routen. Bis die Datensätze aus Phase 1 eigene Listen haben, beginnt das Büro bei den Einstellungen und der Einstieg vor Ort bei den Konflikten: beides sind Bildschirme, die schon etwas leisten, und kein Platzhalter. Die CI sucht im Bau nach den Wörtern der Handwerkersoftware für einen Betreiber, seine Leitung und den Einstieg vor Ort, weil ein Satz auch mit einem Import hereinkommen kann; die Pakettests des Fundaments halten seine eigenen Sätze frei davon. Das Änderungsprotokoll unter den Einstellungen folgt, wenn es mit `#22` ins Fundament gezogen ist.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- ein frischer Klon mit Submodul installiert, baut und prüft, mit den Befehlen aus der README,
- die CI gegen den festen Commit des Fundaments baut und prüft und rot wird, wenn dieser Commit nicht auf dessen `main` liegt,
- `check:toolchain` eine abweichende Fassung eines Werkzeugs meldet,
- und ein Import aus der Handwerkersoftware im Lint mit einer Meldung scheitert, die dieses ADR nennt.

## Vor- und Nachteile der Optionen

### Namen 1: dieselben wie in der Handwerkersoftware

- Gut: Code, der zwischen den Repositories wandert, müsste seine Importe nicht ändern.
- Schlecht: `@opengewerk/domain` hieße in zwei Repositories zwei verschiedene Dinge. Eine Fehlermeldung, ein Suchergebnis oder ein Eintrag in einer Lockdatei sagte nicht mehr, welches gemeint ist.
- Schlecht: der Test des Fundaments, der eine Abhängigkeit auf ein Anwendungspaket ablehnt, könnte die beiden nicht unterscheiden.

### Namen 2: ein eigener Scope

- Gut: unverwechselbar.
- Schlecht: ein zweiter Scope für dieselbe Organisation, und die Regel des Fundaments, die alles unter `@opengewerk/` außer `platform-` ablehnt, griffe für diese Anwendung nicht.

### Namen 3: derselbe Scope mit dem Namen der Anwendung

- Gut: ein Scope für die Organisation, der Name sagt die Anwendung, und die Regel des Fundaments greift.
- Schlecht: längere Namen.

### Konfiguration A: Abschrift

- Gut: das Repository wäre ohne Submodul lesbar.
- Schlecht: jede Regel, die im Fundament strenger wird, müsste hier von Hand folgen, und nichts meldete, wenn sie es nicht tut.

### Konfiguration B: Verweis in das Submodul

- Gut: eine Fassung. Eine Regel, die dort strenger wird, gilt hier mit dem nächsten Anheben des Stands.
- Schlecht: ohne ausgechecktes Submodul läuft kein Werkzeug.

### Prüfungen a: nur die eigenen Pakete

- Gut: kürzere Läufe.
- Schlecht: ein Fehler, der nur mit der Auflösung dieser Lockdatei auftritt, fiele erst in einer Installation auf.

### Prüfungen b: alle Mitglieder des Arbeitsbereichs

- Gut: siehe Punkt 8.
- Schlecht: längere Läufe, und mit den Tests des Servers braucht die CI eine Datenbank.

## Weitere Informationen

- ADR 0010 im Repository `opengewerk`, Das Fundament als eigene Pakete für weitere Anwendungen
- ADR 0009 dort, Werkzeuge und Repo-Struktur
- Planungskonzept, Abschnitt 0, Leitentscheidung 7, Abschnitt 2.1 und Abschnitt 10
