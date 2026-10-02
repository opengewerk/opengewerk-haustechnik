---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidungen 1, 2 und 4, Abschnitte 2.2 bis 2.4, 2.6, 4.1 bis 4.6 und 11; ADR 0003 und 0005 im Repository `opengewerk`
informed: Mitwirkende der Organisation opengewerk
---

# Datenmodell vom Ort bis zum Nachweis

## Kontext und Problemstellung

Leitentscheidung 2 verlangt ein Datenmodell vom Ort bis zum Nachweis: Liegenschaft, Gebäude, Geschoss und Raum für den Ort, Anlage und Komponente für die Technik, Pflicht, Termin, Vorgang, Nachweis und Mangel für das, was an der Technik zu tun ist. Jede Frage soll genau eine Stelle haben, an der sie beantwortet wird.

Das Datenmodell ist der Teil, der sich nicht nachrüsten lässt. Eine Oberfläche lässt sich umbauen, eine Tabelle mit hunderttausend Zeilen bei einem Betreiber nur mit einer Migration, die jede davon anfasst. Vor der ersten Tabelle sind deshalb sechs Fragen zu entscheiden:

1. Sind die Ebenen des Orts eigene Tabellen oder ein Baum aus gleichartigen Knoten?
2. Wie hängt eine Zeile an einem von mehreren möglichen Bezügen, etwa eine Pflicht an Anlage, Raum, Gebäude oder Liegenschaft?
3. Was ist eine Komponente?
4. Wird ein Zustand gespeichert oder abgeleitet?
5. Sind die Arten eines Vorgangs eine Tabelle oder vier?
6. Wie heißen die Dinge im Code?

Die Antworten auf zwei weitere Fragen stehen in eigenen ADRs, weil jede für sich schwer umkehrbar ist: wie die Datenbank die Zuständigkeitsbereiche durchsetzt (ADR 0003) und wie ein Nachweis unveränderlich wird (ADR 0004).

## Entscheidungstreiber

- Jede Frage hat eine Stelle. Was sich aus anderen Angaben ergibt, steht in keinem Feld daneben, das jemand pflegen müsste.
- Die Datenbank hält, was sie halten kann: ein Raum gehört zu einem Geschoss desselben Gebäudes, eine Pflicht hängt an genau einem Bezug, und beides ist ein Schlüssel oder eine Prüfung und kein Vorsatz.
- Die Bestandsaufnahme vor Ort geschieht ohne Netz. Was dabei entsteht, muss sich später ohne Rückfrage zusammenführen lassen (ADR 0005 im Repository `opengewerk`).
- Ein Verweis zwischen zwei Datensätzen eines Betreibers läuft über den Mandanten (ADR 0003 dort, Nachtrag vom 22.09.2026), und die Routen wie der Abgleich lesen die Verweise aus den Fremdschlüsseln.
- Wer aus einem anderen System kommt oder in eines wechselt, findet seine Ordnung wieder (Leitentscheidung 11).

## Betrachtete Optionen

### Die Ebenen des Orts

**A: Vier Tabellen**, Liegenschaft, Gebäude, Geschoss und Raum, jede mit ihren eigenen Feldern und einem Schlüssel auf die Ebene darüber.

**B: Ein Baum**, eine Tabelle von Orten mit Art und Elternknoten, beliebig tief.

### Der Bezug einer Zeile, die an einem von mehreren Dingen hängt

**A: Eine Spalte je möglichem Bezug**, jede mit einem Fremdschlüssel, und eine Prüfung, dass genau eine gesetzt ist.

**B: Art und Kennung**, also `subject_kind` und `subject_id` ohne Fremdschlüssel.

**C: Eine Tabelle je Bezug**, also Pflichten an Anlagen, Pflichten an Räumen und so weiter.

### Die Komponente

**A: Eine Anlage unter einer Anlage**, dieselbe Tabelle mit einem Verweis auf die Anlage darüber.

**B: Eine eigene Tabelle** für Komponenten.

### Der Zustand

**A: Abgeleitet** aus den Datensätzen, bei jedem Lesen.

**B: Gespeichert** und von einem Lauf nachgeführt.

### Die Arten eines Vorgangs

**A: Eine Tabelle** für Vorgänge mit ihrer Art, und was nur eine Art hat, in einer Tabelle daneben.

**B: Vier Tabellen**, Rundgang, Prüfung, Wartung und Arbeitsauftrag.

## Entscheidung

Gewählt wurden jeweils die Option **A**.

**Der Ort**

1. Vier Tabellen: `properties` (Liegenschaft), `buildings` (Gebäude), `floors` (Geschoss), `rooms` (Raum). Die Ebenen sind die des Konzepts und keine Einstellung. Eine Außenanlage ist ein Gebäude mit der Gebäudeart "Außenanlage".

2. Jede Ebene trägt die Kennungen der Ebenen darüber, und zusammengesetzte Fremdschlüssel halten sie zusammen: ein Raum nennt sein Geschoss, sein Gebäude und seine Liegenschaft, und der Schlüssel `(tenant_id, floor_id, building_id)` auf das Geschoss lässt nur ein Geschoss dieses Gebäudes zu. Das kostet Spalten und spart jede Abfrage über mehrere Ebenen: alle Räume einer Liegenschaft sind eine Bedingung und kein dreifacher Join. Dieselben Spalten tragen den Zuständigkeitsbereich (ADR 0003).

3. Ein Raum gehört immer zu einem Geschoss. Ein Gebäude ohne erfasste Geschosse hat keine Räume; wer Räume führen will, legt mindestens ein Geschoss an.

**Die Technik**

4. `assets` ist die Anlage. Sie hat genau einen Standort: das Gebäude ist Pflicht, der Raum freiwillig. Wo sie wirkt, ohne dort zu stehen, steht in `asset_supplies`: je Zeile ein Raum oder ein Gebäude, das die Anlage versorgt.

5. **Eine Komponente ist eine Anlage unter einer Anlage**: dieselbe Tabelle, mit `parent_asset_id`. Sie steht im selben Gebäude wie die Anlage darüber, was ein zusammengesetzter Schlüssel hält, und kann einen eigenen Raum nennen. Beliebig tief; dass keine Anlage unter sich selbst hängt, prüft ein Trigger. Alles, was für eine Anlage gilt, gilt damit für eine Komponente: Pflichten, Nachweise, Mängel, Etikett.

6. Die **Anlagenart** ist ein Schlüssel aus einem Paket (ADR 0005) oder aus den eigenen Anlagenarten des Betreibers. Mit ihr kommen die Kostengruppe nach DIN 276, die Felder und die Merkmale. Die Werte der Felder und Merkmale stehen an der Anlage in einer JSON-Spalte, geprüft gegen die Definition der Anlagenart: welche es gibt, sagt das Paket, und ein Paket bekommt keine Spalte.

7. Der **Lebenszyklus ist eine Liste von Einträgen**, `asset_lifecycle`: Zustand und der Tag, ab dem er gilt. An einem Tag gilt der jüngste Eintrag bis dahin, vor dem ersten keiner. Ein Schalter an der Anlage würde die Vergangenheit überschreiben; so ruhen die Pflichten einer stillgelegten Anlage ab einem Tag, und ihre Nachweise davor bleiben, was sie waren.

8. Die **Anlagennummer** kommt aus einem Nummernkreis und wird nie neu vergeben. Eine Anlage, die ohne Netz entsteht, bekommt ihre Nummer vom Server beim Abgleich; bis dahin hat sie keine. Daneben steht das Kennzeichen, das der Betreiber selbst führt.

9. Ein **Zähler ist eine Anlage** mit einer Anlagenart aus der Gruppe der Messstellen. Seine Stände sind eine eigene Tabelle und hängen an ihr.

**Von der Pflicht bis zum Nachweis**

10. Eine **Pflicht** (`duties`) hängt an genau einem von vier Bezügen: Anlage, Raum, Gebäude oder Liegenschaft. Je Bezug eine Spalte mit Fremdschlüssel über den Mandanten, dazu eine Prüfung, dass genau eine gesetzt ist. So gilt jede Regel, die für einen Verweis gilt, auch hier, und der Abgleich prüft sie aus dem Schema heraus. Dasselbe Muster gilt für jede Zeile, die an einem von mehreren Dingen hängt: Mangel, Dokument, Aufgabe, Etikett.

11. **Ein Vorschlag ist kein Datensatz.** Welche Pflichtarten für eine Anlage in Frage kommen, ergibt sich aus dem Katalog, der Anlagenart, ihren Merkmalen, der Gebäudeart und dem Land, an einem Tag. Gespeichert wird die Entscheidung darüber: eine bestätigte Pflicht ist eine Zeile in `duties`, eine verworfene eine Zeile in `duty_dismissals` mit Begründung und Person. Kommt eine neue Fassung eines Pakets, erscheinen neue Vorschläge von selbst, und eine bestätigte Pflicht ändert sich nicht still.

12. Der **Termin** ist die Frist der Fristen-Engine des Fundaments, mit der Pflicht als Quelle: letzter Nachweis plus Frist. Er wird von der Engine geführt und von niemandem getippt.

13. Ein **Vorgang** (`activities`) ist, was getan wird, um einen Termin zu erfüllen oder eine Störung zu beheben. Rundgang, Prüfung, Wartung und Arbeitsauftrag sind Arten eines Vorgangs. Was nur eine Art hat, steht in einer Tabelle daneben: die Punkte und Antworten eines Rundgangs, die Nummer und die Abnahme eines Auftrags.

14. Ein **Nachweis** (`evidence`) belegt, dass und mit welchem Ergebnis eine Pflicht an einem Tag erfüllt wurde: eine Zeile je Pflicht und Durchführung. Ein Bericht, der hundertvierzig Feuerlöscher abdeckt, ergibt hundertvierzig Nachweise mit derselben Datei. Wie ein Nachweis unveränderlich wird, steht in ADR 0004.

15. Ein **Mangel** (`defects`) hängt an einer Anlage oder einem Ort und nennt den Vorgang, bei dem er aufgefallen ist, wenn es einen gab.

**Was nie gespeichert wird**

16. Der Zustand einer Anlage (in Ordnung, fällig, überfällig, nie geprüft, Mangel offen), der Zustand einer Pflicht (nie erfasst, überfällig, fällig, erfüllt bis, ruht), der Verbrauch an einer Messstelle und ob eine Akte vollständig ist, werden bei jedem Lesen aus den Datensätzen abgeleitet, von reinen Funktionen im Paket `domain`, die einen Tag als Argument nehmen. Ein gespeicherter Zustand müsste gepflegt werden und wäre zwischen zwei Läufen falsch; ein abgeleiteter ist an jedem Tag der, der aus den Belegen folgt.

**Was für jede Tabelle gilt**

17. Wie im Fundament: UUIDv7 als Schlüssel, `tenant_id` mit Row-Level Security und `FORCE`, Verweise über `(tenant_id, id)`, das Audit-Log über Trigger, die Spalten des Abgleichs an allem, was auf ein Gerät reist. Gelöscht wird durch Markieren, und was darunter hängt, wird mit markiert. Eine Anlage mit einem Nachweis lässt sich nicht löschen: sie wird zurückgebaut, und ihre Nachweise bleiben bei ihr.

18. Zeiten sind Tage, wo das Recht in Tagen rechnet (Fälligkeit, Lebenszyklus, Gültigkeit), und Zeitpunkte, wo etwas geschehen ist (Unterschrift). Geld gibt es in diesem Datenmodell nicht.

**Die Namen im Code**

19. Code ist englisch, und jedes Ding hat einen Namen, der im ganzen Repository derselbe ist:

    | Deutsch | Im Code | Bemerkung |
    | --- | --- | --- |
    | Betreiber | `tenant` | der Mandant des Fundaments; in der Oberfläche "Betreiber" |
    | Verwaltung der Instanz | `operator` | wie im Fundament; in der Oberfläche nie "Betreiber" |
    | Zuständigkeitsbereich | `area` | |
    | Liegenschaft | `property` | |
    | Gebäude, Gebäudeart | `building`, `building kind` | |
    | Geschoss | `floor` | |
    | Raum | `room` | |
    | Anlage, Komponente | `asset` | die Komponente ist eine Anlage mit `parentAssetId` |
    | Anlagenart | `asset kind` | |
    | Merkmal einer Anlage | `characteristic` | |
    | Versorgungsbereich | `supply` | |
    | Lebenszyklus | `lifecycle` | |
    | Messstelle, Zählerstand | `meter`, `reading` | |
    | Pflichtart | `duty kind` | im Paket |
    | Pflicht | `duty` | beim Betreiber |
    | Frist (der Abstand) | `interval` | |
    | Termin (die Fälligkeit) | `deadline` | die Frist der Fristen-Engine |
    | Vorgang | `activity` | |
    | Rundgang, Vorlage, Punkt | `round`, `round template`, `point` | |
    | Prüfung, Wartung | `inspection`, `maintenance` | |
    | Arbeitsauftrag | `work order` | |
    | Nachweis | `evidence` | |
    | Mangel | `defect` | |
    | Störmeldung | `fault report` | |
    | Fremdfirma, Vertrag | `contractor`, `contract` | |
    | Pflichtenübertragung | `delegation` | |
    | Qualifikation | `qualification` | |
    | Vertretung | `substitution` | |
    | Verantwortlicher, Ausführender | `responsible`, `performer` | |
    | Paket | `package` | |

    "Betreiber" und "Betreiber der Instanz" wären in der Oberfläche zwei verschiedene Dinge mit fast demselben Namen. Wer die Instanz betreibt, heißt dort deshalb "Verwaltung der Instanz", wie in Abschnitt 1 des Konzepts.

### Konsequenzen

Gut:

- Eine Abfrage über mehrere Ebenen ist eine Bedingung auf einer Spalte. Das Lagebild je Gebäude und die Übersicht über alle Liegenschaften brauchen keinen rekursiven Join.
- Was zusammengehört, hält die Datenbank: ein Raum im falschen Gebäude, eine Komponente in einem anderen Gebäude als ihre Anlage und eine Pflicht ohne Bezug sind abgelehnte Schreibvorgänge und keine Fehlerbilder.
- Komponenten bekommen Pflichten, Nachweise und Mängel, ohne dass irgendetwas dafür gebaut wird.
- Vorschläge veralten nicht, weil es sie nicht als Datensätze gibt.
- Ein Rundgang, die Prüfung einer Fremdfirma und ein Wartungsauftrag erfüllen dieselbe Pflicht auf demselben Weg. Leitentscheidung 1 ist eine Eigenschaft der Tabellen.

Schlecht:

- Die Ebenen sind fest. Ein Betreiber, der einen Bauteil zwischen Gebäude und Geschoss oder eine Zone zwischen Geschoss und Raum führen will, bekommt dafür kein Feld, sondern ein Namensschema.
- Die Spalten der Ebenen darüber stehen an jeder Zeile darunter. Ein Raum, der in ein anderes Geschoss verlegt wird, ändert mehrere Spalten, und die Schlüssel sorgen dafür, dass es die richtigen sind.
- Abgeleitete Zustände kosten Rechenzeit bei jedem Lesen. Die Übersicht über alle Liegenschaften rechnet über alle Pflichten eines Betreibers; ob das bei einigen tausend Anlagen schnell genug ist, zeigt eine Messung in Phase 1, bevor an eine gespeicherte Zwischensumme gedacht wird.
- Werte der Felder einer Anlagenart stehen in einer JSON-Spalte. Der Abgleich führt sie als ein Feld zusammen: ändern zwei Geräte verschiedene Merkmale derselben Anlage, ist das ein Konflikt und kein stilles Zusammenführen.
- Eine Tabelle für alle Vorgänge heißt, dass Spalten, die nur eine Art braucht, in Tabellen daneben liegen, und dass eine Abfrage nach einer Art eine Bedingung mehr trägt.

Nachträge:

- **Nachtrag vom 02.10.2026, Namen für den Ort, die Rechte und die Rollen.** Punkt 19 nennt jedes Ding des Datenmodells, aber kein Wort für den Ort als Ganzes, für ein Recht und für die Rollen. Mit dem Katalog der Rechte (`#11`) kommen dazu:

  | Deutsch | Im Code | Bemerkung |
  | --- | --- | --- |
  | Ort (Liegenschaft, Gebäude, Geschoss und Raum zusammen) | `location` | wo ein Recht oder eine Abfrage alle vier Ebenen meint |
  | Recht | `right` | wie im Fundament; der Schlüssel ist Ding und Tätigkeit, etwa `asset.record` |
  | ansehen | `read` | |
  | aufnehmen | `record` | anlegen und die Angaben ergänzen und berichtigen |
  | pflegen, führen, ändern, eintragen | `write` | |
  | ausführen | `perform` | |
  | abnehmen, gegenzeichnen | `accept` | |
  | melden | `report` | |
  | Leitung | `management` | die Rolle, die einen Betreiber führt |
  | Technische Leitung | `technical_management` | |
  | Objektleitung | `site_management` | "Objekt" heißt in der Organisation `site` |
  | Haustechnik | `technician` | |

  Die Schlüssel der Rollen stehen in den Zeilen eines Betreibers und in seinen Zugehörigkeiten. Sie sind deshalb Namen, die bleiben: eine Rolle, die anders heißen soll, bekommt eine andere Bezeichnung und behält ihren Schlüssel. Welche Rolle was darf, steht in Abschnitt 7 des Konzepts und nicht hier.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- die Tabellen des Orts und der Technik bestehen, mit Tests, die je Schlüssel versuchen, eine Zeile an die falsche Ebene zu hängen,
- eine Komponente nicht unter sich selbst hängen kann, mit einem Test dafür,
- der Zustand im Lebenszyklus und der Zustand einer Pflicht reine Funktionen im Paket `domain` sind, mit Eigenschaftstests über beliebige Tage,
- keine Tabelle eine Spalte für einen abgeleiteten Zustand hat,
- und die Namen aus Punkt 19 die im Code sind.

## Vor- und Nachteile der Optionen

### Ort B: ein Baum

- Gut: beliebige Tiefe, eine Tabelle, ein Formular.
- Schlecht: jede Ebene hat eigene Angaben, die über Pflichten entscheiden, das Land an der Liegenschaft und die Gebäudeart am Gebäude. In einem Baum wären das Spalten, die für die meisten Knoten leer sind, und Prüfungen in Triggern statt Schlüsseln.
- Schlecht: jede Frage über mehrere Ebenen wäre rekursiv, auch die Policy für den Zuständigkeitsbereich.

### Bezug B: Art und Kennung

- Gut: ein neuer Bezug braucht keine Spalte.
- Schlecht: kein Fremdschlüssel. Die Datenbank nähme die Kennung eines gelöschten oder fremden Datensatzes an, und die Prüfung der Verweise im Abgleich, die das Fundament aus den Schlüsseln liest, griffe nicht.

### Bezug C: eine Tabelle je Bezug

- Gut: jede Spalte ist Pflicht, keine Prüfung "genau eine".
- Schlecht: das Pflichtenverzeichnis wäre die Vereinigung von vier Tabellen, und jede Änderung an der Pflicht geschähe viermal.

### Komponente B: eine eigene Tabelle

- Gut: eine Komponente könnte weniger Felder haben als eine Anlage.
- Schlecht: Pflichten, Nachweise, Mängel und Etiketten müssten an zwei Tabellen hängen können. Der Brenner am Kessel hat eine eigene Prüfpflicht.

### Zustand B: gespeichert

- Gut: schnelles Lesen, einfache Filter.
- Schlecht: zwischen zwei Läufen falsch, und nach einem Lauf, der nicht stattgefunden hat, tagelang. Das Konzept schließt es aus (Abschnitt 2.2).

### Vorgang B: vier Tabellen

- Gut: jede Tabelle hat genau die Spalten ihrer Art.
- Schlecht: vier Wahrheiten darüber, was an einer Anlage getan wurde. Die Zeitachse, das Lagebild und der Nachweis müssten jede davon kennen, und eine fünfte Art wäre eine fünfte Tabelle an allen diesen Stellen.

## Weitere Informationen

- ADR 0003, Zuständigkeitsbereiche in der Datenbank
- ADR 0003 im Repository `opengewerk`, Datenbank und Datenzugriff, mit den Nachträgen zu Verweisen über den Mandanten
- ADR 0005 im Repository `opengewerk`, Offline-Synchronisation und Konfliktauflösung
- Planungskonzept, Abschnitte 2.2 bis 2.4 und 2.6
