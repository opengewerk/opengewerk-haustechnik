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
