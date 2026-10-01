---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidung 6, Abschnitte 2.7, 2.8, 4.5, 4.8 und 9; ADR 0002, 0003 und 0004; ADR 0005 im Repository `opengewerk` mit seinen Nachträgen
informed: Mitwirkende der Organisation opengewerk
---

# Abgleich ohne Netz: was ein Gerät hält, anlegt und ändert

## Kontext und Problemstellung

Technikzentrale, Keller, Aufzugsschacht und Dachzentrale haben kein Netz (Leitentscheidung 6). Die Erfassung vor Ort arbeitet vollständig ohne Verbindung, gleicht später ab und zeigt einen Konflikt, statt ihn still aufzulösen.

Den Mechanismus bringt das Fundament mit (ADR 0005 der Handwerkersoftware): eine lokale Ablage, ein Postausgang, eine Zusammenführung, die der Server entscheidet, Regeln je Entität und ein Bildschirm für den Konflikt. Was das Fundament nicht wissen kann, ist die Antwort dieser Anwendung auf drei Fragen:

1. Welche Zeilen hält ein Gerät?
2. Was darf ein Gerät ohne Verbindung anlegen und ändern, und was nur das Büro mit Verbindung?
3. Was geschieht mit dem, was sich nach einer Unterschrift nicht mehr ändern darf?

Diese Regeln werden vor dem ersten Gerät im Feld festgelegt. Eine Regel, die später strenger wird, lehnt Vorgänge ab, die schon in einem Postausgang liegen.

## Entscheidungstreiber

- Ein Rundgang, eine Prüfung und eine Bestandsaufnahme lassen sich ohne Verbindung vollständig erledigen, einschließlich der Unterschrift.
- Ein Gerät hält nichts, was die Person nicht sehen darf, auch nicht nach einem Wechsel der Person oder ihrer Bereiche.
- Zwei Leute an verschiedenen Punkten desselben Rundgangs stören einander nicht. Zwei am selben Punkt bekommen einen Konflikt und kein stilles Überschreiben.
- Was der Server ablehnen würde, lehnt schon das Gerät ab, nach denselben Regeln aus dem Paket `domain`.
- Ein einzelner abgelehnter Vorgang hält den Postausgang nicht auf.

## Betrachtete Optionen

Für die Antworten eines Rundgangs:

**A: Ein Datensatz je Rundgang**, die Antworten als ein Feld darin.

**B: Eine Zeile je Punkt.**

Für das, was ein Gerät hält:

**a: Den ganzen Betreiber**, die Oberfläche filtert.

**b: Den Ausschnitt der Person**, den der Server nach ihren Bereichen bildet.

## Entscheidung

Gewählt wurden **B** und **b**.

**Was ein Gerät hält**

1. Der Server bildet den Ausschnitt eines Geräts nach den Bereichen der Person, mit denselben zwei Funktionen der Datenbank wie die Policy (ADR 0003). Wer alle Bereiche sieht, hält den ganzen Betreiber; wer nur seine sieht, hält die Orte und Anlagen seiner Bereiche, die Pflichten daran, seine offenen Rundgänge und Aufträge und die offenen Mängel.

2. Die Antwort des Abrufs nennt je Entität, worauf sie eingeschränkt hat. Findet ein Gerät einen anderen Wert als beim letzten Mal, weil die Person gewechselt hat, ihre Bereiche sich geändert haben oder eine Vertretung begonnen oder geendet hat, lässt es die Zeilen dieser Entität fallen und holt neu ab. Beim Abmelden wird die lokale Ablage gelöscht.

3. Abgeschlossene Vorgänge bleiben eine begrenzte Zeit auf dem Gerät, Nachweise nur so weit, wie die Arbeit sie braucht: der letzte je Pflicht, als Vorlage des nächsten Protokolls und für die Anzeige "erfüllt bis". Das Nachweisverzeichnis ist ein Bildschirm des Büros.

4. Dateien liegen nicht von selbst auf dem Gerät. Fotos, die dort entstehen, warten in der lokalen Ablage und gehen vor dem Postausgang hoch.

5. Der Katalog reist nicht durch den Abgleich. Er ist Teil der Oberfläche (ADR 0005).

**Was ein Gerät anlegt und ändert**

6. Die Regeln je Entität:

   | Entität | Anlegen ohne Verbindung | Ändern ohne Verbindung |
   | --- | --- | --- |
   | Liegenschaft, Gebäude, Geschoss | nein | nein |
   | Raum | ja | ja |
   | Anlage und Komponente | ja | ja, ohne Nummer und Lebenszyklus |
   | Versorgungsbereich einer Anlage | ja | ja |
   | Pflicht, verworfener Vorschlag | nein | nein |
   | Vorgang | Mangelmeldung und Störung ja, geplante Vorgänge nein | Fortschritt ja, Zuteilung und Plan nein |
   | Antwort eines Punkts | ja | ja, bis zur Unterschrift |
   | Notiz an einem Vorgang | ja | nie |
   | Unterschrift | ja | nie |
   | Nachweis | nein | nie |
   | Mangel | ja | Bemerkung und Foto ja, Status nein |
   | Zählerstand | ja | nie, berichtigt wird durch einen neuen Stand |

   "Nein" heißt hier "nicht ohne Verbindung" und nicht "nie": das Büro ändert eine Liegenschaft über ihre Route, nur nicht über den Postausgang. Die Tabelle ist die Vorgabe für die Richtlinie im Code; die Richtlinie ist verbindlich, und ein Test hält fest, dass jede abgeglichene Tabelle eine hat.

7. **Eine Zeile je Punkt.** Die Antwort auf einen Punkt eines Rundgangs oder eines Protokolls ist ein eigener Datensatz. Zwei Geräte an verschiedenen Punkten führen zusammen, ohne dass jemand etwas merkt; zwei am selben Punkt sind ein Konflikt, den ein Mensch entscheidet.

8. **Felder, die nur der Server schreibt**, lehnt der Abgleich von einem Gerät ab: die Nummer einer Anlage, eines Auftrags und eines Nachweises, der Zustand "festgeschrieben", der Bereich und die Liegenschaft einer Zeile. Eine Anlage, die im Keller entsteht, kommt nach dem Abgleich mit ihrer Nummer zurück.

**Unterschrift und Festschreibung**

9. Unterschrieben wird auf dem Gerät, festgeschrieben auf dem Server (ADR 0004). Nach der Unterschrift ändert das Gerät an dem Vorgang nichts mehr, und der Server nimmt die Unterschrift nur für den Stand an, den sie nennt. Was der Server sonst hat, ist ein Konflikt für diesen einen Vorgang.

10. Abgegeben wird ein Rundgang erst, wenn jeder Punkt eine Antwort hat. Das prüft das Gerät vor der Unterschrift und der Server vor der Festschreibung, und es lässt sich nicht abschalten.

**Wessen Fehler ein Verstoß ist**

11. Wie im Fundament: was ein Vorgang vom Gerät verletzen kann, fragt der Abgleich als Regel, bevor die Datenbank es tut, und antwortet mit einem Konflikt für genau diesen Vorgang. Die Datenbank hält dieselbe Regel dahinter für jeden anderen Weg. Jede Regel, die ein Formular vorab fragt, steht im Paket `domain` und nirgends ein zweites Mal.

**Zeitpunkte**

12. Der Abgleich braucht den Zeitpunkt einzelner Eingaben. Sie werden nicht angezeigt und nicht ausgewertet; ein Nachweis nennt den Zeitpunkt der Unterschrift und keinen anderen (Abschnitt 9 des Konzepts).

### Konsequenzen

Gut:

- Die häufigste Arbeit vor Ort, Rundgang und Bestandsaufnahme, braucht an keiner Stelle eine Verbindung.
- Ein verlorenes oder weitergegebenes Gerät hält höchstens den Ausschnitt einer Person, und nach dem Abmelden nichts.
- Ein Konflikt entsteht dort, wo zwei Menschen wirklich dasselbe geändert haben, und nicht, weil zwei Antworten im selben Datensatz stehen.

Schlecht:

- Eine Zeile je Punkt heißt viele Zeilen: ein täglicher Rundgang mit vierzig Punkten sind im Jahr gut vierzehntausend Antworten je Ort. Sie bleiben nicht auf dem Gerät, aber in der Datenbank.
- Wer nur seine Bereiche hält, kann ohne Verbindung an keiner Anlage eines fremden Bereichs arbeiten, auch nicht im Notfall. Die Vertretung ist der Weg dafür, und sie braucht einmal eine Verbindung.
- Der Ausschnitt eines Geräts wird auf dem Server gebildet. Ein Wechsel der Bereiche wirkt auf dem Gerät erst mit dem nächsten Abgleich.
- Eine Anlage ohne Nummer ist auf dem Gerät ein eigener Zustand, den jede Liste und jedes Etikett kennen muss.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- ein Gerät im Bereich Nord keine Zeile aus Süd bekommt, auch nicht nach einem Wechsel der Person am selben Gerät,
- eine Anlage, ohne Netz angelegt, nach dem Abgleich mit ihrer Nummer zurückkommt,
- zwei Geräte, die dieselbe Antwort ändern, einen Konflikt bekommen, und zwei, die verschiedene Punkte beantworten, keinen,
- ein Test festhält, dass jede abgeglichene Tabelle eine Richtlinie hat und jede Richtlinie eine Tabelle,
- und ein Ablauftest ohne Netz einen Rundgang von der ersten Antwort bis zur Unterschrift durchspielt.

## Vor- und Nachteile der Optionen

### A: Ein Datensatz je Rundgang

- Gut: wenige Zeilen, ein Vorgang im Postausgang je Rundgang.
- Schlecht: zwei Geräte am selben Rundgang wären immer ein Konflikt, auch an verschiedenen Punkten, und der Abgleich führte ein JSON-Feld als Ganzes zusammen.

### B: Eine Zeile je Punkt

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

### a: Den ganzen Betreiber halten

- Gut: jede Person kann ohne Verbindung überall arbeiten.
- Schlecht: Leitentscheidung 8 sagt ausdrücklich, dass ein Gerät die Liegenschaften eines fremden Bereichs nicht hält. Eine Grenze, die nur die Oberfläche zieht, ist auf einem Gerät keine.

### b: Den Ausschnitt der Person halten

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

## Weitere Informationen

- ADR 0005 im Repository `opengewerk`, Offline-Synchronisation und Konfliktauflösung, mit den Nachträgen zur Auswahl je Gerät und zu der Frage, wessen Fehler ein Verstoß ist
- ADR 0003, Zuständigkeitsbereiche in der Datenbank
- ADR 0004, Nachweis und Festschreibung
- Planungskonzept, Abschnitt 2.7
