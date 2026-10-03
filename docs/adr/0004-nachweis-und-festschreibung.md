---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidung 5, Abschnitte 2.6, 4.4, 4.5, 4.8, 8, 9 und 11; ADR 0002; ADR 0003, 0005 und 0007 im Repository `opengewerk`
informed: Mitwirkende der Organisation opengewerk
---

# Nachweis und Festschreibung

## Kontext und Problemstellung

Ein Nachweis ist unveränderlich, auch für den Administrator (Leitentscheidung 5). Er ist der Beleg, dass und mit welchem Ergebnis eine Pflicht erfüllt wurde, und er wird Jahre später gebraucht: bei einer Begehung, nach einem Schaden, vor Gericht. Ein Nachweis, der sich nachträglich ändern lässt, belegt nichts, und ein Zurücksetzen, das Antworten und Unterschriften löscht, ist dieselbe Änderung unter anderem Namen.

Die Handwerkersoftware hat dieselbe Aufgabe für ihre Belege gelöst: der Stand wird mit einer Fassungsnummer eingefroren, die Unterschrift gilt einer bestimmten Seite, Trigger lehnen jede Änderung ab, und das PDF entsteht aus dem eingefrorenen Stand. Dieses ADR überträgt das Muster und entscheidet, was hier anders ist:

1. Was genau wird eingefroren, und wann?
2. Wie hält die Datenbank die Unveränderlichkeit, auch gegen ihren Eigentümer?
3. Wie wird berichtigt, wie für ungültig erklärt, wenn sich nichts ändern lässt?
4. Was geschieht ohne Netz zwischen Unterschrift und Festschreibung?
5. Wie verträgt sich Unveränderlichkeit mit dem Löschen nach Ablauf der Aufbewahrung?

## Entscheidungstreiber

- Was einmal unterschrieben ist, bleibt, wie es unterschrieben wurde, auf jedem Weg in die Datenbank.
- Ein späterer Export zeigt, was damals galt, und nicht, was heute in den Stammdaten steht: die Anlage kann umbenannt, die Pflichtart neu gefasst, die Person ausgeschieden sein.
- Die Unterschrift gilt dem, was die Person gesehen hat.
- Ein Fehler lässt sich berichtigen, ohne dass der fehlerhafte Nachweis verschwindet.
- Aufbewahrungsfristen sind verschieden und nicht immer eine Zahl von Jahren (Abschnitt 2.6): § 14 Abs. 7 BetrSichV verlangt die Aufzeichnung mindestens bis zur nächsten Prüfung, § 17 Abs. 1 BetrSichV über die gesamte Verwendungsdauer, § 44 Abs. 3 TrinkwV zehn Jahre.

## Betrachtete Optionen

Für den eingefrorenen Stand:

**A: Die Zeile selbst ist der Stand.** Der Nachweis verweist auf Anlage, Pflicht und Person, und die Trigger verbieten, die Zeile zu ändern.

**B: Ein eigener Stand als Dokument.** Neben den Verweisen trägt der Nachweis alles, was auf der unterschriebenen Seite stand, als eingefrorenes JSON mit Fassungsnummer.

Für die Berichtigung:

**a: Ändern mit Protokoll.** Ein Recht erlaubt die Änderung, das Audit-Log hält sie fest.

**b: Ein neuer Nachweis**, der den alten nennt.

## Entscheidung

Gewählt wurden **B** und **b**.

**Was ein Nachweis ist**

1. Eine Zeile in `evidence` belegt eine Durchführung für eine Pflicht: Tag der Durchführung, Ergebnis, wer ausgeführt hat (eine Person des Betreibers oder Prüfer und Organisation von außen), woraus der Nachweis entstanden ist und wer ihn festgeschrieben hat.

2. Er entsteht auf vier Wegen, und auf keinem fünften: aus einem unterschriebenen Protokoll, aus dem hochgeladenen Bericht einer Fremdfirma oder Prüforganisation, aus einem Punkt eines unterschriebenen Rundgangs, der eine Pflicht erfüllt, oder aus einem abgenommenen Arbeitsauftrag. Dazu kommt der Altbestand aus einer Vorgängeranwendung, der als solcher gekennzeichnet ist und keine Unterschrift vorgibt, die er nicht belegen kann (Abschnitt 11).

**Der eingefrorene Stand**

3. Mit der Festschreibung schreibt der Server neben die Zeile den **Stand**: alles, was auf der Seite stand, als JSON. Dazu gehören die Pflicht mit Bezeichnung, Fundstelle und der Frist, die an diesem Tag galt, der Bezug mit Nummer, Bezeichnung und Standort in Worten, die Antworten und Messwerte mit ihren Grenzwerten und deren Fundstelle, die festgestellten Mängel, die Namen der Unterschreibenden und die Prüfsummen der angehängten Dateien.

4. Der Stand trägt eine **Fassungsnummer**. Kommt ein Feld dazu, steigt sie, und der Leser kennt jede Fassung, die es je gab. Ein Test liest einen Stand der ersten Fassung, solange es die Anwendung gibt.

5. Jede Ausgabe liest den Stand und nie die laufenden Daten: die Ansicht, das PDF, das Nachweisverzeichnis, ein Export. Das PDF entsteht beim ersten Abruf aus dem Stand und liegt danach im inhaltsadressierten Dateispeicher.

6. Über dem Stand liegt ein **Fingerabdruck**, SHA-256 über seine kanonische Form. Er steht an der Zeile, im PDF und im Audit-Log. Eine Prüfung rechnet ihn nach.

**Die Unterschrift**

7. Die Unterschrift ist eine elektronische Signatur der einfachen Stufe, gebunden an das angemeldete Konto, mit Zeitpunkt und Gerät. Sie trägt den Fingerabdruck der Seite, die gezeigt wurde, und der Server nimmt sie nur an, wenn er aus seinen Daten denselben errechnet. Hat sich zwischen Anzeige und Unterschrift etwas geändert, gilt sie nicht, und die Person sieht die Seite neu.

8. Verlangt eine Vorlage eine Gegenzeichnung, entsteht der Nachweis erst mit beiden Unterschriften. Jede hat ihren eigenen Zeitpunkt und ihren eigenen Fingerabdruck.

9. Wo eine Vorschrift mehr verlangt oder ein Betreiber mehr will, wird das PDF mit einer höheren Signatur versehen und am Nachweis abgelegt. Der Nachweis selbst bleibt, was er ist. Ob die einfache Stufe für jede Nachweisart genügt, ist eine der offenen Fragen an die rechtliche Prüfung (Abschnitt 15 des Konzepts).

**Ohne Netz**

10. Unterschrieben wird auf dem Gerät, auch ohne Verbindung. Festgeschrieben wird auf dem Server: erst er vergibt die Nummer aus dem Nummernkreis, schreibt den Stand und prüft den Fingerabdruck. Zwischen beidem ist der unterschriebene Vorgang auf dem Gerät gesperrt, und sein Zustand heißt "unterschrieben, noch nicht übertragen".

11. Lehnt der Server die Unterschrift ab, weil sein Stand ein anderer ist als der gezeigte, ist das ein Konflikt für genau diesen Vorgang. Die Unterschrift wird nicht stillschweigend auf den neuen Stand übertragen.

**Unveränderlich**

12. Drei Sperren, jede für sich ausreichend:

    - Die Anwendungsrolle hat an `evidence` und an den Tabellen des Stands weder `UPDATE` noch `DELETE`.
    - Ein Trigger lehnt `UPDATE` und `DELETE` ab, für jede Rolle. Ein Trigger gilt auch für den Eigentümer der Tabellen und für einen Superuser, für den Row-Level Security nicht gilt.
    - Die Zeile steht mit ihrem Fingerabdruck im Audit-Log, dessen Hashkette eine Änderung sichtbar macht, die trotzdem geschehen ist.

13. Ein Nachweis verweist auf Datensätze, die sich ändern dürfen: Anlage, Pflicht, Person. Sie werden nur markiert gelöscht, der Verweis bleibt also gültig, und was sie am Tag der Festschreibung waren, steht im Stand. Eine Anlage mit einem Nachweis wird zurückgebaut und nicht gelöscht (ADR 0002).

**Berichtigen und für ungültig erklären**

14. **Berichtigung**: ein neuer Nachweis nennt den, den er ersetzt, mit Begründung. Beide bleiben lesbar. Für die Frist der Pflicht zählt der jüngste, der nicht ersetzt und nicht ungültig ist.

15. **Ungültigerklärung**: eine eigene Zeile in `evidence_voidings` mit Grund, Person und Zeitpunkt, höchstens eine je Nachweis und selbst unveränderlich. Der Nachweis bleibt lesbar und trägt überall, wo er gezeigt wird, den Vermerk. Ein fälschlich unterschriebener Rundgang wird so für ungültig erklärt, und seine Pflichten sind wieder offen.

16. Ein Zurücksetzen, das Antworten oder Unterschriften entfernt, gibt es nicht, auf keinem Weg und für keine Rolle.

**Aufbewahren und Löschen**

17. Wie lange ein Nachweis aufbewahrt wird, ist eine Regel und keine Zahl, mit drei Formen: eine Zahl von Jahren, mindestens bis zur nächsten Prüfung, oder so lange die Anlage verwendet wird. Sie kommt aus dem Paket der Pflichtart und steht mit dem Tag, an dem sie galt, im Stand. Ein Betreiber kann länger aufbewahren, nie kürzer.

18. Die Unveränderlichkeit kennt genau eine Ausnahme, und sie kommt in Phase 2 mit dem Löschlauf: ein Nachweis, dessen Aufbewahrung abgelaufen ist, wird nach Bestätigung durch die Leitung gelöscht, über eine Funktion der Datenbank, die das Ende der Aufbewahrung selbst prüft. Bis dahin lehnt der Trigger jedes Löschen ab. Geändert wird nie.

### Konsequenzen

Gut:

- Ein Nachweis von 2027 zeigt 2035, was 2027 galt: die damalige Frist, die damalige Fundstelle, den damaligen Namen der Anlage.
- Die Frage "wer hat das wann geändert" stellt sich nicht, weil niemand es ändern kann. Die Frage "ist das der Stand von damals" beantwortet der Fingerabdruck.
- Die vier Wege aus Leitentscheidung 1 enden in derselben Tabelle. Das Nachweisverzeichnis fragt eine Stelle.
- Eine Berichtigung ist sichtbar, und der berichtigte Nachweis auch.

Schlecht:

- Der Stand ist eine Kopie. Er kostet Platz, und jede neue Angabe, die ein Nachweis zeigen soll, ist eine neue Fassung mit einem Leser für die alten.
- Ein Tippfehler in einem festgeschriebenen Nachweis bleibt sichtbar. Wer berichtigt, hinterlässt zwei Nachweise.
- Wer unterschrieben hat, bevor die Verbindung da war, kann beim Übertragen erfahren, dass seine Unterschrift nicht gilt, weil inzwischen jemand anderes am selben Vorgang war.
- Der Löschlauf braucht eine Ausnahme im Trigger. Sie ist eng, aber sie ist eine, und sie gehört vor ihrem Bau in dieses ADR nachgetragen.

Nachträge:

- **Nachtrag vom 03.10.2026, die Zeile des Nachweises vor der Festschreibung (`#25`).** Der Termin einer Pflicht ist "letzter Nachweis plus Frist" (ADR 0002, Punkt 12), und die Fristen-Engine braucht dafür Nachweise, bevor `#26` sie festschreiben kann. Die Migration `0008_evidence_and_deadlines` legt deshalb die Zeile aus Punkt 1 an, soweit der Termin sie braucht: Pflicht, Tag der Durchführung und Ergebnis, dazu Liegenschaft und Bereich der Pflicht. Die Anwendung darf eine Zeile lesen und anlegen; ändern und löschen darf sie keine. Keine Route schreibt bis `#26` einen Nachweis. Stand, Fassungsnummer, Fingerabdruck, Nummer, wer ausgeführt und wer festgeschrieben hat, Unterschrift, Berichtigung, Ungültigerklärung und die Trigger, die Ändern und Löschen für jede Rolle ablehnen, kommen mit `#26`. Zwei Dinge gehören dabei mit hinein: wird eine Liegenschaft in einen anderen Bereich verlegt, zieht der Schlüssel den Bereich ihrer Nachweise mit (`ON UPDATE CASCADE`), ein Trigger gegen jede Änderung muss diesen einen Fall durchlassen; und eine Anlage mit einem Nachweis wird zurückgebaut und nicht gelöscht (Punkt 13), was bis dahin keine Route fragt, weil es keinen Nachweis aus einer Route gibt.
- **Nachtrag vom 03.10.2026, der eingefrorene Stand und die Festschreibung (`#26`, zweiter Schritt).** Die Migration `0010_evidence_written` gibt der Zeile aus dem Nachtrag zu `#25` alles, was ein festgeschriebener Nachweis trägt, und die Sperren dazu. An diesen Stellen sagt der Bau mehr als die Punkte 1 bis 6, 12, 13 und 17:

  1. **Der Stand steht an der Zeile des Nachweises, nicht in einer Tabelle daneben** (`evidence.state`, mit `fingerprint` daneben). Ein Nachweis entsteht erst mit der Festschreibung; einen Entwurf, an dem der Stand später ankäme, gibt es nicht, und in einer Zeile können beide nicht auseinanderfallen. Die "Tabellen des Stands" aus Punkt 12 sind damit diese eine, und die drei Sperren gelten für sie.
  2. **Fassung 1 des Stands** (`EvidenceState` in `packages/domain/src/model/evidence.ts`) trägt Nummer, Herkunft, Tag, Ergebnis mit dem Grund eines "nicht durchgeführt", die Pflicht mit Bezeichnung, Pflichtart und Fassung, Fundstelle, Frist und Zählweise, den Ort in Worten (Liegenschaft mit Anschrift, Gebäude, Raum, Anlage mit Nummer, Art und Seriennummer), den Vorgang, wer es tat, die Mängel des Vorgangs, die Unterschriften mit Name, Rolle und Zeitpunkt, die Dateien mit Prüfsumme, die Aufbewahrung und wer festgeschrieben hat und wann. Antworten und Messwerte mit ihren Grenzwerten kommen mit den Formularen (`#28`) in einer weiteren Fassung. `readEvidenceState` liest jede Fassung, die es je gab, und gibt die neueste Form heraus; ein Test liest einen Stand der Fassung 1, und ein zweiter wird rot, sobald die Fassung steigt, ohne dass Leser und gespeichertes Beispiel dazukommen.
  3. **Die kanonische Form** (`canonicalForm` in `domain`) ist JSON mit den Schlüsseln jedes Objekts in der Reihenfolge ihrer UTF-16-Codeeinheiten und ohne Leerraum. Sie nimmt nur, was JSON ohne Zweifel sagt: ganze Zahlen im sicheren Bereich, Texte, Wahrheitswerte, null, Listen und schlichte Objekte; einen Bruch, undefined oder ein Datum lehnt sie ab, statt es irgendwie zu schreiben, denn zwei Programme schreiben einen Bruch nicht sicher gleich. Den SHA-256 darüber rechnet der Server (`stateFingerprint`), und `evidenceIntact` rechnet ihn aus dem Stand der Zeile nach.
  4. **Festgeschrieben wird in einer Funktion des Servers** (`writeEvidence` in `packages/server/src/evidence/write.ts`), in der Transaktion, die sie bekommt: die Nummer aus dem Kreis `evidence`, der Stand aus dem, was die Datensätze an diesem Tag sagen, der Fingerabdruck und die Zeile. Die Namen der Personen liest der Aufrufer vorher außerhalb des Betreibers (`accountsOf` des Fundaments), weil Konten nur dort lesbar sind; die Schlüssel der Zeile binden jede genannte Person an eine Zugehörigkeit hier. Abgelehnt wird eine Pflicht, die es nicht gibt, eine Pflichtart in einer Fassung, die der Katalog nicht kennt, ein Weg, den die Pflichtart nicht als Nachweis nimmt (`evidence.kinds` im Paket), ein Vorgang, der die Pflicht nicht erfüllen soll, ein Tag, der noch kommt, "nicht durchgeführt" ohne Grund und ein Prüfer ohne Organisation. Eine Ablehnung hinterlässt nichts, auch keine Nummer: wird nach dem Ziehen der Nummer abgelehnt, geht sie mit der Transaktion zurück. Routen gibt es dafür erst mit den Abläufen aus Phase 1.
  5. **Herkunft und wer es tat**: ein Protokoll, ein Punkt eines Rundgangs und ein Auftrag nennen ihren Vorgang, der Altbestand keinen; ein Bericht nennt Prüfer und Organisation, die nur zusammen stehen; alles außer dem Altbestand nennt, wer es tat, und zwar genau eine Partei, eine Person des Betreibers oder einen Prüfer von außen; nur "nicht durchgeführt" nennt einen Grund, und immer einen (Abschnitt 4.4 des Konzepts). Die Datenbank hält jede dieser Regeln.
  6. **Der Trigger** (`evidence_stays_as_written`) lehnt `UPDATE` und `DELETE` ab und als zweiter Trigger ein `TRUNCATE`, für jede Rolle, mit der Fehlerklasse `HT003`. Durch lässt er nur eine Änderung des Bereichs, die eine Ebene tiefer läuft als die Anweisung, wie es die Kaskade des Schlüssels tut, und bei der jede andere Spalte bleibt, was sie war; der Schlüssel hält den Bereich ohnehin an dem der Liegenschaft. Ein Test zeigt das für die Anwendungsrolle, die kein Recht dazu hat, für den Eigentümer, der dafür erst `FORCE` an der Tabelle abschalten muss, um die Zeile überhaupt zu sehen, und für einen Superuser; ein vierter, dass ein fremder Trigger, der eine Ebene tiefer läuft und neben dem Bereich etwas anderes ändert, ebenso scheitert.
  7. **Eine Anlage mit Nachweis wird nicht markiert** (Trigger `assets_with_evidence_stay`, Fehlerklasse `HT004`), gefragt an den Nachweisen der Pflichten an der Anlage. Weil das Markieren eines Gebäudes, eines Raums oder einer Liegenschaft ihre Anlagen und eine Anlage ihre Komponenten mitmarkiert, scheitert es dort ebenso, und `DELETE /assets/:id` und `DELETE /buildings/:id` antworten mit 409 und dem Satz. Eine Pflicht mit Nachweis darf markiert werden, wie Punkt 13 es sagt: der Verweis bleibt gültig, und was sie war, steht im Stand.
  8. **Die Aufbewahrung steht im Stand**, mit dem Tag der Durchführung, für den die Regel gelesen wurde: eine Zahl von Jahren mit der Regel aus dem Paket im Land der Liegenschaft, "mindestens bis zur nächsten Prüfung" oder "solange die Anlage verwendet wird". Eine eigene Pflicht des Betreibers hat keine Pflichtart und damit keine Aufbewahrung aus einem Paket; was mit ihren Nachweisen geschieht, entscheidet der Löschlauf in Phase 2.

  Der Nachweis bekommt mit der Unterschrift (`#26`, dritter Schritt) seinen Weg aus einem Vorgang und mit Berichtigung und Ungültigerklärung (vierter Schritt) das Ende seiner Zählung für die Frist.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- Ändern und Löschen eines Nachweises unter der Anwendungsrolle, unter dem Eigentümer der Tabellen und unter einem Superuser scheitern, mit einem Test je Rolle,
- eine Unterschrift für eine andere Seite als die gezeigte abgelehnt wird,
- ein Test einen Stand der ersten Fassung liest und ein zweiter rot wird, wenn sich die Fassung ändert, ohne dass der Leser sie kennt,
- ein berichtigter und ein für ungültig erklärter Nachweis lesbar bleiben und für die Frist nicht mehr zählen,
- und keine Route und kein Befehl einen Nachweis oder eine Unterschrift zurücksetzen kann, was ein Test über alle Routen festhält.

## Vor- und Nachteile der Optionen

### A: Die Zeile selbst ist der Stand

- Gut: keine Kopie, kein zweites Format.
- Schlecht: der Nachweis zeigte die Anlage, wie sie heute heißt, und die Pflichtart, wie sie heute gefasst ist. Um das zu verhindern, müsste alles, worauf er verweist, ebenfalls unveränderlich sein.

### B: Ein eigener Stand als Dokument

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

### a: Ändern mit Protokoll

- Gut: ein Tippfehler ist ein Handgriff.
- Schlecht: der Nachweis, den eine Behörde sieht, wäre der geänderte, und was geändert wurde, stünde in einem Protokoll daneben, das niemand vorlegt. Das Recht dazu wäre das begehrteste der Anwendung.

### b: Ein neuer Nachweis

- Gut: beides bleibt, und die Reihenfolge ist die der Ereignisse.
- Schlecht: zwei Nachweise für eine Durchführung.

## Weitere Informationen

- ADR 0002, Datenmodell vom Ort bis zum Nachweis
- ADR 0003 im Repository `opengewerk`, Nachtrag "das Muster für eine unveränderliche Tabelle"
- ADR 0007 im Repository `opengewerk`, Dateispeicher, Dokumentenerzeugung und E-Rechnung
- Planungskonzept, Abschnitt 2.6 und Abschnitt 8
