---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidung 8, Abschnitte 2.7, 2.8 und 7; ADR 0002; ADR 0003 und 0006 im Repository `opengewerk`; Versuch gegen PostgreSQL 18 vom 01.10.2026
informed: Mitwirkende der Organisation opengewerk
---

# Zuständigkeitsbereiche in der Datenbank

## Kontext und Problemstellung

Innerhalb eines Betreibers gibt es Bereiche (Leitentscheidung 8): wer für die Liegenschaften im Norden zuständig ist, sieht und bearbeitet die im Süden nicht, und sein Gerät hält sie nicht. Ein Bereich bündelt Liegenschaften, eine Zugehörigkeit gilt für alle Bereiche oder für genannte, und befristet übernimmt jemand die Bereiche einer anderen Person (Abschnitt 2.8).

Am 01.10.2026 ist entschieden worden, dass die Datenbank das durchsetzt und nicht jede einzelne Abfrage: eine Zeile mit Ortsbezug trägt ihren Bereich, und eine Policy lässt nur die Bereiche der Anfrage durch. Offen ist das Wie:

1. Woher weiß eine Zeile ihren Bereich, und wie bleibt er richtig, wenn eine Liegenschaft den Bereich wechselt?
2. Woher weiß die Datenbank, welche Bereiche eine Anfrage sehen darf?
3. Was kostet die Policy?
4. Was sieht ein Hintergrundlauf, der für keinen Menschen arbeitet?

## Entscheidungstreiber

- Ein Fehler muss in die sichere Richtung fallen: eine vergessene Bedingung, ein vergessener Aufruf oder eine fehlende Angabe zeigt weniger Zeilen und nie mehr.
- Die Trennung der Betreiber aus dem Fundament bleibt, wie sie ist. Der Bereich kommt als zweite Grenze dazu und weicht die erste nicht auf.
- Eine Route kann die Bereiche einer Anfrage nicht aufweiten, auch nicht durch einen Fehler.
- Eine neue Tabelle mit Ortsbezug, der die Grenze fehlt, fällt in der CI auf und nicht bei einem Betreiber.
- Ein kleiner Betreiber mit einem einzigen Bereich merkt von alledem nichts.

## Betrachtete Optionen

Für den Bereich an der Zeile:

**A: Eine Spalte, von einem Trigger geführt.** Jede Zeile mit Ortsbezug trägt `area_id`; ein Trigger setzt sie beim Schreiben aus der Liegenschaft, ein zweiter zieht sie nach, wenn die Liegenschaft den Bereich wechselt.

**B: Eine Spalte, von einem Fremdschlüssel geführt.** Jede Zeile trägt `property_id` und `area_id`, und ein zusammengesetzter Fremdschlüssel auf die Liegenschaft mit `ON UPDATE CASCADE` hält beide zusammen.

**C: Keine Spalte.** Die Policy schlägt den Bereich bei jedem Lesen über die Liegenschaft nach.

Für die Bereiche einer Anfrage:

**a: Die Anwendung setzt sie** als Einstellung der Transaktion, wie den Mandanten.

**b: Die Datenbank leitet sie her**, aus der Person der Transaktion und den Tabellen der Zugehörigkeit.

## Entscheidung

Gewählt wurden **B** und **b**.

**Die Tabellen**

1. `areas`: die Bereiche eines Betreibers. Ein neuer Betreiber bekommt einen, und jede Liegenschaft nennt genau einen.

2. Eine Zugehörigkeit gilt für alle Bereiche (`all_areas` an der Zugehörigkeit) oder für die in `member_areas` genannten. Welche Rollen von Haus aus alle Bereiche sehen, ist eine Vorgabe beim Anlegen und keine Regel der Datenbank: die Leitung und die Technische Leitung alle, Objektleitung und Haustechnik ihre.

3. `substitutions`: wer wen von wann bis wann vertritt. Wer vertritt, sieht in dieser Zeit zusätzlich die Bereiche der vertretenen Person.

**Der Bereich an der Zeile**

4. Jede Tabelle mit Ortsbezug trägt `property_id` und `area_id`, und der Fremdschlüssel

   ```sql
   FOREIGN KEY (tenant_id, property_id, area_id)
     REFERENCES properties (tenant_id, id, area_id) ON UPDATE CASCADE
   ```

   macht daraus eine Eigenschaft der Daten: der Bereich einer Zeile ist immer der ihrer Liegenschaft. Wechselt eine Liegenschaft den Bereich, zieht die Datenbank jede Zeile darunter mit, in derselben Anweisung und ohne einen Trigger, den jemand für eine neue Tabelle vergessen könnte.

5. Dass die genannte Liegenschaft die richtige ist, halten die Schlüssel aus ADR 0002: ein Gebäude nennt seine Liegenschaft, ein Raum sein Gebäude mit dessen Liegenschaft, eine Anlage ihr Gebäude mit dessen Liegenschaft. Eine Zeile kann sich so keinen Bereich aussuchen: wer den eigenen Bereich an ein Gebäude eines fremden schreibt, scheitert am Schlüssel.

6. Betreiberweit und ohne Bereich bleiben, was keinen Ort hat: Katalog, Fremdfirmen, Lager, Schließanlagen, Einstellungen, die Bereiche selbst.

**Die Policy**

7. Jede Tabelle mit Ortsbezug bekommt zur Policy des Mandanten eine zweite, **restriktive**: `within_areas`. Restriktive Policies verknüpft PostgreSQL mit UND, permissive mit ODER; keine andere Policy kann sie also aufweiten.

8. Was eine Anfrage sieht, sagen zwei Funktionen der Datenbank, und sie lesen dieselben zwei Einstellungen, die das Fundament für jede Transaktion setzt, den Mandanten und die Person:

   - `session_sees_all_areas()`: die Zugehörigkeit der Person gilt für alle Bereiche, oder die Transaktion ist ausdrücklich ein Hintergrundlauf.
   - `session_areas()`: die Bereiche der Person, dazu die der Personen, die sie heute vertritt.

   Die Anwendung setzt keine Liste von Bereichen. Eine Route, die sich irrt, kann deshalb nichts aufweiten: die Datenbank fragt ihre eigenen Tabellen.

9. **Die Policy ruft die Funktionen als Unterabfrage auf**:

   ```sql
   USING ((SELECT session_sees_all_areas())
          OR area_id = ANY ((SELECT session_areas())::uuid[]))
   ```

   Das ist keine Stilfrage. Direkt aufgerufen wertet PostgreSQL beide Funktionen für jede Zeile aus, auch wenn sie als `STABLE` erklärt sind; als Unterabfrage laufen sie einmal je Anweisung. Gemessen am 01.10.2026 mit zwei Betreibern, je 4 Bereichen, 20 Liegenschaften, 60 Gebäuden und 6000 Anlagen:

   | Abfrage | ohne Bereichs-Policy | Funktionen direkt | als Unterabfrage |
   | --- | --- | --- | --- |
   | 100 Anlagen eines Gebäudes, sortiert | 0,14 ms | 2,4 ms | 0,21 ms |
   | Zählen aller Anlagen des Betreibers | 0,64 ms | 142 ms | 0,73 ms |

   Die Policy kostet richtig geschrieben rund eine Zehntelmillisekunde je Anweisung und falsch geschrieben das Zweihundertfache, und kein Test, der Ergebnisse vergleicht, sieht den Unterschied. Sie entsteht deshalb aus einem Baustein, und ein Katalogtest liest den Ausdruck jeder Bereichs-Policy und lehnt einen direkten Aufruf ab.

10. **Kein Benutzer heißt: keine Zeile.** Eine Transaktion ohne Person sieht in den Tabellen mit Ortsbezug nichts. Ein Hintergrundlauf, der für keinen Menschen arbeitet (Fristen, Erinnerungen, Sicherung des Stands), sagt ausdrücklich, dass er alle Bereiche braucht, über eine eigene Einstellung der Transaktion, die nur der Datenbankzugriff für Hintergrundläufe setzt und keine Route.

**Schreiben**

11. `WITH CHECK` gilt wie `USING`: wer eine Liegenschaft in einen Bereich verlegen will, den er nicht hat, wird abgelehnt, und wer nur den alten Bereich hat, kann sie nicht aus seinem Blick hinaus verlegen. Verlegen ist Sache derer, die alle Bereiche sehen.

12. Die Kaskade des Fremdschlüssels läuft an der Row-Level Security vorbei, wie jede Prüfung eines Fremdschlüssels. Das ist hier gewollt: wer die Liegenschaft verlegen darf, verlegt alles darunter, auch Zeilen, die er aus anderen Gründen nicht ändern dürfte.

**Das Gerät**

13. Welche Zeilen ein Gerät hält, folgt aus denselben zwei Funktionen (ADR 0006). Ändern sich die Bereiche einer Person, lässt ihr Gerät fallen, was es nicht mehr halten darf.

### Konsequenzen

Gut:

- Eine vergessene Bedingung in einer Abfrage zeigt nichts, was die Person nicht sehen darf. Das gilt für jede Route, jeden Export und jede Auswertung, die noch niemand geschrieben hat.
- Der Bereich einer Zeile kann nicht von dem ihrer Liegenschaft abweichen, auch nicht für einen Augenblick.
- Die Vertretung braucht keine Kopie von Zuordnungen und kein Aufräumen danach: sie wirkt an dem Tag, an dem sie gilt, und danach nicht mehr.
- Der Katalogtest der Mandantentrennung aus dem Fundament bekommt eine zweite Hälfte: jede Tabelle mit `property_id` hat `area_id`, den Schlüssel und die Policy.

Schlecht:

- Zwei Spalten mehr an jeder Tabelle mit Ortsbezug, und an Zeilen, die an einem von mehreren Bezügen hängen, ein Schlüssel je Bezug, der die Liegenschaft mitführt.
- Eine Liegenschaft mit vielen Zeilen zu verlegen ist eine große Anweisung. Sie ist selten und läuft im Büro.
- Die Datenbank liest für jede Anweisung an einer Tabelle mit Ortsbezug die Zugehörigkeit der Person. Das ist die Zehntelmillisekunde aus der Messung.
- Wer in einer Auswertung über alle Bereiche zählen will und nicht alle sehen darf, bekommt die Zahl seiner Bereiche. Das ist die Entscheidung und kein Fehler, muss aber an der Oberfläche gesagt werden, wo eine Zahl nach "alle" aussieht.
- Der Tag einer Vertretung ist der Tag der Datenbank. Eine Vertretung, die um Mitternacht endet, endet um Mitternacht in deren Zeitzone.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- eine Person mit dem Bereich Nord unter der Anwendungsrolle keine Zeile aus Süd liest oder schreibt, geprüft je Tabelle,
- eine Transaktion ohne Person in keiner Tabelle mit Ortsbezug eine Zeile sieht,
- eine verlegte Liegenschaft jede Zeile darunter mitnimmt, mit einem Test, der die Tabellen aus dem Katalog liest und keine auslässt,
- der Katalogtest eine Tabelle mit Ortsbezug ohne Spalte, Schlüssel oder Policy ablehnt, und eine Bereichs-Policy, die eine der Funktionen direkt aufruft,
- und die Messung aus Punkt 9 als Test über die Zahl der Pufferzugriffe wiederholt wird, damit eine langsame Policy auffällt.

## Vor- und Nachteile der Optionen

### A: Spalte, von einem Trigger geführt

- Gut: eine Spalte statt zweier.
- Schlecht: der Trigger muss an jeder Tabelle hängen, und der zweite, der beim Verlegen nachzieht, muss jede kennen. Eine Tabelle, die er nicht kennt, behält den alten Bereich, und nichts meldet es.

### B: Spalte, von einem Fremdschlüssel geführt

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

### C: Keine Spalte

- Gut: nichts kann auseinanderlaufen, weil es nichts Zweites gibt.
- Schlecht: jede Policy wäre ein Join bis zur Liegenschaft, je Zeile und über bis zu vier Ebenen. Zeilen, die an einem von mehreren Bezügen hängen, bräuchten vier davon.

### a: Die Anwendung setzt die Bereiche

- Gut: die Policy vergleicht nur gegen eine Einstellung und liest keine Tabelle.
- Schlecht: jede Stelle, die eine Transaktion öffnet, müsste die Bereiche richtig setzen. Eine, die es falsch tut, weitet auf, und die Datenbank kann es nicht merken.

### b: Die Datenbank leitet sie her

- Gut: es gibt keine Stelle in der Anwendung, die Bereiche weitergibt. Was eine Person sieht, steht in den Tabellen und nirgends sonst.
- Schlecht: eine Abfrage mehr je Anweisung, und Hintergrundläufe brauchen einen eigenen, ausdrücklichen Weg.

## Weitere Informationen

- ADR 0002, Datenmodell vom Ort bis zum Nachweis
- ADR 0003 im Repository `opengewerk`, Datenbank und Datenzugriff, mit dem Nachtrag "Fremdschlüssel sehen an der Row-Level Security vorbei"
- ADR 0006 im Repository `opengewerk`, Authentifizierung, Autorisierung und Mandantenfähigkeit
- Planungskonzept, Abschnitte 2.7 und 2.8
