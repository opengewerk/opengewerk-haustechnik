# OpenGewerk Haustechnik: Verfahrensbeschreibung für den Stand von Phase 1

- **Gilt für:** noch keine veröffentlichte Fassung (Entwicklungsstand von Phase 1 auf dem Zweig `main`)
- **Geschrieben:** von Hand, am 05.10.2026, aus dem Planungskonzept v0.11 und gegen den Quelltext geprüft; am 06.10.2026 um die Dateien im Speicher ergänzt (Planungskonzept v0.12) und um das Pflichtenverzeichnis, am selben Tag um die Dokumente (Planungskonzept v0.13) und um die Etiketten; am 08.10.2026 um die Prüfungen und Wartungen (Planungskonzept v0.15) und um den Bericht einer Fremdfirma (Planungskonzept v0.16), am selben Tag um die Mängel (Planungskonzept v0.17) und um den Vorgang von Hand (Planungskonzept v0.18)
- **Abgelöst durch:** die Verfahrensbeschreibung, die die Anwendung ab Phase 2 selbst erzeugt

---

## 1. Was dieses Dokument ist

OpenGewerk Haustechnik ist eine Software für Betreiber von Gebäuden und ihre Haustechnik. Sie hält fest, wer was wann geändert und unterschrieben hat: das ist der Zweck eines Nachweises. Eben deshalb ist sie geeignet, Verhalten und Leistung von Beschäftigten zu überwachen, und ihre Einführung ist mitbestimmungspflichtig, wo es eine Arbeitnehmervertretung gibt (§ 87 Abs. 1 Nr. 6 BetrVG, § 80 Abs. 1 Nr. 21 BPersVG und die Entsprechungen im Landes- und kirchlichen Recht; Abschnitte 8 und 9 des Planungskonzepts). Auf die Absicht kommt es dabei nicht an.

Dieses Dokument ist für einen Betriebsrat, einen Personalrat oder eine Mitarbeitervertretung geschrieben. Es sagt für den Stand von Phase 1, welche Daten über Beschäftigte in welchem Teil der Anwendung stehen, wer sie sieht, welche Auswertungen es gibt und welche nicht, was sich einschalten lässt, wie lange aufbewahrt wird und was das Änderungsprotokoll festhält.

Es ist allgemein gehalten und gilt für jeden Betreiber, der die Anwendung einsetzt. Verantwortlicher im Sinne des Datenschutzrechts ist der Betreiber; wer die Instanz für ihn betreibt, ist Auftragsverarbeiter. Das Dokument ist keine Rechtsberatung und keine Betriebs- oder Dienstvereinbarung, sondern die Grundlage, auf der sich eine verhandeln lässt.

**Von Hand geschrieben.** Das Planungskonzept sieht vor, dass die Anwendung ihre Verfahrensbeschreibung selbst erzeugt, aus dem, was eingeschaltet und eingestellt ist. Das kommt in Phase 2. Bis dahin gibt es dieses Dokument, damit eine Arbeitnehmervertretung es vor dem Parallelbetrieb in der Hand hat.

**Wie es zu lesen ist.** Die Anwendung ist quelloffen, und jede Aussage hier lässt sich nachprüfen. In eckigen Klammern steht, woran eine Aussage hängt:

- `K` mit einer Nummer ist der Abschnitt des Planungskonzepts (`docs/konzept/Planungskonzept.md`), aus dem sie stammt.
- `B` mit einer Nummer ist ein Beleg aus Anhang A: ein Recht, eine Stelle im Quelltext oder ein Test.

Es gibt drei Arten von Aussagen:

- Eine **Zusage** ist etwas, worauf sich eine Arbeitnehmervertretung verlassen können soll. Jede Zusage nennt einen Test, der bei jeder Änderung am Quelltext läuft und rot wird, sobald die Zusage nicht mehr stimmt. Das Planungskonzept sagt dazu: eine Zusage ohne Test ist eine Absicht.
- Alles andere in den Abschnitten 3 bis 8 ist eine **Beschreibung**: so ist es in dieser Fassung gebaut.
- Abschnitt 9 nennt, was Phase 1 noch bringt, und Abschnitt 10, was das Planungskonzept zusagt und diese Fassung **noch nicht hält**. Beides gehört zum ehrlichen Bild.

Ein Test hält außerdem dieses Dokument selbst gegen den Quelltext: jeder Beleg muss stimmen, jedes Feld der Datenbank, das auf eine Person zeigt, muss in Anhang B stehen, und jede Adresse, die der Server beantwortet, in Anhang C. Kommt mit einem Baustein von Phase 1 etwas dazu, wird der Test rot, bis dieses Dokument es nennt.

---

## 2. Das Wichtigste in Kürze

1. Die Anwendung hält zu jeder Änderung fest, wer sie gemacht hat, wann und von welchem Gerät, und zu jeder Unterschrift, wer unterschrieben hat. Nachlesen kann das im Einzelnen nur die Leitung, im Änderungsprotokoll (Abschnitt 8).
2. Das Änderungsprotokoll enthält auch, wann sich eine Person bei dem Betreiber an- und abgemeldet hat, und es lässt sich nach Person filtern. Unter „Zugänge“ sieht die Leitung, wann eine Person zuletzt angemeldet war und auf welchen Geräten (Abschnitte 3.3 und 8). Das sind die Stellen, an denen die Anwendung einer Überwachung am nächsten kommt. Dazu kommt das Pflichtenverzeichnis: es nennt zu jeder Pflicht, wer für sie verantwortlich ist, und wer es führt, kann es auf die Pflichten einer Person eingrenzen, auch auf die überfälligen (Abschnitte 3.4 und 5).
3. Es gibt in dieser Fassung keine Auswertung: keine Statistik, keine Rangliste, keine Zahl je Person, keinen Export (Abschnitt 5).
4. Es gibt keine Erfassung von Arbeitszeit und keinen Standort. Ein Auftrag trägt eine Dauer als seinen Aufwand, eine Zahl für den ganzen Auftrag und nicht je Person (Abschnitte 3.4 und 6).
5. Diese Fassung löscht nichts nach Ablauf einer Frist. Das Löschkonzept kommt in Phase 2 (Abschnitte 7 und 10).
6. Was das Planungskonzept zusagt und diese Fassung noch nicht hält oder noch nicht durch einen Test hält, steht in Abschnitt 10.

---

## 3. Welche Daten über Beschäftigte wo stehen

Anhang B nennt jedes Feld der Datenbank, das auf eine Person zeigt. Dieser Abschnitt sagt dasselbe in Worten und nennt, was darüber hinaus zu einer Person gespeichert ist.

### 3.1 Konto und Anmeldung

- Ein Konto hält den Namen, die E-Mail-Adresse, ob die Adresse bestätigt ist und ob ein zweiter Faktor eingerichtet ist. Das Passwort steht nur als Hash in der Datenbank, der zweite Faktor und seine Wiederherstellungscodes verschlüsselt. [K3, K9]
- **Zusage:** Zu einem Passkey stehen der Name, den die Person ihm gibt, die Art des Geräts und wann er angelegt und zuletzt benutzt wurde. Sehen kann ihn nur das eigene Konto. [K3, B52]
- Ein Protokoll fehlgeschlagener Anmeldungen je Konto gibt es nicht. Gezählt werden Versuche je Netzadresse und Weg, für kurze Zeit, damit niemand Passwörter durchprobiert. [K9, B46]

### 3.2 Zugehörigkeit, Rollen, Bereiche, Vertretung

- Wer bei einem Betreiber arbeitet, hat dort eine Zugehörigkeit mit einer oder mehreren Rollen. Verlässt jemand den Betreiber, wird die Zugehörigkeit gesperrt und nicht gelöscht: die Person bleibt in der Liste und in allem, was sie unterschrieben hat. [K7, B50]
- Eine Einladung hält Name, E-Mail-Adresse, Rollen und Bereiche der eingeladenen Person und wer eingeladen hat. Ihr Link gilt sieben Tage. In dieser Fassung verschickt die Anwendung keine E-Mail; die Leitung gibt den Link selbst weiter. [K7, B63, B67]
- **Zusage:** Name und E-Mail-Adresse eines Kontos berichtigt die Leitung und keine andere Rolle, und die Berichtigung steht mit dem Wert davor und danach im Änderungsprotokoll. [K3, B13, B70]
- **Zusage:** Für jede Person steht fest, ob sie alle Bereiche sieht oder welche. Festlegen und ändern kann das nur die Leitung. [K2.8, B18]
- **Zusage:** Eine Vertretung hält fest, wer wen von welchem Tag bis zu welchem Tag vertritt. An diesen Tagen sieht die vertretende Person zusätzlich die Bereiche der abwesenden, davor und danach nicht. [K2.8, B20]

### 3.3 Geräte und Sitzungen

- Zu jeder Anmeldung gibt es eine Sitzung: die Kennung des Browsers, eine zufällige Kennung des Geräts, die der Browser selbst erzeugt, der Beginn, der Ablauf und der Weg der Anmeldung (Passwort oder Passkey). Reicht der vorgeschaltete Webserver die Netzadresse der Anmeldung durch, steht auch sie in der Zeile der Sitzung; die Anwendung liest sie nicht und zeigt sie nirgends an (Abschnitt 10). [K9, B62]
- **Zusage:** Eine Sitzung endet nach zwölf Stunden. Ein Gerät, das sich für den Abgleich angemeldet hat, bleibt dreißig Tage angemeldet. [K9, B44]
- **Zusage:** Jede Person sieht unter „Konto“ die Geräte, auf denen sie angemeldet ist, und meldet sie dort ab. Die Geräte eines anderen Kontos sieht sie nicht und meldet sie nicht ab. [K3, B42, B43]
- Die Leitung sieht unter „Zugänge“, auf welchen Geräten eine Person bei diesem Betreiber angemeldet ist, seit wann und bis wann, und kann ein Gerät abmelden. [K9, B49]
- Jede Anmeldung bei einem Betreiber und jede Abmeldung steht als Zeile fest: wer, welches Gerät, Beginn, Ende, Weg der Anmeldung. Diese Zeilen stehen auch im Änderungsprotokoll. [K9, B45]
- Die Liste „Zugänge“ zeigt je Person die Rollen, ob sie gesperrt ist, wann sie zuletzt bei diesem Betreiber angemeldet war, ob ein zweiter Faktor eingerichtet ist und ob es einen Passkey gibt. [K7, B48]

### 3.4 Zuständigkeit und Zuteilung

- Eine Pflicht nennt, wer für sie verantwortlich ist und wer sie bestätigt hat; ein verworfener Vorschlag nennt, wer ihn verworfen hat, mit Grund. Das Pflichtenverzeichnis führen die Leitung und die Technische Leitung. [K4.3, B11]
- Das Pflichtenverzeichnis und die Seite einer Pflicht nennen die verantwortliche Person mit ihrem Namen, und sie sagen es, wenn für eine Pflicht niemand benannt ist. Lesen kann beides, wer Pflichten ansieht, das sind alle vier Rollen, jede in ihren Bereichen. Wer eine Pflicht bestätigt hat, zeigt kein Bildschirm außer dem Änderungsprotokoll. [K4.3, K7, B75]
- **Zusage:** Wer für eine Pflicht verantwortlich ist, legt fest, wer das Pflichtenverzeichnis führt. Zur Wahl bekommt diese Person die Namen derer, die für den Betreiber arbeiten, und ob jemand gesperrt ist; Rolle, E-Mail-Adresse und Anmeldungen nennt die Auswahl nicht. Objektleitung und Haustechnik bekommen die Auswahl nicht. [K4.3, K7, B76, B77]
- Eine Frist nennt, wer für sie verantwortlich ist, wen ihre Quelle als verantwortlich nennt und wer sie geschlossen hat. Fristen sehen die Leitung und die Technische Leitung. [K2.4, B10]
- Die Liste „Fristen“ nennt zu jeder Frist die verantwortliche Person mit ihrem Namen. Wer einer Frist eine andere Person gibt oder für eine Art von Frist festlegt, wen sie erinnert, bekommt dieselbe Auswahl wie im Pflichtenverzeichnis: die Namen derer, die für den Betreiber arbeiten, und ob jemand gesperrt ist. Neben dem Eintrag „Fristen“ der Navigation steht, wie viele Fristen in den Bereichen der Person überfällig sind; diese Zahl gilt dem Betreiber und keiner Person. [K2.4, K7, B10, B76]
- Ein Vorgang (Rundgang, Prüfung, Wartung, Auftrag) hat ein Feld für die verantwortliche und eines für die ausführende Person, dazu die Angabe, ob die eigenen Leute oder eine Fremdfirma ihn ausführen, und den Namen der Fremdfirma in Worten. Eine Prüfung oder Wartung entsteht von selbst, wenn der Vorlauf eines Termins beginnt, einmal je Termin. Verantwortlich ist dann, wen die Frist als verantwortlich nennt, und ausführend noch niemand. [K2.4, K4.4, B98]
- Wer Vorgänge plant und verteilt, legt eine Prüfung oder Wartung auch von Hand an, auf der Seite einer Pflicht, für die gerade keine läuft. Verantwortlich ist dann, wen die Pflicht als verantwortlich nennt, und ausführend noch niemand. Eine offene oder begonnene Prüfung oder Wartung schließt dieselbe Person mit Grund als nicht durchgeführt; der Vorgang nennt den Grund und nicht die Person, wer ihn geschlossen hat, steht im Änderungsprotokoll. Die Haustechnik kann beides nicht. [K4.4, K7, B109, B110]
- **Zusage:** Wer eine Prüfung oder Wartung verantwortet und wer sie ausführt, legt fest, wer Vorgänge plant und verteilt: die Leitung, die Technische Leitung und die Objektleitung, solange der Vorgang offen ist. Zur Wahl stehen nur Personen, die den Bereich des Vorgangs sehen und nicht gesperrt sind; verantwortlich, wer selbst plant und verteilt, ausführend, wer Vorgänge ausführt. Die Auswahl nennt die Namen und sonst nichts. Die Haustechnik plant nicht und bekommt die Auswahl nicht. [K4.4, K7, B7, B99, B100]
- Der Plan eines Rundgangs nennt die Person, die seine Rundgänge geht, oder niemanden. Aus dem Plan entsteht jeder Durchgang als eigener Rundgang, einmal, und zwar so weit im Voraus, wie es die Art „Rundgang nach Plan“ unter „Fristen“ sagt, als Vorgabe 14 Tage. Ein Rundgang nennt als ausführend die Person des Plans und als verantwortlich niemanden; nennt der Plan niemanden, nennt der Rundgang auch keine ausführende Person. Die Frist eines Plans nennt keine Person, für sie steht die Leitung ein. [K2.4, K4.5, B121, B124]
- **Zusage:** Wer einen Rundgang geht, legt fest, wer Vorgänge plant und verteilt: die Leitung, die Technische Leitung und die Objektleitung, im Plan und für einzelne Rundgänge einer Woche, auch „wie letzte Woche“, solange niemand den Rundgang begonnen hat. Zur Wahl stehen nur Personen, die Vorgänge ausführen, den Bereich sehen und nicht gesperrt sind; die Auswahl nennt die Namen und sonst nichts, und nur für einen Bereich, den die fragende Person sieht. Die Haustechnik plant nicht und bekommt die Auswahl nicht. [K4.5, K7, B7, B122, B125, B126, B127]
- Bekommt ein Plan eine andere Person, gehen die Rundgänge ab heute, die noch niemand begonnen hat, an sie über, außer denen, die jemand anderem zugeteilt wurden. Ändert sich der Plan, ruht er oder endet er, entfallen die Rundgänge ab heute, die noch niemand begonnen hat und die er nicht mehr verlangt; ein begonnener oder vergangener Rundgang bleibt. Wer einen Plan geändert oder einen Rundgang zugeteilt hat, nennt der Plan nicht; das steht im Änderungsprotokoll. [K4.5, B123, B130]
- Die Seite eines Rundgangs im Büro nennt, wer ihn geht, und erst mit der Unterschrift seine Antworten, dazu die Unterschrift mit dem Namen der Person, ihrer Zeichnung oder dem getippten Namen und dem Zeitpunkt. Die Antworten eines Rundgangs, den noch niemand unterschrieben hat, zeigt das Büro nicht: bis zur Unterschrift sind sie die Arbeit der Person, die ihn geht. [K4.5, B131]
- **Zusage:** Einen Rundgang, dessen Vorlage es verlangt, gegenzeichnen kann, wer Aufträge abnimmt und Rundgänge gegenzeichnet: die Leitung, die Technische Leitung und die Objektleitung, im Büro und für die Seite, wie sie gezeigt wurde. Die Gegenzeichnung hält fest, wer gegengezeichnet hat und wann, mit der Zeichnung oder dem getippten Namen; erst mit ihr entstehen die Nachweise. Die Haustechnik kann es nicht. [K4.5, K7, B8, B132]
- Einen offenen oder begonnenen Rundgang eines vergangenen Tages schließt, wer Vorgänge plant und verteilt, mit Grund als nicht durchgeführt; er bleibt lesbar und erfüllt keine Pflicht. Der Rundgang nennt den Grund und nicht die Person, wer ihn geschlossen hat, steht im Änderungsprotokoll. Die Haustechnik kann es nicht. [K4.5, K7, B133]
- Ein Auftrag nennt die Person, die ihn führt (im Büro „Verantwortlich“), und weitere Beteiligte; das Feld der ausführenden Person bleibt bei einem Auftrag aus dem Büro leer. Wer Vorgänge plant und verteilt, legt einen Auftrag an, aus einem festgestellten Mangel, aus dem Termin einer Pflicht oder von Hand, und ändert ihn, bis er unterschrieben ist. Wer einen Auftrag angelegt oder geändert hat, nennt der Auftrag nicht; das steht im Änderungsprotokoll. [K4.8, B111]
- **Zusage:** Wer einen Auftrag führt und wer an ihm beteiligt ist, legt fest, wer Vorgänge plant und verteilt: die Leitung, die Technische Leitung und die Objektleitung. Zur Wahl stehen nur Personen, die Vorgänge ausführen, den Bereich des Auftrags sehen und nicht gesperrt sind; die Auswahl nennt die Namen und sonst nichts. Die Haustechnik legt keinen Auftrag an, ändert keinen und bekommt die Auswahl nicht. [K4.8, K7, B112, B113, B114, B118]
- Eine beteiligte Person ist eine Zeile je Auftrag und Person. Wird jemand vom Auftrag genommen, wird die Zeile markiert und nicht gelöscht, und das Gerät dieser Person gibt den Auftrag mit dem nächsten Abgleich ab. Auf der unterschriebenen Seite stehen die Beteiligten nicht. [K4.8, B115]
- Einen offenen oder begonnenen Auftrag schließt, wer Vorgänge plant und verteilt, mit Grund als nicht durchgeführt, etwa einen irrtümlich angelegten; der Auftrag nennt den Grund und nicht die Person, wer ihn geschlossen hat, steht im Änderungsprotokoll. Die Haustechnik kann es nicht. [K4.8, K7, B120]
- **Zusage:** Einen unterschriebenen Auftrag abnehmen oder mit Grund zurückweisen kann, wer Aufträge abnimmt: die Leitung, die Technische Leitung und die Objektleitung. Die Haustechnik kann es nicht. [K4.8, K7, B116]
- Die Abnahme eines Auftrags hält fest, wer abgenommen oder zurückgewiesen hat, wann und mit welcher Begründung. Eine Zurückweisung lässt die Unterschrift stehen und macht sie ungültig. [K4.8, B8, B25]
- Ein Auftrag trägt eine Dauer: den Aufwand des Auftrags in Stunden und Minuten, eine Zahl für den ganzen Auftrag und nicht je Person. Eintragen und ändern kann sie vor Ort, wer Vorgänge ausführt, bis der Auftrag unterschrieben ist; sie nennt keine Person und keine Uhrzeit und ist keine Arbeitszeiterfassung. Wer sie eingetragen oder geändert hat, steht nur im Änderungsprotokoll. Ein Feld für eine Arbeitszeit oder einen Standort gibt es nicht. [K4.8, K4.14, K9, B134]
- **Zusage:** Eine Notiz zu einem Auftrag ist ein eigener Eintrag: ihr Text, die Person, die sie geschrieben hat, und der Zeitpunkt nach der Uhr des Geräts. Die Person setzt der Server selbst ein und übernimmt sie nicht vom Gerät. Nach dem Speichern ändert und löscht niemand eine Notiz, auf dem Gerät nicht, über den Abgleich nicht und in der Datenbank nicht; was nicht stimmt, sagt eine weitere Notiz. Die Seite des Auftrags im Büro und vor Ort zeigt die Notizen mit Namen und Uhrzeit, auf der unterschriebenen Seite stehen nur ihre Texte. [K4.8, B135, B137]
- **Zusage:** Einen Auftrag abschließen, also unterschreiben, kann nur die Person, die ihn führt. Die weiteren Beteiligten schreiben Notizen, machen Fotos und tragen die Dauer ein; ihre Unterschrift lehnt der Server ab, und solange niemand den Auftrag führt, schließt ihn niemand ab. [K4.8, B136, B138]

### 3.5 Unterschriften und Nachweise

- Eine Unterschrift hält fest: wer unterschrieben hat, ob als Unterschrift oder als Gegenzeichnung, den Zeitpunkt nach der Uhr des Geräts und den, zu dem der Server sie bekam, eine Angabe zum Gerät von höchstens 500 Zeichen, den Schriftzug als Linienzug oder, wo jemand ohne Schriftzug unterschreibt, den getippten Namen, und einen Fingerabdruck der Seite, die gezeigt wurde. Der Linienzug besteht aus Punkten und Linien; Druck und Geschwindigkeit des Schreibens hält er nicht fest. [K2.6, B61, B69]
- **Zusage:** Wer ohne Schriftzug unterschreibt, bestätigt mit dem eigenen Namen, wie er im Konto steht; einen anderen Namen nimmt der Server nicht, auch nicht von einem Gerät ohne Netz. Eine Unterschrift hat genau einen der beiden Wege. Der Nachweis, der eingefrorene Stand eines Rundgangs und ihr PDF sagen, welcher Weg es war. [K2.6, B152, B153, B154, B155]
- **Zusage:** Einen Zeitpunkt der Unterschrift, der mehr als fünf Minuten nach der Uhr des Servers liegt oder vor dem Tag der Durchführung, nimmt der Server nicht. Der Nachweis, sein PDF und das PDF eines Rundgangs nennen beide Zeitpunkte: den des Geräts und den, zu dem der Server die Unterschrift bekam. [K2.6, B156, B157]
- **Zusage:** Unterschrieben wird im Namen des Kontos, das angemeldet ist. Der Server setzt die Person selbst ein und übernimmt sie nicht vom Gerät. [K2.6, B22]
- Mit der Unterschrift entsteht der Nachweis und friert seinen Stand ein: den Namen der Person, die unterschrieben hat, ihre Rolle dabei, den Zeitpunkt und den Schriftzug oder dass sie mit dem getippten Namen bestätigt hat; bei einem eingetragenen Bericht den Namen des Prüfers und seine Organisation; dazu, wer den Nachweis eingetragen hat. Ein späterer Namenswechsel ändert daran nichts. Ein Nachweis, der vor dieser Fassung entstand, hat den Schriftzug nicht eingefroren. [K2.6, B24, B30]
- Mit der Unterschrift friert der Server auch den Rundgang im Ganzen ein, auch einen, der keine Pflicht erfüllt: seine Antworten mit den Fotos, die Mängel, die aus ihm hervorgingen, die Unterschriften mit Namen, Rolle, Zeitpunkt und Schriftzug oder dem Weg ohne ihn, wer ihn gegangen ist und in wessen Namen er eingetragen wurde. [K2.6, B148]
- **Zusage:** Das PDF eines Nachweises und eines Rundgangs entsteht aus dem eingefrorenen Stand, nie aus den laufenden Daten. Einmal erzeugt, bleibt es dieselbe Datei, auch wenn sich später ein Name ändert; wird ein Nachweis für ungültig erklärt, entsteht es einmal neu, mit der Erklärung. Das PDF eines Nachweises bekommt, wer den Nachweis sieht; das eines Rundgangs, wer seine Seite sieht. [K2.6, B149, B150]
- **Zusage:** Den eingefrorenen Stand eines Rundgangs und ein erzeugtes PDF ändert und löscht niemand, auch nicht der Eigentümer der Tabellen. [K2.6, B151]
- **Zusage:** Eine Unterschrift, die Abnahme eines Auftrags und ein Nachweis werden von niemandem geändert oder gelöscht, auch nicht vom Eigentümer der Tabellen und nicht von einem Administrator der Datenbank. Kein Recht hebt das auf. [K2.6, K7, B26, B27, B39]
- Eine Berichtigung ist ein neuer Nachweis, der den alten nennt; beide bleiben. Eine Ungültigkeitserklärung nennt die Person und den Grund, und der Nachweis bleibt lesbar. Beides dürfen die Leitung, die Technische Leitung und die Objektleitung. [K2.6, B9, B28, B96]
- **Zusage:** Den Bericht einer Fremdfirma oder Prüforganisation tragen die Leitung, die Technische Leitung und die Objektleitung ein, in ihren Bereichen. Die Haustechnik bekommt den Weg nicht angeboten, und der Server lehnt sie ab. Mit dem Eintragen entsteht der Nachweis: er nennt den Prüfer und seine Organisation, den Tag der Prüfung und das Ergebnis, trägt die Datei, wie sie hochgeladen wurde, und nennt, wer ihn eingetragen hat. [K4.4, K7, B9, B103, B104]
- **Zusage:** Die Datei, auf die sich ein Nachweis stützt, gibt der Server nur über den Nachweis aus und nur an den, der ihn sieht: beim eigenen Betreiber und in den Bereichen der Person. Nimmt jemand das Dokument der Datei aus der Ablage, bleibt sie am Nachweis lesbar. [K2.6, K4.10, B105, B106]
- Die Seite einer Pflicht listet ihre Nachweise mit Nummer, Tag, Ergebnis und Herkunft und sagt zu jedem, ob er für die Frist zählt, ersetzt oder für ungültig erklärt ist. Lesen kann die Liste, wer Nachweise ansieht, das sind alle vier Rollen, jede in ihren Bereichen. [K2.6, K4.3, B78]
- **Zusage:** Diese Liste nennt keine Person: weder wer geprüft, noch wer unterschrieben, noch wer den Nachweis eingetragen hat. [K2.6, B79]
- Die Seite eines Nachweises zeigt ihn im Ganzen, aus seinem eingefrorenen Stand: wer die Arbeit ausgeführt oder geprüft hat, wer unterschrieben hat, mit Rolle und Zeitpunkt, und wer den Nachweis eingetragen hat. Ist er für ungültig erklärt, nennt sie dazu die Person, den Zeitpunkt und den Grund. Lesen kann die Seite, wer Nachweise ansieht, das sind alle vier Rollen, jede in ihren Bereichen. [K2.6, B78, B93]
- Eine Berichtigung trägt keine Unterschrift. Sie nennt, wer sie eingetragen hat, und die Unterschriften bleiben am Nachweis, den sie ersetzt: sie wurden für dessen Seite gegeben. [K2.6, B94]
- Die Antworten auf die Punkte eines Formulars, eines Rundgangs oder eines Prüfprotokolls, halten je Punkt fest, was eingetragen wurde: das Ergebnis eines Prüfpunkts, einen Wert, eine Bemerkung und ein Foto, das ein Dokument am Vorgang ist (Abschnitt 3.9). Eine Antwort nennt keine Person; wer sie zuletzt geändert hat, steht in ihrem Stempel (Abschnitt 3.6). Bis zur Unterschrift ändern sie die Personen, die den Vorgang ausführen, auch ohne Netz. [K2.5, K2.7, K4.5]
- Mit der Unterschrift friert der Nachweis die Antworten ein, in der Reihenfolge des Formulars, einen Messwert mit seinem Grenzwert und dessen Fundstelle; Zeitpunkt und Person einer einzelnen Eingabe hält er nicht fest. Danach ändert niemand eine Antwort, auch nicht der Eigentümer der Tabellen; wird ein Auftrag zurückgewiesen, geht die Arbeit an ihm weiter. [K2.6, K2.7, K4.5, K9]
- Die Akte einer Anlage und ihre Seite vor Ort listen die Nachweise der Anlage mit Nummer, Pflicht, Tag, Ergebnis und dem, was er für die Frist heißt. Auch diese Liste nennt keine Person. [K2.6, B95]

### 3.6 Was jeder Datensatz über seine letzte Änderung trägt

- Jeder Datensatz, der auf Geräte reist, trägt einen Stempel: wer ihn zuletzt geändert hat, von welchem Gerät, wann, und die wievielte Fassung es ist. Der Abgleich braucht davon die Fassung und die Reihenfolge. [K2.7, K9, B33]
- Der Stempel reist mit dem Datensatz: er steht in den Antworten des Servers und auf den Geräten derer, die den Datensatz lesen dürfen. Kein Bildschirm zeigt ihn an, außer dem Änderungsprotokoll; eine Liste im Büro lässt sich nach „Zuletzt geändert“ ordnen, ohne den Zeitpunkt zu nennen (Abschnitt 10). [K2.7, K9]
- Der Server führt eine Quittung je Änderung, die ein Gerät geschickt hat: die Kennung des Geräts und wann sie ankam, ohne Person. Einen Konflikt beim Abgleich sieht nur das Gerät, das ihn zu entscheiden hat; er nennt der Person, wann sie ihre Änderung erfasst hat. [K2.7, B57]
- Eine Datei im Speicher nennt keine Person: zu ihr stehen der Betreiber, die Prüfsumme, die Größe und die Art der Datei. Wer sie geschickt hat und wann, steht im Änderungsprotokoll, wie bei jedem Datensatz. Schicken kann eine Datei, wer Dokumente ablegen darf, das sind alle vier Rollen. Der Server gibt eine Datei nie nach ihrer Prüfsumme aus, sondern nur über den Datensatz, der sie nennt: die Fassung eines Dokuments (Abschnitt 3.9) oder einen Nachweis (Abschnitt 3.5). [K4.10, K7, B72, B73, B74, B105]

### 3.7 Was auf dem Gerät liegt

- **Zusage:** Ein Gerät hält, was seine Person nach ihren Bereichen sieht, und nichts aus dem Bereich daneben. Wer alle Bereiche sieht, hält den ganzen Betreiber. [K2.7, B21]
- **Zusage:** Ändert die Leitung die Bereiche einer Person, sieht sie sofort nur noch die neuen, und ihr Gerät lässt beim nächsten Abgleich los, was nicht mehr dazugehört. [K2.8, B19]
- **Zusage:** Beim Abmelden wird die lokale Ablage des Geräts gelöscht, für jeden Betreiber, bei dem die Person angemeldet war. [K2.7, B58]
- Bis zum Abmelden merkt sich der Browser das Konto: Name, E-Mail-Adresse, die Betreiber der Person und ihre Rollen und Rechte dort. [K2.7, B68]
- Ein abgeschlossener Vorgang bleibt dreißig Tage auf dem Gerät der Person, der er zugeteilt war. [K2.7, B23]
- Eine Prüfung oder Wartung, die jemandem zum Ausführen zugeteilt wird, liegt nach dem nächsten Abgleich auf dem Gerät dieser Person, solange sie offen ist. [K2.7, K4.4, B102]
- Ein Rundgang, den der Plan oder das Büro niemandem zugeteilt hat, liegt auf den Geräten aller im Bereich; einer, der jemandem zugeteilt ist, auf dem Gerät dieser Person. Die Pläne der Rundgänge liegen auf den Geräten aller, die ihren Bereich sehen, zum Lesen, mit der Kennung des Kontos, das ein Plan nennt; den Namen dazu nennt der Server der Haustechnik nur für Rundgänge, die ihr oder niemandem zugeteilt sind. Wie bei einer Pflicht, die ihre verantwortliche Person nennt. [K2.7, K4.5, B127, B128]
- Die Notizen eines Auftrags liegen mit ihm auf den Geräten, die ihn halten, mit der Kennung des Kontos, das sie geschrieben hat. Die Namen dazu hält ein Gerät nicht: mit Verbindung fragt es sie für die Seite des Auftrags beim Server, ohne Verbindung nennt es nur den eigenen. [K2.7, K4.8]
- Der Start vor Ort zeigt der Person, die das Gerät hält, ihre eigenen Vorgänge von heute und dieser Woche und die, die niemandem zugeteilt sind; was einer anderen Person zugeteilt ist, zeigt er nicht. Ein begonnener Vorgang heißt dort „begonnen“, ohne Uhrzeit: eine eigene Zeit des Beginns hat ein Vorgang nicht, wann er auf „begonnen“ ging, steht nur im Änderungsprotokoll (Abschnitt 8). [K2.7, K4.5]

### 3.8 Daten über Dritte

- Ansprechpartner einer Liegenschaft stehen mit Vorname, Name, Funktion, E-Mail-Adresse und Telefonnummer dort. Lesen kann sie, wer die Liegenschaft sieht, auch auf dem Gerät vor Ort; pflegen können sie die Leitung und die Technische Leitung. [K4.1, K7, B5, B6, B35]
- Ein Nachweis aus dem Bericht einer Fremdfirma oder Prüforganisation nennt den Prüfer und seine Organisation als freien Text. [K2.6, B29]
- Melder einer Störung und Auftraggeber eines Leistungsnachweises gibt es in Phase 1 nicht; beides kommt in Phase 2. [K9, K12]

### 3.9 Dokumente und ihre Fassungen

- Ein Dokument hängt an einer Liegenschaft, einem Gebäude, einem Raum, einer Anlage, einem Vorgang oder einem Mangel, dessen Foto es ist, hat eine Bezeichnung und auf Wunsch eine Art, und trägt wie jeder Datensatz seinen Stempel (Abschnitt 3.6). Darüber hinaus nennt ein Dokument keine Person. [K4.10, K2.7]
- Die Datei eines eingetragenen Berichts wird als Dokument der Art „Prüfbescheinigung“ an der Anlage oder dem Ort seiner Pflicht abgelegt, von der Person, die den Bericht einträgt; ihre Fassung nennt diese Person wie jede andere. [K4.4, K4.10]
- **Zusage:** Eine Fassung eines Dokuments hält fest, wer sie abgelegt hat. Die Datenbank setzt die Person aus der Anmeldung ein und übernimmt sie nicht vom Gerät. [K4.10, B82]
- Wer eine Fassung abgelegt hat, reist als Kennung des Kontos mit der Fassung: sie steht in den Antworten des Servers und auf den Geräten derer, die das Dokument sehen, wie der Stempel eines Datensatzes. [K2.7, K4.10]
- Der Bildschirm „Dokumente“ und die Karten an Anlage, Raum und Liegenschaft nennen zu einer Fassung den Tag, an dem sie abgelegt wurde, und weder die Person noch die Uhrzeit. Wer eine Fassung abgelegt hat, zeigt das Änderungsprotokoll, das zu einem Dokument auch seine Fassungen nennt (Abschnitt 8). [K4.10, K9, B83]
- **Zusage:** Die Datei einer Fassung gibt der Server nur an den aus, der sieht, woran das Dokument hängt: beim eigenen Betreiber und in den Bereichen der Person. Wer außerhalb steht, bekommt dieselbe Antwort wie auf eine Fassung, die es nie gab. [K4.10, K2.8, B84]
- Dokumente ansehen und ablegen können alle vier Rollen, jede in ihren Bereichen; dazu gehören eine neue Fassung und die Berichtigung von Bezeichnung und Art. Aus der Ablage nehmen können ein Dokument die Leitung, die Technische Leitung und die Objektleitung. [K7, B85, B72, B86]
- **Zusage:** Ein Dokument, das jemand aus der Ablage nimmt, wird markiert und nicht gelöscht, und ausgegeben wird es danach niemandem mehr. Seine Fassungen und ihre Dateien bleiben aufbewahrt, und mit ihnen, wer sie abgelegt hat (Abschnitt 7). [K4.10, B87]

### 3.10 Etiketten

- Ein Etikett mit QR-Code hängt an einer Anlage oder einem Raum, oder es stammt von einem Bogen für die Bestandsaufnahme und gehört zu einer Liegenschaft. Es trägt einen zufälligen Code und wie jeder Datensatz seinen Stempel (Abschnitt 3.6): wer es angelegt und wer es gesperrt hat, steht dort und im Änderungsprotokoll. Darüber hinaus nennt ein Etikett keine Person. [K3, K4.2]
- Auf dem gedruckten Etikett stehen der Betreiber, die Anlage oder der Raum und der Ort, und keine Person. [K3]
- Ein Etikett vom Bogen ordnet vor Ort einer Anlage zu, wer Anlagen aufnimmt. Wer es zugeordnet hat, steht wie bei jeder Änderung im Stempel des Etiketts und im Änderungsprotokoll, und sonst nirgends. [K4.2]

### 3.11 Import aus Tabellen

- Wer Liegenschaften oder Anlagen pflegt, übernimmt sie auch aus einer Tabelle. Die Datei wird gelesen und nicht gespeichert. Von einem Import bleiben eine Zeile mit dem Namen der Datei, der Zahl ihrer Zeilen und dem Ergebnis in Worten, und die Datensätze, die er angelegt hat. Die Zeile nennt keine Person. Wer importiert hat und wann, steht im Änderungsprotokoll (Abschnitt 8) und im Stempel der angelegten Datensätze (Abschnitt 3.6), dort wie immer nur, bis jemand den Datensatz ändert. [K11, K3, B92]
- Wie die Listen eines Betreibers die Anlagenarten nennen, behält die Anwendung für den nächsten Import: ein Wort und die Anlagenart dazu, ohne Person. Wer ein Wort zugeordnet hat, steht im Änderungsprotokoll. [K11]

### 3.12 Mängel

- Ein Mangel hängt an einer Liegenschaft, einem Gebäude, einem Raum oder einer Anlage. Er hält fest, was festgestellt wurde und an welchem Tag, woher er kommt (ein Vorgang, der Nachweis aus dem Bericht einer Fremdfirma oder von Hand), seine Klasse, die Frist zur Beseitigung und seinen Stand, und nach einer Nachprüfung deren Tag und eine Bemerkung. Seine Fotos sind Dokumente an ihm (Abschnitt 3.9). [K4.6, K4.10]
- Ein Prüfpunkt „nicht in Ordnung“ und ein Messwert außerhalb seines Grenzwerts werden mit der Unterschrift ein Mangel, mit dem Text des Punkts und der Bemerkung, ohne Klasse und ohne Person. [K4.5, K4.6]
- Ein Mangel nennt keine Person. Wer ihn gemeldet, eingestuft oder nachgeprüft hat, steht in seinem Stempel (Abschnitt 3.6) und im Änderungsprotokoll; kein anderer Bildschirm zeigt es. Die Bemerkung zur Nachprüfung ist freier Text. [K4.6, K9]
- Melden können alle vier Rollen, im Büro und vor Ort, dort auch ohne Netz. Klasse, Frist und Nachprüfung setzen die Leitung, die Technische Leitung und die Objektleitung; die Haustechnik meldet ohne Klasse und Frist, und ein Gerät schickt mit einer Meldung keine. [K7, B107, B108]
- Die Vorgabe der Frist je Mängelklasse stellt ein, wer die Einstellungen ändert, in Phase 1 die Leitung. Sie nennt keine Person. [K4.6, K7]
- Die Frist eines Mangels steht in der Liste „Fristen“, solange er festgestellt oder beauftragt ist, und erinnert die Leitung, wenn ihr Vorlauf beginnt; ein Mangel nennt niemanden, der für ihn verantwortlich ist. [K2.4, K4.6]
- Ein Mangel folgt seinem Auftrag: beauftragt, sobald aus ihm ein Auftrag angelegt ist, behoben mit der Unterschrift unter dem Auftrag, wieder beauftragt, wenn die Abnahme den Auftrag zurückweist, und wieder festgestellt, wenn der Auftrag nicht durchgeführt wird. Wer das ausgelöst hat, nennt der Mangel nicht. [K4.6, K4.8, B119, B120]

### 3.13 Zähler

- Ein Zählerstand hält fest: den Stichtag, für den er gilt, den Tag der Ablesung, den Stand, auf welchem Weg er kam (von Hand, eigene Runde, Rundgang, Protokoll) und wer ihn eingetragen hat. Die Person setzt der Server selbst ein. Die Seite einer Messstelle im Büro nennt zu jedem Stand den Namen, für alle, die Anlagen ansehen, in ihren Bereichen. Eine Liste der Stände nach Person gibt es nicht. [K4.9, K4.16, B139]
- **Zusage:** Ein Zählerstand wird nicht geändert und nicht gelöscht, auch nicht in der Datenbank. Berichtigt wird er durch einen neuen Stand für denselben Stichtag, der ihn nennt, mit Grund und der Person, die berichtigt; beide bleiben sichtbar, gerechnet wird mit dem neuen. [K4.9, B140, B141]
- Die Notiz an einer Messstelle nennt, wer sie geschrieben hat und seit wann. Eine Sperre nennt ihren Grund und seit wann, eine Stilllegung ihren Zeitraum und Grund, ein Zählertausch die Nummern und Stände; wer gesperrt, stillgelegt oder getauscht hat, steht nur im Änderungsprotokoll. [K4.9, B142]
- **Zusage:** Zähler ablesen dürfen alle vier Rollen. Den Zählertausch, die Stilllegung, die Sperre, die Notiz und was nur die Messstelle trägt, ändert, wer Anlagen pflegt: die Leitung, die Technische Leitung und die Objektleitung. Die Haustechnik kann es nicht. [K4.9, K7, B143, B144]
- Der Verbrauch wird aus den Ständen abgeleitet und nie gespeichert; er nennt keine Person. [K4.9]
- Ein Zählerstand entsteht auch vor Ort, ohne Netz: auf einer eigenen Runde der Zähler einer Liegenschaft oder als Punkt eines Rundgangs. Den Stichtag, den Weg und die Person, die ihn eingetragen hat, setzt der Server; ein Stand aus einem Rundgang entsteht erst mit dessen Unterschrift, im Namen der Person, die unterschrieben hat. [K4.9, B145, B146]
- Ein Stand weit über dem davor wird erst genommen, wenn die ablesende Person ihn bestätigt. Am Stand steht nur, dass er bestätigt wurde, keine weitere Person. [K4.9, B147]

---

## 4. Wer was sieht

Phase 1 kennt vier Rollen. Was jede darf, steht Recht für Recht in Abschnitt 7 des Planungskonzepts. Für die Daten über Beschäftigte heißt das:

| Was | Leitung | Technische Leitung | Objektleitung | Haustechnik |
| --- | --- | --- | --- | --- |
| Zugänge: wer hier arbeitet, Rollen, Sperre, zuletzt angemeldet, Geräte | ja | nein | nein | nein |
| Bereiche je Person und Vertretungen | ja | nein | nein | nein |
| Änderungsprotokoll | ja | nein | nein | nein |
| Das eigene Konto und die eigenen Geräte | ja | ja | ja | ja |
| Wer für eine Pflicht verantwortlich ist, mit Namen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Das Pflichtenverzeichnis auf eine Person eingrenzen; die Namen zur Wahl der verantwortlichen Person | ja | ja | nein | nein |
| Wer eine Prüfung oder Wartung verantwortet und ausführt, mit Namen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was ihr oder niemandem zugeteilt ist |
| Die Namen zur Wahl, wer eine Prüfung oder Wartung verantwortet und ausführt | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | nein |
| Wer einen Auftrag führt und wer an ihm beteiligt ist, mit Namen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was sie führt, woran sie beteiligt ist oder was niemandem zugeteilt ist |
| Die Namen zur Wahl, wer einen Auftrag führt und wer an ihm beteiligt ist | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | nein |
| Notizen zu einem Auftrag, mit Namen und Uhrzeit | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was sie führt, woran sie beteiligt ist oder was niemandem zugeteilt ist |
| Wer einen Zählerstand eingetragen oder berichtigt und wer die Notiz einer Messstelle geschrieben hat, mit Namen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Wer die Rundgänge eines Plans geht, als Kennung des Kontos auf dem Gerät | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Wer einen Rundgang geht, mit Namen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was ihr oder niemandem zugeteilt ist |
| Die Namen zur Wahl, wer einen Rundgang geht | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | nein |
| Wer einen Rundgang unterschrieben und gegengezeichnet hat, mit Namen, Zeichnung oder getipptem Namen und Zeitpunkt | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was ihr oder niemandem zugeteilt ist |
| Datensätze mit ihrem Stempel | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Fassungen von Dokumenten mit der Kennung des Kontos, das sie abgelegt hat | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Ein Nachweis im Ganzen: wer ihn ausgeführt, geprüft, unterschrieben, eingetragen oder für ungültig erklärt hat | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Das PDF eines Nachweises, mit denselben Angaben und dem Schriftzug oder getippten Namen jeder Unterschrift | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen |
| Das PDF eines Rundgangs: wer ihn gegangen ist und wer unterschrieben und gegengezeichnet hat, mit Namen, Schriftzug oder getipptem Namen und Zeitpunkt | in ihren Bereichen | in ihren Bereichen | in ihren Bereichen | was ihr oder niemandem zugeteilt ist |

Leitung und Technische Leitung sehen als Vorgabe alle Bereiche.

- **Zusage:** Jede Adresse des Servers sagt, welches Recht sie verlangt. Ohne Anmeldung antworten nur die Gesundheitsprüfung, die Ersteinrichtung und das Einlösen einer Einladung. [K7, B15, B71]
- **Zusage:** Die Tabelle der Rechte in Abschnitt 7 des Planungskonzepts und der Katalog im Quelltext sind dieselbe Liste: was dort für eine Rolle steht, darf sie, und nichts anderes. [K7, B17]
- **Zusage:** Die Zugänge, also wer bei einem Betreiber arbeitet, mit Rollen, Sperre, Anmeldungen und Geräten, sieht und entscheidet nur die Leitung. Technische Leitung, Objektleitung und Haustechnik werden an diesen Adressen abgelehnt. Die Stellen daneben sind die Auswahl der verantwortlichen Person im Pflichtenverzeichnis, die Auswahl, wer eine Prüfung oder Wartung verantwortet und ausführt, und die Auswahl, wer einen Auftrag führt und an ihm beteiligt ist; alle drei nennen Namen und sonst nichts (Abschnitt 3.4). [K7, B1, B2, B12]
- **Zusage:** Die Liste „Prüfungen“ und die Seite eines Vorgangs zeigen der Haustechnik nur, was ihr oder niemandem zugeteilt ist, wie es auf ihrem Gerät liegt, und einen anderen Vorgang auch nicht über seine Adresse. Wer Vorgänge plant und verteilt, sieht jeden in seinen Bereichen. [K4.4, K7, B101]
- **Zusage:** Die Übersicht der Rundgänge einer Woche zeigt der Haustechnik nur, was ihr oder niemandem zugeteilt ist, wie es auf ihrem Gerät liegt. Sie ordnet nach Gebäude und nicht nach Person. [K4.5, K7, B129]
- **Zusage:** Die Liste „Aufträge“ und die Seite eines Auftrags zeigen der Haustechnik nur, was sie führt, woran sie beteiligt ist oder was niemandem zugeteilt ist, wie es auf ihrem Gerät liegt, und einen anderen Auftrag auch nicht über seine Adresse. [K4.8, K7, B117]
- **Zusage:** Die Leitung arbeitet nur mit einem zweiten Faktor. Das ist eine Angabe der Rolle und keine Einstellung. [K7, B36]
- **Zusage:** Zwei Betreiber auf derselben Instanz sehen nichts voneinander. [K3, B56]
- Die Übersicht der Bereiche nennt je Bereich, für wen er genannt ist. Sie sieht, wer die Einstellungen sieht, in Phase 1 also die Leitung. [K2.8, B4]
- **Zusage:** Wer die Instanz verwaltet, sieht je Betreiber den Namen, wer ihn leitet, und wie viele dort arbeiten, und nichts von dem, was in ihm steht. [K3, B59]
- Wer den Server betreibt, auf dem die Instanz läuft, kann mit Zugriff auf die Datenbank oder eine Sicherung alles lesen, was in diesem Dokument genannt ist. Wer das ist und unter welchen Bedingungen, regelt der Betreiber: im eigenen Haus organisatorisch, bei einem Dienstleister im Vertrag zur Auftragsverarbeitung. [K9]

---

## 5. Auswertungen: welche es gibt und welche nicht

- In dieser Fassung gibt es Listen und keine Auswertungen: die Liegenschaften mit ihren Gebäuden, Geschossen und Räumen, das Anlagenverzeichnis, die Dokumente, das Pflichtenverzeichnis, die Fristen, die Prüfungen, die Mängel, die Aufträge, den Katalog, die Bereiche, die Zugänge mit den Vertretungen und das Änderungsprotokoll, dazu das eigene Konto und der Abgleich des eigenen Geräts. Die Übersicht am Anfang des Büros zählt, was in diesen Listen steht. Was die Navigation darüber hinaus vorsieht, ist nicht gebaut und wird niemandem angeboten. [K4.16, B37]
- **Zusage:** Die Übersicht zählt Pflichten, Prüfungen und Mängel über alle Bereiche der fragenden Person oder über einen davon: überfällig, in 30 und in 90 Tagen fällig, nie erfasst, Bericht einer Fremdfirma fehlt, Mängel über der Frist. Sie nennt keine Person, weder wer für eine Pflicht verantwortlich ist noch wer eine Prüfung ausführt, und zählt nichts je Person. [K4.3, K4.16, B158]
- **Zusage:** Das Lagebild eines Gebäudes und die Liste der Liegenschaften zählen je Ort und nie je Person: was überfällig, fällig und nie erfasst ist, die offenen Mängel und die fehlenden Zählerstände. Die letzten Vorgänge eines Gebäudes nennen den Tag, die Art, den Gegenstand und das Ergebnis, aber keine Person; wer einen Vorgang ausgeführt hat, steht auf seiner Seite. [K4.1, K4.16, B159]
- **Zusage:** Anhang C nennt jede Adresse, die der Server beantwortet. Eine Adresse für eine Statistik, eine Rangliste, eine Liste des Verzugs je Person oder einen Export ist nicht darunter. [K4.16, B40]
- **Zusage:** Eine Adresse, die eine einzelne Person in ihrem Pfad nennt, verlangt ein Recht der Zugänge und ist damit der Leitung vorbehalten. Die einzige Ausnahme ist die Verwaltung der Instanz, die ihre eigenen Verwalter führt. [K9, B16]
- **Zusage:** Das Pflichtenverzeichnis lässt sich auf die Pflichten einer verantwortlichen Person eingrenzen. Das kann nur, wer es führt, also die Leitung und die Technische Leitung. Objektleitung und Haustechnik werden mit dieser Frage abgelehnt, auch wenn sie nach sich selbst fragen; auf die Pflichten, für die niemand benannt ist, grenzt jede Rolle ein. [K4.3, K7, B80]
- **Zusage:** Eingegrenzt auf eine Person nennt das Pflichtenverzeichnis keine Zahl: weder wie viele Pflichten diese Person hat, noch wie viele davon überfällig, fällig oder nie erfasst sind. [K4.16, K9, B81]
- Die Liste selbst zeigt in diesem Fall die Pflichten der Person mit ihrem Zustand, auch die überfälligen und die nie erfassten, und sie lässt sich zusätzlich nach dem Zustand eingrenzen. Das ist keine Zählung und kein Vergleich, aber es ist die Stelle, an der das Pflichtenverzeichnis einer Auswertung je Person am nächsten kommt. [K4.3, K4.16]
- **Zusage:** Die Liste „Fristen“ lässt sich auf die Fristen einer verantwortlichen Person eingrenzen; das kann nur, wer Fristen sieht, also die Leitung und die Technische Leitung. Eingegrenzt auf eine Person nennt sie keine Zahl: weder wie viele Fristen diese Person hat, noch wie viele davon überfällig sind. Sie sagt nur, ob weitere folgen. [K2.4, K4.16, K9, B10, B97]
- Die Liste zeigt in diesem Fall die Fristen der Person mit ihrem Tag, auch die überfälligen. Wie beim Pflichtenverzeichnis ist das keine Zählung, aber die Stelle, an der die Fristen einer Auswertung je Person am nächsten kommen. [K2.4, K4.16]
- Die Liste „Prüfungen“ lässt sich nach Stand, Art und Liegenschaft eingrenzen und durchsuchen, aber nicht auf eine Person. Die Zahl über ihr nennt, wie viele Vorgänge sie in dieser Eingrenzung zeigt. [K4.4, K4.16]
- Die Liste „Aufträge“ lässt sich nach Stand, Art und Bereich eingrenzen und durchsuchen, aber nicht auf eine Person. Die Zahlen über ihr nennen, wie viele Aufträge sie in dieser Eingrenzung zeigt und wie viele davon auf ihre Abnahme warten. [K4.8, K4.16]
- Die Liste „Mängel“ lässt sich nach Stand, Liegenschaft, Bereich und Klasse eingrenzen, aber nicht auf eine Person; ein Mangel nennt keine. Die Zahlen über ihr und neben „Mängel“ in der Navigation zählen offene Mängel und solche über ihrer Frist, in den Bereichen dessen, der fragt. [K4.6, K4.16]
- **Zusage:** Anhang B nennt jedes Feld der Datenbank, das auf eine Person zeigt. Kommt eines dazu, wird der Test rot, bis es hier steht. [K9, B41]
- Das Änderungsprotokoll lässt sich nach Zeitraum, Person, Art des Datensatzes und einzelnem Datensatz filtern. Mit dem Filter nach Person zeigt es, was diese Person wann geändert hat. Das sieht nur die Leitung (Abschnitt 8). [K3, K9, B65]
- Eine Rangliste, eine Statistik je Person oder einen Vergleich zwischen Personen enthält die Anwendung nicht, und das Planungskonzept schließt sie als Vorgabe aus. Die Auswertungen über die Zeit, die Phase 2 bringt, sind ohne Auswertung je Person geplant. [K4.16, K9, K12]

---

## 6. Was sich einschalten lässt und was aus ist

- In dieser Fassung gibt es keinen Schalter, der etwas über Beschäftigte ein- oder ausschaltet. [K4.14, K9]
- Eine Erfassung der Arbeitszeit enthält die Anwendung nicht. Das Planungskonzept sieht sie für Phase 5 als eigenes Modul vor, das ausgeschaltet ausgeliefert wird und beim Einschalten auf die Mitbestimmung hinweist. [K4.14, K12]
- Einen Standort erhebt die Anwendung nicht. Das Planungskonzept lässt ihn nur mit Einwilligung zu und schließt eine Auswertung von Bewegungen aus. [K9]
- Namen und Uhrzeiten der Ausführenden auf einem Leistungsnachweis kommen frühestens mit dem Leistungsnachweis in Phase 2, und nur, wenn der Betreiber es einschaltet; es steht dann in der Verfahrensbeschreibung. [K4.8, K12]
- Einstellen lässt sich der Vorlauf, mit dem eine Frist erinnert. Das dürfen die Leitung und die Technische Leitung. Eine Nachricht verschickt die Anwendung dabei in dieser Fassung nicht. [K2.4, B38]
- Die sicherheitsrelevanten Zusagen sind nicht einstellbar: die Unterschrift vor einem Nachweis, die Abnahme eines Auftrags und die Unveränderlichkeit lassen sich verschärfen und nie abschalten. [K7]

---

## 7. Wie lange aufbewahrt wird

- Diese Fassung löscht nichts nach Ablauf einer Frist und macht nichts unkenntlich. Was in den Abschnitten 3 und 8 genannt ist, bleibt, solange die Instanz besteht. Das Löschkonzept mit Aufbewahrungsfristen kommt in Phase 2 (Abschnitt 10). [K2.6, K3, K9]
- **Zusage:** Ein Datensatz, den jemand entfernt, wird als entfernt markiert und nicht gelöscht. Die Anwendung hat in der Datenbank kein Recht, eine solche Zeile zu löschen. [K2.6, B34]
- **Zusage:** Eine Zugehörigkeit, eine Einladung und die Zeilen der An- und Abmeldungen löscht die Anwendung nicht. [K7, B60]
- Auch ein Konto löscht die Anwendung in dieser Fassung nicht: sein Name stünde sonst nirgends mehr, wo die Person unterschrieben hat. [K2.6, K7]
- **Zusage:** Eine Sitzung endet mit dem Abmelden. Wird eine Zugehörigkeit gesperrt, endet sofort, was die Person bei diesem Betreiber offen hat, und nicht erst, wenn ihre Sitzung abläuft. [K7, K9, B47, B51]
- Ein Nachweis nennt in seinem eingefrorenen Stand, wie lange er nach seiner Pflichtart aufzubewahren ist. In dieser Fassung handelt nichts danach. [K2.6, B29]
- Eine Vertretung, die jemand vorzeitig beendet, wird gelöscht; wer sie eingetragen und wer sie beendet hat, behält das Änderungsprotokoll. [K2.8]
- Eine Sicherung enthält alles, was in der Datenbank steht. Aufbewahrt werden nach der Vorgabe vierzehn Generationen; wo sie liegen und ob sie verschlüsselt sind, stellt ein, wer die Instanz betreibt. [K3, B64]

---

## 8. Das Änderungsprotokoll

- **Zusage:** Jede Änderung an einem Datensatz eines Betreibers steht im Änderungsprotokoll, Feld für Feld mit dem Wert davor und danach: wer sie gemacht hat, wann, von welchem Gerät und auf welchem Weg, also mit welchem Recht. Ausgenommen sind nur die Tabellen auf einer Liste, die der Test nennt: das Protokoll selbst, die Tabellen der Anmeldung, die Quittungen des Abgleichs, der Lauf der Fristen und versiegelte Zugangsdaten. Eine weitere Ausnahme gibt es, den Import aus Tabellen; sie steht im nächsten Punkt. [K3, B31, B32]
- **Zusage:** Was ein Import aus Tabellen anlegt, steht nicht Datensatz für Datensatz im Änderungsprotokoll, sondern als ein Eintrag für den ganzen Import: wer importiert hat, wann, von welchem Gerät, welche Datei mit wie vielen Zeilen und was dabei angelegt wurde. Das gilt für Liegenschaften, Gebäude, Geschosse, Räume und Anlagen, und nur in dem Schritt, der den Eintrag des Imports selbst schreibt: kein anderer Weg legt einen Datensatz am Protokoll vorbei an. Ein Import legt nur an, er ändert und löscht nichts. Jede spätere Änderung an einem so angelegten Datensatz steht wieder Feld für Feld im Protokoll. Bei Anlagen steht neben dem Eintrag des Imports eine Änderung am Nummernkreis: er ist um ihre Zahl weitergerückt. [K11, K3, B88, B89, B90, B91]
- Im Änderungsprotokoll stehen damit auch die An- und Abmeldungen bei dem Betreiber, die Zuteilung von Rollen und Bereichen, die Vertretungen, der Linienzug jeder Unterschrift, die Angaben der Ansprechpartner und jede Berichtigung von Name oder E-Mail-Adresse. Die Werte stehen dort im Klartext. [K9, B45]
- **Zusage:** Das Änderungsprotokoll liest nur die Leitung. Technische Leitung, Objektleitung und Haustechnik werden abgelehnt. [K9, B3, B14]
- **Zusage:** Das Änderungsprotokoll wird nur ergänzt. Einen Eintrag ändert oder löscht niemand, auch nicht der Eigentümer der Tabellen; jeder Eintrag verweist über einen Fingerabdruck auf seinen Vorgänger, und eine Prüfung der Kette findet einen Eintrag, der an der Anwendung vorbei verändert wurde. [K3, B54, B55]
- Dass die Leitung das Änderungsprotokoll gelesen hat, wird nicht festgehalten. [K3, B66]
- **Zusage:** Geheime Werte, etwa der Schlüssel einer Einladung, verlassen den Server im Änderungsprotokoll nicht. [K9, B53]
- Die Instanz hat ein eigenes Protokoll für das, was ihre Verwaltung ändert. Es steht außerhalb jedes Betreibers, und lesen kann es, wer die Instanz verwaltet. [K3]
- Geschwärzt wird im Änderungsprotokoll in dieser Fassung nichts (Abschnitt 10). [K9]

---

## 9. Was Phase 1 noch bringt

Diese Bausteine gehören nach dem Fahrplan zu Phase 1 und sind noch nicht gebaut. Mit jedem wird dieses Dokument berichtigt; der Test in Abschnitt 11 erzwingt es, sobald ein Feld mit Personenbezug oder eine Adresse des Servers dazukommt.

- **Aufgaben:** mit Fälligkeit und verantwortlicher Person. Jede Person legt eigene an; einer anderen teilt sie zu, wer Vorgänge plant und verteilt. [K3]
- **Benachrichtigungen:** per E-Mail und Push, gespeist nur aus Fristen und Statuswechseln. Welche Anlässe als Push kommen, wählt jede Person selbst; ein Auftrag mit der Dringlichkeit „sofort“ erreicht die Person, die ihn führt, immer als Push. [K3, K4.8]
- **Zähler und Fotos vor Ort:** Ablesungen kommen als eigene Datensätze dazu und tragen wie jeder Datensatz ihren Stempel. Ein Foto vor Ort wird als Dokument abgelegt (Abschnitt 3.9); die Bildschirme dafür kommen mit der Bestandsaufnahme. [K4.9, K4.10]
- **Listen als Tabelle:** Jede Liste im Büro lässt sich als Tabelle ausgeben, mit dem, was ihr Filter gerade zeigt. Das ist der erste Export der Anwendung. [K3]
- **Eigene Angaben:** Name, E-Mail-Adresse, Passwort, zweiten Faktor und Geräte ändert jede Person selbst unter „Konto“. [K3]
- **Übernahme aus einer Vorgängeranwendung:** Jedes Konto wird eingeladen, niemand bekommt ein übernommenes Passwort. Ein übernommener Nachweis sagt, dass er nicht in dieser Anwendung unterschrieben wurde. [K11]
- **Vertrag zur Auftragsverarbeitung:** Die Vorlage dafür ist für Phase 1 vorgesehen. [K9, K12]

---

## 10. Was das Planungskonzept zusagt und diese Fassung noch nicht hält

- **Schwärzen im Änderungsprotokoll.** Das Planungskonzept sagt, dass ein personenbezogener Wert im Änderungsprotokoll geschwärzt wird und die Kette ganz bleibt. Gebaut ist das nicht: die Werte stehen im Klartext, und kein Eintrag lässt sich ändern. Es gehört zu den Datenschutzfunktionen von Phase 2. [K9, K12]
- **Löschen mit dem Ende der Aufbewahrung.** Das Planungskonzept sagt, dass ein Nachweis mit dem Ende seiner Aufbewahrung gelöscht wird und der Name mit ihm, nach einem Vorschlag, den die Leitung bestätigt. Gebaut ist das nicht; es kommt in Phase 2. [K2.6, K9, K12]
- **Ende einer Zugehörigkeit.** Das Planungskonzept sagt, dass nach einer einstellbaren Frist die Angaben eines Kontos entfernt werden, die kein Nachweis mehr braucht. Gebaut ist die Sperre; das Entfernen kommt in Phase 2. [K9, K12]
- **Zeitpunkte einzelner Eingaben.** Das Planungskonzept sagt, dass sie nicht angezeigt und nicht ausgewertet werden. Angezeigt werden sie nur im Änderungsprotokoll. Aber der Stempel eines Datensatzes reist mit jeder Antwort mit (Abschnitt 3.6), und kein Test hält, dass kein Bildschirm ihn zeigt. Offen als `opengewerk/opengewerk-haustechnik#157`. [K9]
- **Netzadresse der Anmeldung.** Sie steht in der Zeile der Sitzung, sobald der vorgeschaltete Webserver sie durchreicht (Abschnitt 3.3). Das Planungskonzept nennt sie nicht, die Anwendung braucht sie dort nicht, und kein Test hält, dass sie nirgends ausgegeben wird. Offen als `opengewerk/opengewerk#563`. [K9]
- **Eigene Angaben unter „Konto“.** Das Planungskonzept sagt, dass jede Person Name und E-Mail-Adresse selbst ändert. Gebaut ist bisher nur die Berichtigung durch die Leitung. Offen als `opengewerk/opengewerk-haustechnik#128`. [K3]
- **Erzeugte Unterlagen.** Das Verzeichnis der Verarbeitungstätigkeiten, die Beschreibung der technischen und organisatorischen Maßnahmen und die erzeugte Verfahrensbeschreibung kommen in Phase 2, ebenso die Vorlage für eine Betriebs- oder Dienstvereinbarung. [K9, K12]

---

## 11. Pflege dieses Dokuments

Das Dokument wird wie Quelltext über einen Pull Request geändert. Der Test `packages/server/src/processing-description.test.ts` läuft bei jeder Änderung und hält fest:

- Jeder Beleg in Anhang A stimmt: der Test steht unter diesem Namen in dieser Datei, die Stelle steht so im Quelltext, das Recht heißt so und liegt bei genau diesen Rollen.
- Jeder Beleg wird im Text verwendet, und jeder Verweis im Text führt auf einen Beleg oder auf einen Abschnitt des Planungskonzepts, den es gibt.
- Jede Aussage der Abschnitte 3 bis 10 nennt ihre Stelle im Planungskonzept, und jede Zusage einen Test.
- Anhang B nennt jedes Feld der Datenbank, das auf eine Person zeigt, und kein anderes.
- Anhang C nennt jede Adresse, die der Server beantwortet, und keine andere.
- Die Zeile „Gilt für“ nennt die neueste veröffentlichte Fassung aus `CHANGELOG.md`, und bis es eine gibt, sagt sie das.

Wer einen Baustein baut, der etwas an den Aussagen ändert, berichtigt das Dokument im selben Pull Request. Für eine Arbeitnehmervertretung wird es als PDF ausgegeben; maßgeblich ist die Fassung im Repository.

---

## Anhang A: Belege

Pfade ohne Vorsatz liegen im Repository `opengewerk/opengewerk-haustechnik`. Pfade unter `upstream/opengewerk/` liegen im Repository `opengewerk/opengewerk`: das ist das Fundament, auf dem die Anwendung steht. Ein Test ist mit seinem Titel genannt, wie er in der Datei steht; die Titel sind wie der Quelltext englisch.

| Nr. | Art | Wo | Was |
| --- | --- | --- | --- |
| B1 | Recht | `membership.read` | Zugänge ansehen: Leitung |
| B2 | Recht | `membership.write` | Zugänge verwalten: Leitung |
| B3 | Recht | `audit.read` | Das Änderungsprotokoll einsehen: Leitung |
| B4 | Recht | `settings.read` | Einstellungen ansehen: Leitung |
| B5 | Recht | `location.read` | Liegenschaften, Gebäude und Räume ansehen: Leitung, Technische Leitung, Objektleitung, Haustechnik |
| B6 | Recht | `location.write` | Liegenschaften, Gebäude und Geschosse pflegen: Leitung, Technische Leitung |
| B7 | Recht | `activity.write` | Vorgänge planen und verteilen: Leitung, Technische Leitung, Objektleitung |
| B8 | Recht | `activity.accept` | Aufträge abnehmen und Rundgänge gegenzeichnen: Leitung, Technische Leitung, Objektleitung |
| B9 | Recht | `evidence.write` | Nachweise eintragen, berichtigen und für ungültig erklären: Leitung, Technische Leitung, Objektleitung |
| B10 | Recht | `deadline.read` | Fristen ansehen: Leitung, Technische Leitung |
| B11 | Recht | `duty.write` | Das Pflichtenverzeichnis führen: Leitung, Technische Leitung |
| B12 | Test | `packages/server/src/authentication/roles.test.ts` | `is not for "%s" to see or to decide` |
| B13 | Test | `packages/server/src/authentication/roles.test.ts` | `are put right by "Leitung", and the correction stands in the log of the tenant` |
| B14 | Test | `packages/server/src/api/audit.test.ts` | `is closed to every other role, with the words of this application` |
| B15 | Test | `packages/server/src/api/route-coverage.test.ts` | `declares the right it needs, writing ones above all` |
| B16 | Test | `packages/server/src/api/route-coverage.test.ts` | `that names one person in its path asks for a membership right, the area of the instance aside` |
| B17 | Test | `packages/server/src/authentication/rights-in-the-concept.test.ts` | `gives "%s" the rights the role holds in the code, and no other` |
| B18 | Test | `packages/server/src/api/areas.test.ts` | `is not %s: every route is refused with the right it takes` |
| B19 | Test | `packages/server/src/api/areas.test.ts` | `change what the person sees at once, and their device lets go of the rest with its next exchange` |
| B20 | Test | `packages/server/src/database/areas.test.ts` | `shows the substitute the areas of the absent person on its days and on no other` |
| B21 | Test | `packages/server/src/sync/sync.test.ts` | `hands a device what its person sees, by area, and nothing of the area next door` |
| B22 | Test | `packages/server/src/sync/sync.test.ts` | `takes a round given without a connection from its first answer to the signature, and writes it down in the name of whoever signed` |
| B23 | Test | `packages/server/src/sync/sync.test.ts` | `holds the activities of the person while open, given to them or to nobody, and closed ones for thirty days` |
| B24 | Test | `packages/server/src/activities/signing.test.ts` | `writes the activity down, one evidence per duty, with the signature in its state` |
| B25 | Test | `packages/server/src/activities/signing.test.ts` | `is turned back with a reason, which leaves the signature standing and no longer valid` |
| B26 | Test | `packages/server/src/database/evidence.test.ts` | `is changed and removed by nobody, not by a superuser` |
| B27 | Test | `packages/server/src/database/signatures.test.ts` | `is changed and removed by nobody, not by a superuser` |
| B28 | Test | `packages/server/src/evidence/correction.test.ts` | `stands once for an evidence, with the reason, and the evidence stays as it was` |
| B29 | Test | `packages/server/src/evidence/write.test.ts` | `names the examiner of a report, and the retention of its kind` |
| B30 | Test | `packages/server/src/evidence/write.test.ts` | `keeps what was true on the day, whatever changes afterwards` |
| B31 | Test | `packages/server/src/database/audit.test.ts` | `lands in the log of the tenant field by field, with who and why, and the chain holds` |
| B32 | Test | `packages/server/src/database/audit.test.ts` | `are watched by the log of their tenant, all but the ones on the list` |
| B33 | Test | `packages/server/src/database/audit.test.ts` | `carry the stamp wherever their rows travel to a device` |
| B34 | Test | `packages/server/src/database/tenant-isolation.test.ts` | `keep a row that is removed by marking out of reach of DELETE` |
| B35 | Test | `packages/server/src/api/contacts.test.ts` | `let whoever keeps the properties keep their contacts, and everybody else read them` |
| B36 | Test | `packages/domain/src/model/rights.test.ts` | `have exactly one that leads, and it is the one that needs a second factor` |
| B37 | Test | `packages/web/src/office/navigation.test.tsx` | `offers nobody a place whose screen is not built, such as the tasks` |
| B38 | Test | `packages/server/src/deadlines/routes.test.ts` | `give the lead of the kind and take a lead of the operator own, and no interval` |
| B39 | Test | `packages/server/src/api/nothing-taken-back.test.ts` | `keeps its answers, signatures, decisions and evidence through every route there is` |
| B40 | Test | `packages/server/src/processing-description.test.ts` | `names every address the server answers, and no other` |
| B41 | Test | `packages/server/src/processing-description.test.ts` | `names every column that points at a person, and no other` |
| B42 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `are listed for their own account only, with the current one marked` |
| B43 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `cannot be cut off by somebody else` |
| B44 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `gives a registered device thirty days, and every other session twelve hours` |
| B45 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `holds both ends of a stretch of work in the tenant it happened in` |
| B46 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `stop somebody working through passwords` |
| B47 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/authentication.test.ts` | `ends the session, and the cookie stops working` |
| B48 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/administration.test.ts` | `names everybody here, with what they may do and when they were last seen` |
| B49 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/administration.test.ts` | `can be seen and cut off by whoever leads the tenant, for this tenant only` |
| B50 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/administration.test.ts` | `leaves them in the list and in the history, because deleting would not` |
| B51 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/administration.test.ts` | `ends what they have open now, not when their session runs out` |
| B52 | Test | `upstream/opengewerk/packages/platform/server/src/authentication/passkeys.test.ts` | `are listed for their own account, and nobody else sees them` |
| B53 | Test | `upstream/opengewerk/packages/platform/server/src/audit/controller.test.ts` | `never leaves the server, on the page of all changes or on the one of its table` |
| B54 | Test | `upstream/opengewerk/packages/platform/server/src/database/foundation.test.ts` | `lets nobody change the log, the application not at all and the owner not either` |
| B55 | Test | `upstream/opengewerk/packages/platform/server/src/database/foundation.test.ts` | `notices an entry that was changed past the trigger` |
| B56 | Test | `upstream/opengewerk/packages/platform/server/src/database/foundation.test.ts` | `keeps a second tenant out of the first, and names both to a job that acts for nobody` |
| B57 | Test | `upstream/opengewerk/packages/platform/server/src/sync/controller.test.ts` | `lists what a device has to decide and closes it once, for that device alone` |
| B58 | Test | `upstream/opengewerk/packages/platform/web/src/gate/sign-out.test.tsx` | `takes the store of every tenant on this device with it, then ends the session` |
| B59 | Test | `upstream/opengewerk/packages/platform/server/src/instance/instance.test.ts` | `is listed for whoever runs the instance with who leads it and how many work in it, and nothing of what is in it` |
| B60 | Test | `upstream/opengewerk/packages/platform/server/src/migration/guards.test.ts` | `let nothing that names a tenant be deleted by the application, its mail server aside` |
| B61 | Test | `upstream/opengewerk/packages/platform/domain/src/model/signature.test.ts` | `carries nothing else, because it goes straight into an SVG` |
| B62 | Stelle | `upstream/opengewerk/packages/platform/server/src/database/schema/authentication.ts` | `ip_address` |
| B63 | Stelle | `upstream/opengewerk/packages/platform/domain/src/model/invitation.ts` | `invitationDays = 7` |
| B64 | Stelle | `docker/.env.example` | `BACKUP_KEEP=14` |
| B65 | Stelle | `upstream/opengewerk/packages/platform/server/src/audit/controller.ts` | `one(query, 'person')` |
| B66 | Stelle | `upstream/opengewerk/packages/platform/server/src/audit/controller.ts` | `Reading the log is not written to the log.` |
| B67 | Stelle | `packages/web/src/office/screens/staff.tsx` | `byMail={false}` |
| B68 | Stelle | `upstream/opengewerk/packages/platform/web/src/session/remembered.ts` | `opengewerk.account` |
| B69 | Stelle | `packages/domain/src/model/signature.ts` | `deviceInfo: 500` |
| B70 | Test | `packages/server/src/authentication/roles.test.ts` | `are not for "%s" to put right` |
| B71 | Test | `packages/server/src/api/route-coverage.test.ts` | `that answers without an identity is the health check, the first run or a one time link` |
| B72 | Recht | `document.record` | Dokumente ablegen: Leitung, Technische Leitung, Objektleitung, Haustechnik |
| B73 | Test | `packages/server/src/api/files.test.ts` | `stands in the change log of the tenant with who sent it` |
| B74 | Test | `packages/server/src/api/files.test.ts` | `is handed out by no route under its hash, not even to "Leitung"` |
| B75 | Recht | `duty.read` | Pflichten ansehen: Leitung, Technische Leitung, Objektleitung, Haustechnik |
| B76 | Test | `packages/server/src/api/duty-register.test.ts` | `are everybody who works for the operator, by name and whether they can still be named, and nothing else of them` |
| B77 | Test | `packages/server/src/api/duty-register.test.ts` | `let whoever reads duties read the register, a duty and the duties of a room; evidence and colleagues ask for their own` |
| B78 | Recht | `evidence.read` | Nachweise ansehen: Leitung, Technische Leitung, Objektleitung, Haustechnik |
| B79 | Test | `packages/server/src/api/duty-register.test.ts` | `lists its evidence, the newest first, each with what it means for the appointment, and names nobody` |
| B80 | Test | `packages/server/src/api/duty-register.test.ts` | `is for whoever keeps the register, and the others are refused` |
| B81 | Test | `packages/server/src/api/duty-register.test.ts` | `answers without a single number, and says all the same whether more follow` |
| B82 | Test | `packages/server/src/database/documents.test.ts` | `says who stored it, from the request and from nothing a row names` |
| B83 | Test | `packages/web/src/office/screens/documents.test.tsx` | `name nobody and no time of day: neither who filed a version nor when in the day` |
| B84 | Test | `packages/server/src/api/documents.test.ts` | `is seen by whoever sees the asset its document hangs on, and by nobody else` |
| B85 | Recht | `document.read` | Dokumente ansehen: Leitung, Technische Leitung, Objektleitung, Haustechnik |
| B86 | Recht | `document.remove` | Dokumente entfernen: Leitung, Technische Leitung, Objektleitung |
| B87 | Test | `packages/server/src/api/documents.test.ts` | `is no longer handed out once its document is taken out of the records, and its row stays` |
| B88 | Test | `packages/server/src/api/imports.test.ts` | `acceptance 2, "Ein Import steht als ein Eintrag im Änderungsprotokoll und nicht als tausend": the places of an import are one change, the row of the import` |
| B89 | Test | `packages/server/src/api/imports.test.ts` | `acceptance 2 for assets: the assets of an import write no entry, its row is the one change that names it, and the counter of their numbers moves once` |
| B90 | Test | `packages/server/src/database/imports.test.ts` | `is no for a later transaction that names the row of an import that is done, and its records are logged` |
| B91 | Test | `packages/server/src/database/imports.test.ts` | `carry the condition on the five tables an import writes, and on no other` |
| B92 | Test | `packages/server/src/api/imports.test.ts` | `answers with the table in it, and keeps neither the file nor a word about it` |
| B93 | Test | `packages/server/src/api/evidence.test.ts` | `reads the frozen state with the fingerprint over it, for every role that sees evidence` |
| B94 | Test | `packages/server/src/api/evidence.test.ts` | `is a new evidence of the duty that names the old one, which stays as it was` |
| B95 | Test | `packages/server/src/api/evidence.test.ts` | `lists the evidence of every duty at the asset with its duty, the newest first` |
| B96 | Test | `packages/server/src/api/evidence.test.ts` | `answers %s with %i: correcting and declaring invalid is for whoever enters evidence` |
| B97 | Test | `packages/server/src/deadlines/routes.test.ts` | `narrowed to a person, names no number and says all the same whether more follow` |
| B98 | Test | `packages/server/src/deadlines/engine.test.ts` | `comes of the due day once its lead begins, once however often the engine runs, and leaves the due day as it is` |
| B99 | Test | `packages/server/src/api/activities.test.ts` | `offers who plans and who performs among the people who see its area and have not left` |
| B100 | Test | `packages/server/src/api/activities.test.ts` | `is not for whoever only performs, and names nobody who could not be named` |
| B101 | Test | `packages/server/src/api/activities.test.ts` | `shows whoever plans every activity in their areas, and whoever only performs what is given to them or to nobody` |
| B102 | Test | `packages/server/src/api/activities.test.ts` | `brings the inspection onto the device of whoever performs it with the next sync` |
| B103 | Test | `packages/server/src/api/report.test.ts` | `is not for whoever only performs, and not for a duty outside the areas of the person` |
| B104 | Test | `packages/server/src/api/report.test.ts` | `becomes an evidence with the examiner, the organisation, the day, the result and the file as it arrived` |
| B105 | Test | `packages/server/src/api/report.test.ts` | `stays with the evidence once its document is taken out of the filing, and is nothing by another place` |
| B106 | Test | `packages/server/src/api/report.test.ts` | `is handed out to nobody who does not see the evidence` |
| B107 | Test | `packages/server/src/api/defects.test.ts` | `comes with a class and a day only from whoever keeps defects` |
| B108 | Test | `packages/server/src/sync/policies.test.ts` | `ask for the right of the office once an operation leaves what a device may write` |
| B109 | Test | `packages/server/src/api/activities.test.ts` | `makes one for a duty with none under way, as the engine would, due on its appointment` |
| B110 | Test | `packages/server/src/api/activities.test.ts` | `is for whoever plans, not for whoever only performs, even an activity given to them` |
| B111 | Test | `packages/server/src/api/work-orders.test.ts` | `from a defect takes its place, draws a number, and orders the defect` |
| B112 | Test | `packages/server/src/api/work-orders.test.ts` | `is made by whoever plans and hands out work, and not by whoever only performs` |
| B113 | Test | `packages/server/src/api/work-orders.test.ts` | `is led and worked on by people who perform and see its area, and nobody twice` |
| B114 | Test | `packages/server/src/api/work-orders.test.ts` | `offers the people who perform and see the area of the property` |
| B115 | Test | `packages/server/src/api/work-orders.test.ts` | `a further person taken off the order no longer sees it` |
| B116 | Test | `packages/server/src/api/work-orders.test.ts` | `is for whoever accepts work orders, of a signed order, and a rejection names its reason` |
| B117 | Test | `packages/server/src/api/work-orders.test.ts` | `whoever only performs sees what they lead, work on, or what is given to nobody, in the office and on the device` |
| B118 | Test | `packages/server/src/api/work-orders.test.ts` | `changes what it is, how urgent, the day and the people until it is signed` |
| B119 | Test | `packages/server/src/api/work-orders.test.ts` | `is set right with the signature, ordered again when the order is turned back, and set right with the next` |
| B120 | Test | `packages/server/src/api/work-orders.test.ts` | `is for whoever plans, before its signature, and finds its defect again` |
| B121 | Test | `packages/server/src/api/round-plans.test.ts` | `is made by whoever plans, with a round for every pass as far ahead as rounds are made, and not by whoever only performs` |
| B122 | Test | `packages/server/src/api/round-plans.test.ts` | `refuses what is wrong with it, a place it does not have and a person who does not walk rounds in its area` |
| B123 | Test | `packages/server/src/api/round-plans.test.ts` | `takes back the rounds of days it no longer falls on, keeps a begun one and the person of a day it keeps` |
| B124 | Test | `packages/server/src/api/round-plans.test.ts` | `make each pass of a plan once, however often and however many run at once` |
| B125 | Test | `packages/server/src/api/round-plans.test.ts` | `are handed out by whoever plans, to somebody who performs in their area, while nobody has begun them` |
| B126 | Test | `packages/server/src/api/round-plans.test.ts` | `are handed out like the week before, each to whoever had the round of its plan seven days earlier` |
| B127 | Test | `packages/server/src/api/round-plans.test.ts` | `name the people of the plans, and who may walk the rounds of an area to whoever plans there` |
| B128 | Test | `packages/server/src/api/round-plans.test.ts` | `put a round given to nobody on the device of everybody in the area, and one given to somebody on theirs` |
| B129 | Test | `packages/server/src/api/round-plans.test.ts` | `show whoever only performs what is given to them or to nobody` |
| B130 | Test | `packages/server/src/api/round-plans.test.ts` | `hands its rounds on to its new person, except those handed to somebody else` |
| B131 | Test | `packages/server/src/api/round-plans.test.ts` | `shows no answers before the signature, and the page that was signed after it, waiting for the countersignature` |
| B132 | Test | `packages/server/src/api/round-plans.test.ts` | `is countersigned by the Objektleitung for the page that was shown, and only then written down` |
| B133 | Test | `packages/server/src/api/round-plans.test.ts` | `closes a round of a past day as not performed, with the reason, by whoever plans, and it fulfils nothing` |
| B134 | Test | `packages/server/src/api/work-orders.test.ts` | `takes the time spent from whoever works on it, and nothing else of the order` |
| B135 | Test | `packages/server/src/api/work-orders.test.ts` | `takes a note from whoever works on it, in the name of whoever is signed in, and never changes or removes one` |
| B136 | Test | `packages/server/src/activities/signing.test.ts` | `is signed by the person who leads it and by nobody else, nor by anybody while nobody leads it` |
| B137 | Test | `packages/web/src/site/screens/work-order.test.tsx` | `takes a note as an entry of its own, without a network, which nothing changes afterwards` |
| B138 | Test | `packages/server/src/api/work-orders.test.ts` | `is finished by the person who leads it, and the signature of anybody else is a conflict` |
| B139 | Test | `packages/server/src/api/meters.test.ts` | `is entered by every role, for the key date of its day, in the name of whoever enters it, once a key date` |
| B140 | Test | `packages/server/src/api/meters.test.ts` | `is corrected by a new one with the reason, which counts in its place, while the one corrected stays` |
| B141 | Test | `packages/server/src/api/meters.test.ts` | `is changed and removed by nobody, also not in the database` |
| B142 | Test | `packages/server/src/api/meters.test.ts` | `a note names who wrote it and since when, and none removes it` |
| B143 | Test | `packages/server/src/api/meters.test.ts` | `is for whoever takes care of assets, takes the new number, and refuses an end below the last reading and the old number` |
| B144 | Test | `packages/server/src/api/meters.test.ts` | `a lock is set and lifted by whoever takes care of assets, with its reason and since when` |
| B145 | Test | `packages/server/src/api/meters.test.ts` | `is taken without a network for the key date of its day, in the name of whoever read it` |
| B146 | Test | `packages/server/src/activities/signing.test.ts` | `writes the reading of a point about a measuring point with the signature, and not before` |
| B147 | Test | `packages/server/src/api/meters.test.ts` | `is taken only once whoever reads it confirms it, and keeps that it was` |
| B148 | Test | `packages/server/src/activities/signing.test.ts` | `freezes a round as a whole with the signature, also one that meets no duty (#111)` |
| B149 | Test | `packages/server/src/api/evidence.test.ts` | `is made from the frozen state the first time, and the same bytes every time after, whatever changed` |
| B150 | Test | `packages/server/src/api/evidence.test.ts` | `is for the house technicians only of a round given to them or to nobody, as its page` |
| B151 | Test | `packages/server/src/api/evidence.test.ts` | `keeps a frozen state and its PDF as they were, also in the database` |
| B152 | Test | `packages/server/src/activities/signing.test.ts` | `is refused confirmed with a name other than the one of the account, or with a drawing and a name` |
| B153 | Test | `packages/server/src/sync/sync.test.ts` | `takes a round signed without a connection with the typed name of whoever sends it, and not with another name (#209)` |
| B154 | Test | `packages/server/src/activities/signing.test.ts` | `is taken confirmed with the typed name of the account, and the state says which way (#209)` |
| B155 | Test | `packages/server/src/prints/record-page.test.ts` | `shows a drawn signature as its drawing and a typed one as the name with the way (#209)` |
| B156 | Test | `packages/server/src/activities/signing.test.ts` | `is refused with a moment of the device ahead of the server, or before the day of the performance (#79)` |
| B157 | Test | `packages/server/src/activities/signing.test.ts` | `keeps the moment of the device and the one of the server in the state (#79)` |
| B158 | Test | `packages/server/src/api/overview.test.ts` | `names nobody: neither who answers for a duty nor who performs an inspection` |
| B159 | Test | `packages/server/src/api/place-situation.test.ts` | `lists the last activities at the building, the newest first, with what came of them, and names nobody` |

---

## Anhang B: Felder, die auf eine Person zeigen

Jede Zeile ist ein Feld der Datenbank, das die Kennung eines Kontos hält. Der Stern steht für jede Tabelle, deren Zeilen auf Geräte reisen.

| Tabelle | Feld | Bedeutung |
| --- | --- | --- |
| `account_corrections` | `user_id` | das Konto, dessen Name oder E-Mail-Adresse die Leitung berichtigt hat |
| `activities` | `performer_user_id` | wer einen Vorgang ausführt |
| `activities` | `responsible_user_id` | wer für einen Vorgang verantwortlich ist |
| `activity_signatures` | `signed_by` | wer unterschrieben oder gegengezeichnet hat |
| `attachment_versions` | `created_by` | wer eine Fassung eines Dokuments abgelegt hat |
| `audit_entries` | `user_id` | wer eine Änderung gemacht hat |
| `auth_accounts` | `user_id` | das Konto, zu dem ein Passwort gehört |
| `auth_passkeys` | `user_id` | das Konto, zu dem ein Passkey gehört |
| `auth_sessions` | `user_id` | das Konto einer Sitzung |
| `auth_two_factors` | `user_id` | das Konto, zu dem ein zweiter Faktor gehört |
| `deadline_settings` | `responsible_user_id` | wen eine Art von Frist erinnert, wenn der Betreiber es festlegt |
| `deadlines` | `closed_by` | wer eine Frist geschlossen hat |
| `deadlines` | `natural_user_id` | wen die Quelle einer Frist als verantwortlich nennt |
| `deadlines` | `responsible_user_id` | wer für eine Frist verantwortlich ist |
| `duties` | `confirmed_by` | wer eine Pflicht bestätigt hat |
| `duties` | `responsible_user_id` | wer für eine Pflicht verantwortlich ist |
| `duty_dismissals` | `dismissed_by` | wer einen Vorschlag für eine Pflicht verworfen hat |
| `evidence` | `performed_by` | wer die Arbeit ausgeführt hat, die ein Nachweis belegt |
| `evidence` | `written_by` | wer einen Nachweis eingetragen hat |
| `evidence_voidings` | `voided_by` | wer einen Nachweis für ungültig erklärt hat |
| `instance_changes` | `user_id` | wer etwas an der Instanz geändert hat |
| `instance_operators` | `user_id` | wer die Instanz verwaltet |
| `invitations` | `invited_by` | wer eingeladen hat |
| `member_all_areas` | `user_id` | wessen Zugehörigkeit für alle Bereiche gilt |
| `member_areas` | `user_id` | für wen ein Bereich genannt ist |
| `member_passkeys` | `user_id` | wessen Passkey bei diesem Betreiber gilt |
| `memberships` | `user_id` | wer bei diesem Betreiber arbeitet |
| `meter_points` | `note_by` | wer die Notiz an einer Messstelle geschrieben hat |
| `meter_readings` | `recorded_by` | wer einen Zählerstand eingetragen oder berichtigt hat |
| `round_plans` | `performer_user_id` | wer die Rundgänge eines Plans geht, wenn der Plan jemanden nennt |
| `substitutions` | `absent_user_id` | wer vertreten wird |
| `substitutions` | `substitute_user_id` | wer vertritt |
| `tenant_sessions` | `user_id` | wer sich bei diesem Betreiber an- und abgemeldet hat |
| `work_order_decisions` | `decided_by` | wer einen Auftrag abgenommen oder zurückgewiesen hat |
| `work_order_notes` | `written_by` | wer eine Notiz zu einem Auftrag geschrieben hat |
| `work_order_participants` | `user_id` | wer an einem Auftrag beteiligt ist |
| `*` | `updated_by` | wer einen Datensatz zuletzt geändert hat |

---

## Anhang C: Adressen des Servers

Jede Zeile ist der erste Abschnitt einer Adresse, unter der der Server antwortet. Dazu kommen unter `api/auth` die Wege der Anmeldung selbst: anmelden, Passwort ändern und zurücksetzen, zweiter Faktor und Passkeys.

| Adresse | Wofür |
| --- | --- |
| `activities` | Prüfungen und Wartungen: die Liste, die Seite eines Vorgangs, die Auswahl der Personen für seinen Plan und der Plan |
| `areas` | Bereiche und für wen sie genannt sind |
| `assets` | Anlagen und ihre Komponenten, und die Nachweise einer Anlage |
| `attachments` | Dokumente: gibt die Datei einer Fassung und ihre Vorschau aus, über die Fassung und nie über die Prüfsumme |
| `audit` | Änderungsprotokoll |
| `auth` | das eigene Konto: Betreiber wählen, eigene Geräte, eigene Passkeys, abmelden |
| `buildings` | Gebäude mit ihren Schließzeiten |
| `catalogue` | Katalog der Pakete, für jeden Betreiber derselbe und ohne Daten eines Betreibers |
| `contacts` | Ansprechpartner einer Liegenschaft |
| `deadlines` | Fristen |
| `defects` | Mängel: das Mängelverzeichnis und seine Zahlen, die Seite eines Mangels, ein Mangel von Hand, seine Klasse und Frist, die Nachprüfung und die Klassen, die ein Mangel von Hand nehmen kann |
| `duties` | Pflichten, das Pflichtenverzeichnis, die Nachweise einer Pflicht, die Auswahl der verantwortlichen Person und der Bericht einer Fremdfirma, der zum Nachweis einer Pflicht wird |
| `duty-dismissals` | verworfene Vorschläge für Pflichten |
| `evidence` | die Seite eines Nachweises, die Dateien, auf die er sich stützt, seine Berichtigung und seine Ungültigerklärung |
| `files` | Dateien: nimmt den Inhalt einer Datei an, bevor ein Datensatz sie nennt, und gibt keine aus |
| `floors` | Geschosse |
| `health` | Gesundheitsprüfung, ohne Daten |
| `imports` | Import aus Tabellen: liest die Datei einer Liste, ohne sie zu speichern, zeigt, was ihre Zeilen anlegen würden, übernimmt Liegenschaften, Gebäude, Geschosse, Räume und Anlagen ganz oder gar nicht, und hält, wie die Listen des Betreibers die Anlagenarten nennen |
| `instance` | Verwaltung der Instanz |
| `invitation` | Einlösen einer Einladung |
| `labels` | Etiketten: sagt zu einem gescannten Code in einem Wort, ob er für die fragende Person etwas öffnet, und druckt viele Etiketten auf einmal |
| `overview` | Übersicht der Betreiberverantwortung: wie viele Pflichten überfällig, in 30 und in 90 Tagen fällig und nie erfasst sind, wie vielen Prüfungen der Bericht einer Fremdfirma fehlt und wie viele Mängel über ihrer Frist sind, mit den ersten davon; über alle Bereiche der fragenden Person oder einen. Dazu die Zahlen je Liegenschaft und Gebäude und das Lagebild eines Gebäudes mit seinen letzten Vorgängen. Keine dieser Antworten nennt eine Person |
| `meters` | Zähler: die Liste zum Stichtag, die Seite einer Messstelle mit Ständen, Verbrauch und Verlauf, ein Stand von Hand und seine Berichtigung, der Zählertausch, die Stilllegung, die Sperre, die Notiz und was nur die Messstelle trägt |
| `properties` | Liegenschaften |
| `rooms` | Räume, mit den Pflichten, die an ihnen hängen |
| `round-plans` | Pläne der Rundgänge: ein neuer Plan und die Änderung eines Plans, auch ruhen lassen und beenden; ein Plan nennt die Person, die seine Rundgänge geht, oder niemanden |
| `round-templates` | Vorlagen der Rundgänge: eine neue, leer oder aus einem Paket übernommen, und eine neue Fassung einer Vorlage; sie nennen Anlagen, Räume und Pflichten und keine Person |
| `rounds` | Rundgänge der Pläne: die Übersicht einer Woche mit den offenen Rundgängen früherer Wochen, wer einen Rundgang geht, auch „wie letzte Woche“, die Namen der Personen, die Pläne und Rundgänge nennen, und die Auswahl, wer in einem Bereich Rundgänge geht; die Seite eines Rundgangs mit seinen Unterschriften, die Gegenzeichnung und das Schließen mit Grund |
| `settings` | Vorlauf der Fristen und die Vorgabe der Frist je Mängelklasse |
| `setup` | Ersteinrichtung |
| `staff` | Zugänge |
| `substitutions` | Vertretungen |
| `sync` | Abgleich und Konflikte |
| `work-orders` | Aufträge: die Liste, die Seite eines Auftrags, die Auswahl der Personen, ein neuer Auftrag aus einem Mangel, aus einem Termin oder von Hand, seine Änderung, das Schließen mit Grund und seine Abnahme oder Zurückweisung |
