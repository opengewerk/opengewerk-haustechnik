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

Nachträge:

- **Nachtrag vom 04.10.2026, die Richtlinien im Code (#27, erster Teil).** Jede der fünfzehn Tabellen mit den Spalten des Abgleichs hat ihre Richtlinie in `packages/domain/src/model/sync.ts` (`syncPolicies`), nach der Tabelle in Punkt 6, und ein Test des Servers hält jede Tabelle, die der Abruf liest, gegen eine Richtlinie und jede Richtlinie gegen eine solche Tabelle. Was "ja" in der Spalte "Ändern" meint, ist enger, als eine Richtlinie des Fundaments sagen kann: je Art von Datensatz nennt `offlineEdits` die Felder, die ein Gerät beim Anlegen und beim Ändern ohne Verbindung schreiben darf, wo nötig mit den Werten, und ob es einen Datensatz entfernen darf. Ein Vorgang darüber hinaus ist ein Konflikt `online_only` mit den Feldern, für genau diesen Vorgang (`offlineEditRefusal`, dieselbe Funktion fragt ein Formular, bevor es etwas in den Postausgang legt). Festgelegt ist damit: ein Gerät legt von den Vorgängen nur einen Arbeitsauftrag an und dazu nur einen Auftrag für eine Störung; es setzt den Stand nur auf "Begonnen" und den Tag der Durchführung, Zuteilung, Fälligkeit und Fremdfirma sind der Plan. Ein Raum entsteht auf seinem Geschoss mit Nummer, Bezeichnung und Nutzung, eine Anlage in ihrem Gebäude, auf Wunsch in einem Raum dort und unter einer Anlage; ändern darf ein Gerät, was über beide bekannt ist, verlegen und entfernen nicht ("pflegen", Abschnitt 7 des Konzepts). Ein Eintrag im Versorgungsbereich wird angelegt oder entfernt, nie geändert. Ein Mangel entsteht mit Beschreibung, Klasse, Tag und Ort, danach ändert ein Gerät nur seine Beschreibung.

  Der Server leitet ab, was Punkt 8 ihm gibt, und diese Felder sind reserviert: den Bereich jeder Zeile aus ihrer Liegenschaft, Gebäude und Liegenschaft eines Raums aus seinem Geschoss, die Liegenschaft einer Anlage aus ihrem Gebäude, die eines Eintrags im Versorgungsbereich aus seiner Anlage und die eines Auftrags aus seinem Vorgang; die Art des Vorgangs eines Auftrags gibt die Spalte selbst vor. Die Liegenschaft eines Vorgangs und eines Mangels ist nicht reserviert: beide nennen ihren Ort selbst, die Liegenschaft und höchstens eines von Anlage, Raum und Gebäude dort (ADR 0002, Punkt 10). Jeder Bezug wird vor der Datenbank geprüft (`packages/server/src/sync/places.ts`): ein Ort, den es nicht gibt, der gelöscht ist, auf einer anderen Liegenschaft liegt oder in einem Bereich, den die Person nicht sieht, ist ein Konflikt `record_missing` mit seinem Feld; derselbe Ort zweimal im Versorgungsbereich und ein zweiter Auftrag an einem Vorgang sind ein Konflikt `changed_elsewhere`. Die Nummer einer Anlage und eines Auftrags zieht der Server beim Anlegen, in derselben Transaktion. Texte nimmt der Abgleich wie eine Route: getrimmt, und leer als nichts, wo die Spalte leer sein darf.

  Die Regeln über die Felder eines Datensatzes sind die Funktionen aus `domain`, die die Formulare fragen, gebunden als Regeln des Fundaments (`recordRuleRefusal`, in `packages/server/src/sync/record-rules.ts`), dazu die Anlagenart aus dem Katalog mit ihren Werten und ihrem Zähler. Zwei Regeln, die bis dahin nur die Datenbank kannte, stehen dafür jetzt in `domain`: höchstens ein Ziel an einem Ort (`placeTargetProblem`) und genau ein Ort je Eintrag im Versorgungsbereich (`supplyPlaceProblem`).

  Das Recht eines Vorgangs ist das engste, das ihn deckt (`permissionFor` in `packages/server/src/api/sync-routes.ts`): Räume, Anlagen und den Versorgungsbereich aufnehmen, Vorgänge ausführen, Mängel melden, solange er in `offlineEdits` bleibt, sonst das Recht der Route des Büros. So ist die Antwort auf einen Vorgang, den ein Gerät nicht schicken soll, der Konflikt für diesen Vorgang und nicht eine abgelehnte Übertragung, solange die Person das Recht des Büros hat. Einen Auftrag legt an, wer Vorgänge plant und verteilt, von Haus aus die Objektleitung (Abschnitt 4.8 des Konzepts: aus einer Störung macht die Objektleitung einen Auftrag). Ein Feld, das der Server schreibt, zählt dabei nicht mit, denn die Zusammenführung beantwortet es als `set_by_server`.

  Die Werte einer Anlage und die Arten eines Gebäudes reisen als ihr Text (Nachtrag vom 04.10.2026 in ADR 0005 im Repository `opengewerk`). Nachweise und Ungültigerklärungen reisen in Phase 0 nicht: Punkt 3 gibt einem Gerät nur die Nachweise, die die Arbeit braucht, und diese Arbeit kommt mit den Bildschirmen in Phase 1. Die Auswahl je Gerät nach dem, woran die Person arbeitet (Punkt 1 und 2), und die Unterschrift über den Abgleich (Punkt 9) folgen in den zwei weiteren Teilen von #27; bis dahin hält ein Gerät, was die Person in ihren Bereichen sieht.
- **Nachtrag vom 04.10.2026, was ein Gerät hält (#27, zweiter Teil).** Den Ausschnitt eines Geräts bildet `deviceScope` in `packages/server/src/sync/device-scope.ts`, in der Transaktion des Abrufs. Wer alle Bereiche sieht (`session_sees_all_areas()`), hält den ganzen Betreiber, und die Antwort nennt für jede Art von Datensatz `all`. Wer nur seine Bereiche sieht, hält, was die Datenbank ihn ohnehin lesen lässt, von den Orten über die Anlagen bis zu den Pflichten, und darüber hinaus eingeschränkt nur zwei Dinge: Vorgänge und Mängel. Von den Vorgängen hält er die, die ihm zugeteilt sind oder niemandem (verantwortlich oder ausführend), solange sie offen, begonnen oder unterschrieben sind, und abgeschlossene noch dreißig Tage nach ihrer letzten Änderung (`closedActivitiesStayDays` in `domain`); mit ihnen ihre Pflichten, ihren Auftrag, ihre Unterschriften und die Entscheidung über den Auftrag. Von den Mängeln hält er die offenen, festgestellt oder beauftragt. Die dreißig Tage sind eine Entscheidung beim Bau, Punkt 3 nennt keine Zahl; sie folgen der Handwerkersoftware, die einen abgeschlossenen Auftrag ebenso lange auf dem Gerät eines Monteurs lässt.

  Die Antwort nennt je Art, worauf sie eingeschränkt hat (Punkt 2): die Orte, Anlagen, Pflichten und verworfenen Vorschläge mit einem Fingerabdruck über die Liegenschaften, die die Person sieht (`properties:<…>`), die Arbeit an einem Vorgang mit einem über die gehaltenen Vorgänge (`activities:<…>`) und die Mängel mit einem über die gehaltenen Mängel (`defects:<…>`), jeweils mit `fingerprintOf` aus dem Fundament. Eine andere Person am selben Gerät, andere Bereiche, eine Vertretung, die beginnt oder endet, und eine Liegenschaft, die in einen anderen Bereich zieht, geben einen anderen Wert, und das Gerät lässt fallen, was es nicht mehr halten darf. Bei Vorgängen und Mängeln braucht es den Fingerabdruck über die Datensätze selbst: ein Vorgang, der lange genug abgeschlossen ist oder jemand anderem gegeben wurde, und ein Mangel, der behoben ist, sind genau die Änderungen, die ein eingeschränkter Abruf nicht mehr liefert. Ein neuer Vorgang oder Mangel ändert den Wert ebenfalls, und das Gerät holt die Art neu; bei der Zahl, die ein Gerät davon hält, kostet das wenig.
- **Nachtrag vom 04.10.2026, die Unterschrift über den Abgleich (#27, dritter Teil).** Eine Unterschrift entsteht auf dem Gerät, auch ohne Verbindung (Punkt 9), und reist als Datensatz `activity_signatures` mit der Richtlinie aus der Tabelle in Punkt 6: anlegen ja, ändern nie. Sie hängt am Stand ihres Vorgangs (`gateFrom`): gegeben wird sie, solange er offen oder begonnen ist, und für die Gegenzeichnung, wenn er unterschrieben ist; an einem abgeschlossenen Vorgang ist sie ein Konflikt `record_is_fixed`. Wer unterschrieben hat, Liegenschaft und Bereich schreibt der Server. Vor der Datenbank prüft er sie wie eine Unterschrift über eine Route (`checkSignature`, ADR 0004): ein Linienzug oder Fingerabdruck anderer Form und eine Seite ohne Tag der Durchführung oder ohne Ergebnis lehnen die Übertragung mit dem Satz des Formulars ab, denn das Gerät fragt dasselbe vor der Unterschrift (Punkt 10); eine Seite, die nicht die ist, die der Server aus seinen Daten errechnet, ist ein Konflikt `changed_elsewhere` mit dem Feld `pageFingerprint`, eine Unterschrift außer der Reihe einer mit dem Feld `role`, ein Vorgang, den es nicht mehr gibt, `record_missing` (Punkt 9, ADR 0004 Punkt 11). Was einer geschriebenen Unterschrift folgt, schreibt der Server in derselben Transaktion (`followSignature`, über den Haken `afterWrite` des Fundaments): sind alle verlangten Unterschriften da, je Pflicht einen Nachweis und den Stand "erledigt", sonst "unterschrieben". Die Namen, die ein Nachweis einfriert, liest er vor der Transaktion (`senderOf` in `api/sync-routes.ts`), weil ein Konto nur auf der Instanz lesbar ist; eine Übertragung ohne Unterschrift liest keine. Kann ein Nachweis nicht geschrieben werden, weil die Pflichtart den Weg nicht nimmt, lehnt das die Übertragung mit dem Satz ab und nennt die Unterschrift, damit eine Person sie verwerfen kann. Die Gegenzeichnung verlangt das Recht "Aufträge abnehmen und Rundgänge gegenzeichnen", die Unterschrift "Vorgänge ausführen". Ein Gerät hält seitdem auch jeden Mangel, der in einem seiner Vorgänge festgestellt wurde, auch einen behobenen, weil die Seite der Unterschrift ihn nennt. Die Abnahme eines Auftrags bleibt beim Büro, und die Antworten je Punkt eines Protokolls kommen mit #28.
- **Nachtrag vom 05.10.2026, die Ansprechpartner einer Liegenschaft (#85).** Die Tabelle in Punkt 6 bekommt eine Zeile: **Ansprechpartner einer Liegenschaft, anlegen nein, ändern nein.** Sie werden mit Verbindung gepflegt wie die Liegenschaft, an der sie hängen (`officeOnly` in `syncPolicies`), und reisen trotzdem auf jedes Gerät, das die Liegenschaft hält: wer vor der Tür steht, soll wissen, wen er anruft. Ein Gerät hält sie mit den Orten (`placeEntities` in `packages/server/src/sync/device-scope.ts`), und die Antwort des Abrufs nennt sie mit demselben Fingerabdruck über die Liegenschaften, damit ein Gerät sie mit der Liegenschaft fallen lässt. Was ein Gerät über einen Ansprechpartner schickt, ist ein Konflikt `online_only` für diesen Vorgang, und wer das Recht, Liegenschaften zu pflegen, nicht hat, bekommt die Übertragung mit dem Satz dieses Rechts zurück (`operationRights` in `packages/server/src/api/sync-routes.ts`). Die Handwerkersoftware lässt ein Gerät einen Ansprechpartner anlegen, weil dort der Monteur im Keller aufschreibt, wer ihm aufgemacht hat; hier nennt Abschnitt 7 des Konzepts niemanden vor Ort, der Liegenschaften pflegt. Das Büro legt einen an seiner Route an und nicht über den Postausgang (`makeAt`), berichtigt und entfernt über den Abgleich-Client, der bei einer solchen Richtlinie an die Route geht, und die Karte sagt vor dem Ausfüllen, wenn keine Verbindung da ist.
- **Nachtrag vom 05.10.2026, die Schließzeiten eines Gebäudes (#86).** Die Tabelle in Punkt 6 bekommt eine weitere Zeile: **Schließzeit eines Gebäudes, anlegen nein, ändern nein.** Sie wird mit Verbindung eingetragen und entfernt (`officeOnly` in `syncPolicies`), an den Routen unter `/buildings/:id/closures`, und reist auf jedes Gerät, das das Gebäude hält: mit den Orten (`placeEntities`) und unter demselben Fingerabdruck über die Liegenschaften, damit ein Gerät sie mit der Liegenschaft fallen lässt. Was ein Gerät über eine Schließzeit schickt, ist ein Konflikt `online_only` für diesen Vorgang, und wem das Recht fehlt, Vorgänge zu planen und zu verteilen, bekommt die Übertragung mit dem Satz dieses Rechts zurück (`operationRights`). Ein Gerät hält sie zum Lesen wie die Ansprechpartner; ob ein Rundgang entsteht, entscheidet der Server, wenn er den Plan ausführt (#113).
- **Nachtrag vom 05.10.2026, der Katalog auf dem Gerät (#90).** Der erste Satz von Punkt 5 bleibt: der Katalog reist nicht durch den Abgleich, kein Abruf nennt ihn und kein Postausgang. Der zweite gilt nicht mehr: der Katalog ist nicht Teil der Oberfläche. Ein Gerät holt ihn von seinem Server über eine eigene Route, hält ihn neben seinen Datensätzen in der lokalen Ablage des Betreibers und fragt danach nur noch nach seiner Prüfsumme (Nachtrag vom selben Tag in ADR 0005, mit den Gründen). Er hängt an keinem Bereich und an keiner Person: wer das Recht `sync.read` hat, bekommt dasselbe Bündel. Beim Abmelden geht er mit der lokalen Ablage (Punkt 2).
- **Nachtrag vom 06.10.2026, Dokumente (#97).** Die Tabelle in Punkt 6 bekommt zwei Zeilen: **Dokument, anlegen ja, ändern ja** (Bezeichnung und Art; woran es hängt, ändert niemand) und **Fassung eines Dokuments, anlegen ja, ändern nie.** Entfernt wird ein Dokument über den Postausgang, und das verlangt ein eigenes Recht (`document.remove` in `operationRights`); eine Fassung entfernt niemand. Ein Gerät hält beide mit den Orten (`placeEntities`), die Zeilen und nie die Dateien: eine Datei holt es, wenn jemand sie öffnet, über die Fassung, und der Server fragt dann, ob die Person sieht, woran das Dokument hängt. Die Liegenschaft nennt das Gerät wie bei Vorgang und Mangel, dazu höchstens eines von Anlage, Raum, Gebäude und Vorgang; den Bereich leitet der Server ab (`documentPlace` in `packages/server/src/sync/places.ts`). Eine Fassung trägt keinen Ort (Nachtrag vom selben Tag in ADR 0003); geprüft wird, dass ihr Dokument für die Person da ist und dass ihre Datei vor ihr angekommen ist (`attachmentVersionFiles` des Fundaments, vor der Prüfung des Orts): fehlt die Datei, ist das ein Konflikt `record_missing` für diese eine Fassung. **Abweichung von Punkt 6: auch das Büro legt Dokumente über den Postausgang ab** und nicht an einer Route, anders als alles andere, was das Büro schreibt. Der Baustein des Fundaments hat keine Route, die ein Dokument anlegt; die Datei geht ihrem Datensatz ohnehin voraus (`PUT /files/:sha256`), und der Weg, den ein Foto ohne Netz nimmt, ist damit der Weg jedes Dokuments. Ablegen geht im Büro auch ohne Verbindung, und die Liste sagt zu einer Fassung, dass sie noch nicht übertragen ist. Der Preis: was der Server ablehnt, erfährt das Büro als Konflikt oder als abgelehnten Eintrag im Abgleich und nicht als Antwort auf ein Formular. Deshalb fragt der Dialog dieselben Regeln, bevor er etwas einreiht (`fileDocument` in `packages/web/src/app/documents.ts`). Unterlagen für unterwegs, also die Datei selbst ohne Netz auf dem Gerät, kommen in Phase 2.
- **Nachtrag vom 06.10.2026, Etiketten (#98).** Die Tabelle in Punkt 6 bekommt eine Zeile: **Etikett, anlegen nein, ändern nie.** Den Code zieht der Server, deshalb entsteht ein Etikett nur an seiner Route und mit Verbindung, und gesperrt wird es dort. Ein Gerät hält die Etiketten seiner Orte zum Lesen (`placeEntities` in `device-scope.ts`), damit ein Scan eine Anlage auch ohne Netz findet. Kennt das Gerät einen Code nicht, fragt es mit Verbindung den Server, der in einem Wort antwortet, und holt ein Etikett, das die Person sieht, mit einem Abgleich; ohne Verbindung sagt es, dass es das Etikett nicht hält. Das Zuordnen eines Etiketts vom Bogen zu einer Anlage braucht eine eigene Richtlinie und kommt mit `#99`.
- **Nachtrag vom 06.10.2026, Bestandsaufnahme vor Ort (#99).** Drei Dinge ändern sich am Abgleich. **Erstens die Zeile des Etiketts in Punkt 6: anlegen nein, ändern zusammenführen, und davon nur `assetId`, solange das Etikett nicht gesperrt ist.** Ein Etikett vom Bogen wird vor Ort einer Anlage zugeordnet, auch ohne Netz, und reist mit ihr im selben Stapel. Code, Liegenschaft und Bereich schreibt der Server; sperren und einem Raum zuordnen bleibt `online_only`. Die Regel steht in `domain` (`labelAssignmentRefusal`), das Formular fragt sie vor dem Postausgang und der Server danach noch einmal (`sync/labels.ts`): gesperrt ist `record_is_fixed`, schon vergeben oder die Anlage schon beklebt `changed_elsewhere` an `assetId`, eine Anlage auf einer anderen Liegenschaft, in einem fremden Bereich oder entfernt `record_missing`. **Zweitens die mögliche Dublette** (Abschnitt 2.7 des Konzepts): eine Anlage, die ein Gerät anlegt, hält der Server gegen alle Anlagen des Betreibers (`sync/duplicates.ts`, nach dem Ort, mit der Funktion aus dem Nachtrag zu `#99` in ADR 0003). Das Gerät nennt in `distinctFrom`, welche Anlagen die Person gesehen und für verschieden befunden hat; für jede andere wird der Vorgang ein Konflikt, `changed_elsewhere` an `serialNumber` oder `mark`, und die Anlage entsteht nicht. Einen eigenen Grund bekommt die Dublette nicht: die Gründe sind die Liste des Fundaments und zugleich der Aufzählungstyp der Datenbank in jeder Anwendung, und "jemand war zuerst da" sagt, was geschehen ist. Das Gerät erkennt den Fall daran, dass der Server von der Anlage nichts hält und die Felder die der Dublette sind. Was mit der Anlage gesendet wurde, ihr Foto und ihr Etikett, kommt als `record_missing` zurück. **Drittens die Entscheidung**: die Karte zeichnet die Anwendung (`ownDecision`, `app/duplicate-decision.tsx`), eine für die Anlage und alles, was an ihr hing. "Trotzdem anlegen" legt die Anlage an ihrer Route an, mit Verbindung, die für eine Entscheidung ohnehin nötig ist, und hängt Foto und Etikett an die neue; "Ist dieselbe Anlage" hängt sie an die vorhandene; "Nicht anlegen" lässt alles gehen. Die Liste der Konflikte führt der Server je Gerät; die Vorschau ohne Anmeldung ist keines und zeigt deshalb keinen.
- **Nachtrag vom 08.10.2026, die Antworten je Punkt (#106).** Die Zeile **Antwort eines Punkts, anlegen ja, ändern ja, bis zur Unterschrift** in Punkt 6 hat jetzt ihre Richtlinie: `activity_answers` hängt am Stand seines Vorgangs (`gateFrom`, offen oder begonnen), Liegenschaft und Bereich setzt der Server aus dem Vorgang, und entfernt wird eine Antwort über den Postausgang. Das Recht ist "Vorgänge ausführen". Punkt 7 hält der Abgleich so: eine zweite Antwort am selben Punkt ist ein Konflikt `changed_elsewhere` am Feld "Punkt" für genau diesen Vorgang, und zwei Geräte, die dieselbe Antwort ändern, zeigt die Zusammenführung des Fundaments. Eine Antwort, die nicht zum Formular ihres Vorgangs passt, lehnt die Übertragung mit dem Satz der Engine ab, weil das Gerät dieselbe Engine mit derselben Definition fragt. Ein Gerät hält die Antworten mit den Vorgängen, die es hält. Das Formular eines Vorgangs und die Antwort eines Mangels schreibt nur der Server (`set_by_server`).
- **Nachtrag vom 08.10.2026, die Beteiligten eines Auftrags (#73, #117).** Die Tabelle in Punkt 6 bekommt eine Zeile: **Beteiligte Person eines Auftrags, anlegen nein, ändern nie.** Wer an einem Auftrag mitarbeitet, legt im Büro fest, wer plant und verteilt, mit Verbindung (`work_order_participants`, Richtlinie `officeOnly`, Art des Vorgangs, Liegenschaft und Bereich dem Server vorbehalten). Die Zeilen reisen mit der Arbeit am Vorgang, und `deviceScope` nimmt die Aufträge mit, an denen die Person beteiligt ist: ihr Gerät hält den Auftrag, auch ohne Netz. Wie dringend ein Auftrag ist und aus welchem Mangel er kam, schreibt ebenfalls nur der Server (`urgency` und `originDefectId` an `work_orders` vorbehalten); ein Auftrag, den ein Gerät anlegt, bleibt eine Störung mit der Dringlichkeit "normal".

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
