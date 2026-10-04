# OpenGewerk Haustechnik: Planungskonzept (Software für Betreiber und ihre Haustechnik) · v0.8

2026-10-04 · Eigenständiges Projekt, Repository `opengewerk-haustechnik` in der GitHub-Organisation `opengewerk` · v0.2 trägt die Entscheidungen vom 01.10.2026 ein, v0.3 die Technik, mit der das Fundament eingebunden wird, v0.4 gleicht Abschnitt 5 und die Wortwahl an die ADRs 0002 bis 0006 an, siehe Abschnitt 15; v0.5 sagt in Abschnitt 7, was jede Rolle im Einzelnen darf, v0.6 nennt dort die Rechte für den Abgleich, v0.7 gibt den eigenen Anlagenarten und den Mängelklassen ihre Phase, v0.8 trägt die Entscheidungen vom 04.10.2026 vor dem Bau von Phase 1 ein (Vergleich mit openMAINT, Atlas CMMS, eTASK, wave Facilities, pitFM, SPARTACUS, Planon, Lumiform, Wowflow und den Excel-Listen, die vielerorts die eigentliche Software sind)

Self-hosted Open-Source-System für alle, die Gebäude betreiben und dafür eigene Haustechniker haben. Liegenschaften, Gebäude, Räume und technische Anlagen stehen in einem Datenmodell. Die Betreiberpflichten hängen daran als überwachte Fristen, Rundgänge und Prüfungen laufen auf dem Telefon auch ohne Netz, und zu jeder Pflicht gibt es einen Nachweis, der sich nachträglich nicht ändern lässt.

**Legende**
- ★ = geht über das hinaus, was Vergleichssysteme bieten (eigene Idee)
- ⚖ = durch Gesetz, Verordnung oder Regelwerk gefordert (Deutschland); die Fundstelle steht in Abschnitt 8
- ⏳ = im Plan, aber bewusst später umsetzen
- In welcher Phase ein Punkt gebaut wird, steht in Abschnitt 12

---

## 0. Leitentscheidungen

1. **Die Betreiberpflicht ist der Kern, nicht die Checkliste.** Eine Checkliste sagt, was jemand getan hat. Eine Pflicht sagt, was getan werden muss, woher das kommt, wer dafür einsteht, bis wann, und womit es bewiesen wird. Gebaut wird um die Pflicht: Anlage → Pflicht → Termin → Vorgang → Nachweis. Ein Rundgang, die Prüfung durch eine Fremdfirma und ein Wartungsauftrag sind drei Wege, eine Pflicht zu erfüllen, und keine drei Module mit je eigener Wahrheit ★ ⚖
2. **Ein Datenmodell vom Ort bis zum Nachweis.** Liegenschaft → Gebäude → Geschoss → Raum für den Ort, Anlage → Komponente für die Technik. Jede Frage hat genau eine Stelle, an der sie beantwortet wird. Wann eine Anlage das nächste Mal dran ist, folgt aus ihren Pflichten und Nachweisen und steht in keinem Feld daneben, das jemand pflegen müsste.
3. **Pflichten sind Daten, kein Code und kein Freitext.** Welche Prüfung für welche Anlagenart gilt, in welchem Abstand, durch wen und nach welcher Vorschrift, steht in versionierten Pflichtenpaketen mit Gültigkeitszeitraum, Fundstelle und Geltungsbereich, gepflegt wie die Regelpakete von OpenGewerk. Eine neue Vorschrift ist ein neuer Datensatz mit Gültigkeitsbeginn, kein Release. Der Betreiber überschreibt keine Vorschrift. Er setzt, was die Vorschrift ihm überlässt: die Frist innerhalb des Zulässigen, mit Begründung ★ ⚖
4. **Das System schlägt vor, der Betreiber entscheidet.** Ob eine Pflicht für eine Anlage gilt, hängt an Tatsachen, die keine Software kennt: an der Baugenehmigung, an der Gefährdungsbeurteilung, an der Nutzung. Der Katalog schlägt deshalb vor, und ein Mensch bestätigt oder verwirft mit Begründung. Beides wird festgehalten, denn auch die Entscheidung, dass eine Pflicht nicht gilt, muss sich später belegen lassen ⚖
5. **Ein Nachweis ist unveränderlich, auch für den Administrator.** Mit der Unterschrift wird der Stand eingefroren, die Unterschrift gilt genau der Seite, die gezeigt wurde, und die Datenbank lehnt jede spätere Änderung ab, gleich auf welchem Weg sie kommt. Berichtigt wird durch einen neuen Nachweis, der den alten nennt. Ein Zurücksetzen, das Antworten und Unterschriften löscht, gibt es nicht ⚖
6. **Offline-first.** Technikzentrale, Keller, Aufzugsschacht und Dachzentrale haben kein Netz. Die Erfassung vor Ort arbeitet vollständig ohne Verbindung, gleicht später ab und zeigt einen Konflikt, statt ihn still aufzulösen.
7. **Dasselbe Fundament wie OpenGewerk, eingebunden und nie abgeschrieben.** Die ADRs 0002 bis 0009 im Repository `opengewerk` gelten auch hier: TypeScript mit NestJS, PostgreSQL mit Row-Level Security und Drizzle, React mit Vite als eine PWA mit zwei Einstiegen, eigener Abgleich mit Postausgang, better-auth, inhaltsadressierter Dateispeicher, PDF über einen eigenen Renderer. Mandantentrennung, Anmeldung, Rechte, Audit-Log, Regel-, Fristen- und Formular-Engine werden nicht ein zweites Mal gebaut. Das Fundament liegt im Repository `opengewerk` in eigenen Paketen, und diese Anwendung bindet einen festen Stand davon ein. So kommt eine Sicherheitskorrektur dort auch hier an, und nichts läuft still auseinander (ADR 0010 im Repository `opengewerk`, Abschnitt 2.1).
8. **Mandantenfähig, mit Zuständigkeitsbereichen.** Mehrere Betreiber auf einer Instanz sind getrennt wie die Betriebe in OpenGewerk. Innerhalb eines Betreibers gibt es Bereiche: wer für die Liegenschaften im Norden zuständig ist, sieht und bearbeitet die im Süden nicht, und sein Gerät hält sie nicht.
9. **Mitbestimmung und Datenschutz sind Bauprinzip.** Die Software hält fest, wer einen Nachweis unterschrieben hat, weil das der Zweck eines Nachweises ist. Sie wertet nicht aus, wer wie viel oder wie schnell arbeitet. Die Arbeitszeiterfassung ist ein Modul, das ausgeschaltet ausgeliefert wird. Die Unterlagen, die Betriebsrat und Datenschutzbeauftragte vor der Einführung sehen wollen, erzeugt die Anwendung selbst ★ ⚖
10. **Keine künstlich beschränkten Funktionen.** Leitentscheidung 9 der Feature-Gliederung von OpenGewerk gilt für die ganze Organisation: keine Tarifstufen, keine Module gegen Aufpreis, keine Nutzerlimits, kein Contributor License Agreement. Ein Pflichtenpaket, das Geld kostet, wäre dasselbe Feature-Gate an anderer Stelle und kommt deshalb auch vom Projekt selbst nicht.
11. **Normen für die Struktur statt eigener Erfindung.** Anlagen werden nach den Kostengruppen der DIN 276 geordnet, Flächen nach DIN 277 benannt, Wartung, Inspektion, Instandsetzung und Verbesserung nach DIN 31051 unterschieden. Wer aus einem anderen System kommt oder in eines wechselt, findet seine Ordnung wieder.
12. **Technischer Gebäudebetrieb, kein IWMS, und keine Steuerung von Anlagen.** Mietverwaltung, Nebenkostenabrechnung, Umzugsplanung, Reinigungsmanagement und CAD gehören nicht dazu. Eine Gebäudeleittechnik wird gelesen, nie geschaltet.
13. **Abfrage vor KI, Einstellungen in die Oberfläche, Deutsch zuerst.** Wie in OpenGewerk: Zusammenhänge beantwortet zuerst das Datenmodell, eine KI schlägt höchstens vor; was sich einstellen lässt, steht auf einem Bildschirm mit passendem Recht und nicht in einer Datei auf dem Server; Oberfläche, Nachweise und Rechtstexte gelten für Deutschland.

---

## 1. Zielgruppe und Nutzungsszenarien

**Für wen**

Organisationen, die Gebäude betreiben und dafür eigenes technisches Personal haben, von fünf bis zu einigen hundert Gebäuden: Kliniken und Pflegeeinrichtungen, Bildungsträger, Hochschulen und Schulträger, Wohnungsunternehmen mit Hausmeistern, Kommunen, kirchliche Träger, Hotels, mittelständische Unternehmen mit eigener Werks- oder Haustechnik. Dazu Dienstleister, die den technischen Betrieb für mehrere Auftraggeber führen: jeder Auftraggeber ist dann ein eigener Betreiber auf derselben Instanz.

**Nutzer**

- Technische Leitung: trägt die Betreiberverantwortung, überträgt Pflichten, will auf einer Seite sehen, wo etwas fehlt
- Objektleitung: plant und verteilt die Arbeit in ihrem Bereich, nimmt Aufträge ab
- Haustechniker: arbeiten vor Ort mit dem Telefon oder Tablet
- Melder: Menschen, die im Gebäude arbeiten oder wohnen und eine Störung melden
- Fremdfirmen und Prüforganisationen: führen Prüfungen und Wartungen aus und liefern Berichte
- Prüfer von außen: Behörde, Versicherer, Auftraggeber, Fachkraft für Arbeitssicherheit, Brandschutz- oder Hygienebeauftragte, die Nachweise sehen wollen
- Verwaltung der Instanz: Zugänge, Einstellungen, Sicherung

**Kernszenarien**

1. Montagmorgen der Technischen Leitung: Welche Prüfung ist überfällig, welche wird in den nächsten 30 Tagen fällig, zu welcher Anlage gibt es eine Prüfpflicht, aber keinen einzigen Nachweis, und welche Mängel sind über ihre Frist?
2. Rundgang im Keller ohne Netz: Punkte abarbeiten, Warmwassertemperatur messen, Zähler ablesen, einen Mangel mit Foto festhalten, unterschreiben. Oben im Flur gleicht das Gerät ab.
3. Begehung durch die Behörde oder den Versicherer: die Nachweise aller Aufzüge der letzten Jahre in zwei Minuten vorlegen, mit Prüfer, Datum, Ergebnis und Bescheinigung.
4. Störung: Die Stationsleitung scannt das Etikett an der Tür, meldet „Heizung kalt“ mit Foto. Die Objektleitung macht daraus einen Auftrag, der Techniker erledigt ihn, die Melderin sieht, dass es erledigt ist.
5. Neue Liegenschaft: Gebäude anlegen, Anlagen vor Ort aufnehmen (Foto vom Typenschild, Seriennummer gescannt), und das System schlägt die Pflichten vor, die zu den Anlagenarten gehören.
6. Die Fremdfirma hat 140 Feuerlöscher geprüft: Bericht hochladen und alle 140 in einem Zug als geprüft nachweisen, die drei mit Mangel einzeln.
7. Ein Kollege verlässt das Unternehmen: seine Pflichtenübertragung endet, die Vertretung übernimmt, und nichts bleibt ohne Verantwortlichen.

---

## 2. Architektur-Grundbausteine

### 2.1 Was aus OpenGewerk kommt

Fertig gebaut in OpenGewerk, hier vorausgesetzt und nicht neu entworfen (Stand `main` nach Fassung 0.4.0; Fristen-Engine, Push, Bereich der Instanz und Passkeys sind dort gebaut, aber noch in keiner Fassung erschienen):

- Mandantentrennung über Row-Level Security mit `FORCE`, zusammengesetzte Fremdschlüssel über den Mandanten, Katalogtests je Tabelle
- Anmeldung mit Passwort, zweitem Faktor und Passkeys, Ersteinrichtung im Browser mit Einrichtungscode, Zugänge über Einmal-Links, Sitzungen je Gerät
- Rollen und Rechte mit einem Guard vor jeder Route und einem Test, der jede Route ohne Recht findet; Schutz gegen Cross-Site-Request-Forgery, Content-Security-Policy
- Abgleich ohne Netz: lokale Ablage, Postausgang, serverautoritative Zusammenführung, Konfliktbildschirm, Auswahl je Gerät
- Audit-Log auf Feldebene, geschrieben von Triggern, mit Hashkette je Mandant und Einsicht im Büro
- Regel-Engine mit Regelpaketen (Gültigkeitszeitraum, Fundstelle), Fristen-Engine mit Fristarten als Daten, Formular-Engine mit Paketen
- Inhaltsadressierter Dateispeicher mit Fassungen, PDF über einen eigenen Renderer, E-Mail über den Mailserver des Betreibers, Web-Push
- Nummernkreise, Einstellungen mit Gültigkeitszeitraum, versiegelte Zugangsdaten, Bereich der Instanz
- Betrieb über Docker Compose mit einem Befehl, nächtliche Sicherung, Rückspielen, Update in zwei Schritten, signierte Abbilder für x86_64 und ARM64
- Oberfläche: zwei Einstiege aus einer Codebasis (Büro und vor Ort), Designsystem, Prüfung von Kontrast, Bündelgröße und Breiten in der CI

**Was sich herauslösen lässt, wie es ist, und was eine Naht braucht.** Gemessen am 01.10.2026 ist gut die Hälfte des Codes von OpenGewerk Fundament. Rund drei Fünftel davon kennen keine Fachlichkeit und wandern in die Pakete des Fundaments, wie sie sind: Mandantentrennung, Migrationslauf, Anmeldung, der Guard, der Bereich der Instanz, Dateispeicher, Renderer, der Versand von E-Mail und Push, der Betrieb und die Bausteine der Oberfläche. Die übrigen zwei Fünftel zählen heute die Entitäten der Handwerkersoftware auf und brauchen eine Naht, bevor sie beiden dienen:

- der Abgleich: welche Entität ein Gerät anlegen und ändern darf, steht in einer Liste und in Zweigen je Entität
- die Fristen-Engine: ihre einzige Quelle ist das Angebot; die Quellen dieser Anwendung (2.4) kommen als weitere dazu
- die Formular-Engine: sie kennt Stromkreise und verlangt eine Anlage; hier hängt ein Protokoll auch an einem Raum oder an einem Rundgang
- die Benachrichtigungen: ihre Anlässe sind Beleg und Regiebericht
- der Katalog der Rechte und Rollen, die Bezeichnungen im Änderungsprotokoll, die Schlüssel der Nummernkreise und Einstellungen, die Navigation

Die Pakete und die Nähte entstehen im Repository `opengewerk`, Stück für Stück in der Reihenfolge, in der diese Anwendung sie braucht, und kommen dort auch dem zweiten Gewerk und dem Kanzlei-Hub zugute. Diese Anwendung bindet einen festen Stand der Pakete ein und kopiert nichts; so hat es ADR 0010 entschieden.

**Fachlich überschneidend.** QR-Etiketten lassen sich fast unverändert nutzen. Aufgaben, Dateien, Ansprechpartner, Tags und die Zeiterfassung passen, sobald ihre Bezüge auf Kunde und Auftrag gegen Ort, Anlage und Vorgang getauscht sind. Die Elektro-Struktur einer Anlage (Verteiler, Feld, Stromkreis, Betriebsmittel) samt Stromkreisverzeichnis und Prüfprotokoll, Artikel und Lieferanten mit dem Import aus DATANORM und die versiegelten Zugänge kommen als Pakete dazu, wenn ihre Phase kommt. Ein eigenes Modell brauchen der Ort, weil ein Betreiber keinen Kunden über seinem Objekt hat, und der Auftrag.

### 2.2 Datenmodell-Kern: vom Ort bis zum Nachweis

**Ort**

- **Liegenschaft**: Standort oder Campus mit Anschrift und Bundesland. Das Land entscheidet mit, welche Pflichten gelten (2.3)
- **Gebäude**: gehört zu einer Liegenschaft, trägt Gebäudeart (etwa Krankenhaus, Schule, Versammlungsstätte, Wohngebäude, Garage), Baujahr und Flächen. Die Gebäudeart entscheidet ebenfalls mit über die Pflichten
- **Geschoss** und **Raum**: Räume mit Nummer, Bezeichnung, Nutzung und Fläche. Außenanlagen sind Orte wie ein Gebäude
- Jeder Ort hat eine eigene Seite, eine eigene Adresse in der Anwendung und kann ein Etikett tragen

**Technik**

- **Anlage**: hat genau einen Standort (Gebäude, auf Wunsch Raum), eine **Anlagenart** aus einem Katalog und damit eine Kostengruppe nach DIN 276, dazu Hersteller, Typ, Seriennummer, Baujahr, Inbetriebnahme, Gewährleistungsende. Eine Anlage kann andere Räume oder Gebäude **versorgen**, ohne dort zu stehen: die Lüftungsanlage in der Dachzentrale versorgt die Stationen darunter
- **Komponente**: eine Anlage unter einer Anlage (Brenner am Kessel, Ventilator in der Lüftungsanlage), beliebig tief, in der Praxis selten tiefer als drei Ebenen
- **Lebenszyklus als Zeitraum, nicht als Schalter**: geplant, in Betrieb, außer Betrieb, stillgelegt, zurückgebaut, jeweils ab einem Tag. Eine stillgelegte Anlage verschwindet nicht aus der Vergangenheit, und ihre Pflichten ruhen, statt zu verfallen
- **Anlagennummer** aus einem Nummernkreis, die nie neu vergeben wird, dazu das Kennzeichen, das der Betreiber selbst führt, und ein QR-Etikett
- **Zähler sind Anlagen**: eine Messstelle mit Medium, Einheit und Zählernummer, ihre Stände hängen an ihr (4.9)
- Die Elektro-Struktur unter einer Anlage (Verteiler, Feld, Stromkreis, Betriebsmittel) ist die von OpenGewerk

**Pflicht bis Nachweis**

- **Pflicht**: hängt an einer Anlage, einem Raum, einem Gebäude oder einer Liegenschaft (2.3)
- **Termin**: die nächste Fälligkeit einer Pflicht, geführt von der Fristen-Engine (2.4)
- **Vorgang**: was getan wird, um einen Termin zu erfüllen oder eine Störung zu beheben: Rundgang, Prüfung, Wartung, Arbeitsauftrag
- **Nachweis**: der eingefrorene Beleg, dass und mit welchem Ergebnis etwas getan wurde (2.6)
- **Mangel**: was dabei aufgefallen ist, mit Klasse, Frist und Status, bis er behoben und nachgeprüft ist

Der Zustand einer Anlage (in Ordnung, fällig, überfällig, nie geprüft, Mangel offen) wird immer aus diesen Datensätzen abgeleitet und nie gespeichert. Ein gespeicherter Zustand müsste gepflegt werden und wäre zwischen zwei Läufen falsch.

### 2.3 Pflichten-Engine ★ ⚖

**Pflichtart** (im Paket, für alle Betreiber gleich): Schlüssel, Bezeichnung, Tätigkeit (Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle, Probenahme), Fundstelle, Verbindlichkeit (Gesetz oder Verordnung, technische Regel, Vorgabe des Herstellers), Frist, Art der Frist, geforderte Qualifikation, Art des Nachweises, Aufbewahrung und Geltungsbereich.

- **Frist als Regel**: der Wert steht in einem Regelpaket mit Gültigkeitszeitraum und Fundstelle. Ändert sich eine Vorschrift, gilt für eine Prüfung von 2027 auch 2030 noch die Frist von 2027
- **Art der Frist**: Höchstfrist (die Vorschrift nennt sie, der Betreiber kann sie nur verkürzen), Richtwert (der Betreiber legt die Frist fest und begründet eine Abweichung) oder ohne Vorgabe (der Betreiber ermittelt sie selbst, etwa in der Gefährdungsbeurteilung)
- **Qualifikation**: wer die Tätigkeit ausführen darf, vom unterwiesenen Mitarbeiter über die Fachkraft und die zur Prüfung befähigte Person bis zur zugelassenen Überwachungsstelle, zum Prüfsachverständigen oder zum akkreditierten Labor
- **Geltungsbereich**: Anlagenart, Merkmale der Anlage (etwa Kälteleistung, Füllmenge, Speichervolumen), Gebäudeart, Bundesland

**Pflicht** (beim Betreiber):

- entsteht als **Vorschlag** aus dem Katalog, sobald eine Anlage angelegt oder geändert wird, und wird bestätigt oder mit Begründung verworfen
- oder wird vom Betreiber selbst angelegt: Vorgabe des Herstellers, Auflage aus Baugenehmigung oder Brandschutzkonzept, Forderung des Versicherers, eigene Festlegung
- trägt die tatsächliche Frist, ihre Begründung, auf Wunsch den Verweis auf das Dokument, das die Frist trägt (4.3), den Verantwortlichen (aus der Pflichtenübertragung, 4.3) und wer ausführt (eigene Leute oder eine Fremdfirma mit Vertrag)
- ihr Zustand ist abgeleitet: **nie erfasst** (Pflicht bestätigt, aber kein Nachweis und kein Termin), **überfällig**, **fällig**, **erfüllt bis**, **ruht** (Anlage außer Betrieb). „Nie erfasst“ ist ein eigener Zustand vor „überfällig“, weil das eine nach einer Ersterfassung ruft und das andere nach einer Prüfung

Eine neue Fassung eines Pakets ändert bestätigte Pflichten nicht still. Sie meldet sich: „Für 12 Anlagen gilt ab dem 01.01. eine kürzere Frist“, und der Betreiber übernimmt. Je betroffener Pflicht übernimmt er die neue Fassung oder lässt die Pflicht, wie sie ist, mit Begründung.

### 2.4 Fristen-Engine

Die Fristen-Engine von OpenGewerk, mit den Quellen dieser Anwendung. Eine Frist wird nie getippt, sie folgt aus ihrer Quelle und fällt weg, wenn die Quelle sie nicht mehr verlangt:

- Pflichten (letzter Nachweis plus Frist)
- Rundgänge nach Plan
- Mängel (Frist zur Beseitigung)
- Dokumente mit Ablaufdatum (Zertifikat, Versicherungsnachweis, Gefährdungsbeurteilung)
- Qualifikationen und Unterweisungen der Mitarbeiter
- Verträge (Kündigungsfrist, Verlängerung) und Gewährleistung
- Pflichtenübertragungen, die enden
- das Ende einer Zugehörigkeit: der Zugang endet am letzten Tag, danach werden die Angaben des Kontos entfernt, die kein Nachweis mehr braucht (Abschnitt 9)
- Zählerablesung zum Stichtag
- Aufbewahrungs- und Löschfristen

Aktionen: Erinnerung per E-Mail oder Push, Aufgabe, Vorgang anlegen (Prüfung, Wartung, Rundgang). Die Liste „Fristen“ zeigt alles, was ansteht, filterbar nach Art, Ort, Bereich und Person. Ein Lauf, der nicht stattgefunden hat, ist im Büro sichtbar und kein Eintrag in einer Datei auf dem Server.

### 2.5 Formular- und Protokoll-Engine

Die Formular-Engine von OpenGewerk: Felder für Text, Zahl mit Einheit, Messwert mit Grenzwert, Auswahl, Ja/Nein, Foto, Unterschrift und Wiederholgruppen, Definitionen mit Fassungen, ein ausgefülltes Formular bleibt mit der Fassung lesbar, in der es entstand.

- **Mitgelieferte Formulare** kommen aus Paketen (Abschnitt 5): Prüf- und Wartungsprotokolle je Anlagenart, die Grenzwerte als Regeln mit Fundstelle
- **Eigene Formulare** legt der Betreiber im Büro an: die Vorlagen seiner Rundgänge und die Felder, die er an einer Anlagenart zusätzlich führen will
- Ein Messwert in einer eigenen Vorlage misst gegen eine Regel aus einem Paket und folgt dann deren Fassungen, oder gegen einen eigenen Wert des Betreibers mit Quelle, der in der Fassung der Vorlage steht
- Zwei Feldarten kommen dazu: der **Prüfpunkt** (in Ordnung, nicht in Ordnung, entfällt, nicht möglich, mit Bemerkung und Foto) und der **Zählerstand**, der den abgelesenen Wert an die Messstelle schreibt
- Ein Punkt kann auf eine Anlage oder einen Raum zeigen. Was dort festgestellt wird, steht dann in deren Akte, und ein „nicht in Ordnung“ wird ein Mangel an genau dieser Anlage, ein Messwert außerhalb seines Grenzwerts ebenso (4.5)

### 2.6 Nachweis und Festschreibung ⚖

- Ein Nachweis entsteht aus einem unterschriebenen Protokoll, aus einem hochgeladenen Bericht einer Fremdfirma oder Prüforganisation (mit Prüfer, Organisation, Datum und Ergebnis), aus einem Punkt eines unterschriebenen Rundgangs oder aus einem abgenommenen Arbeitsauftrag. Bei der Übernahme aus einer Vorgängeranwendung kommt er als Altbestand herein und sagt das (Abschnitt 11)
- Mit der Unterschrift wird der Stand in einer Fassung eingefroren, das PDF entsteht beim ersten Abruf und liegt danach im inhaltsadressierten Speicher. Ein späterer Export liest den eingefrorenen Stand und nie die laufenden Daten
- Die Unterschrift trägt einen Fingerabdruck der Seite, die gezeigt wurde. Der Server nimmt sie nur für genau diese Seite an
- Unterschrieben wird mit dem Schriftzug auf dem Gerät oder, wo das eine Hürde ist, ohne ihn: die Person bestätigt mit ihrem getippten Namen. Beides ist dieselbe Signatur des angemeldeten Kontos, und der Nachweis sagt, welcher Weg es war
- Sie ist eine elektronische Signatur der einfachen Stufe, gebunden an das angemeldete Konto. Wo eine Vorschrift mehr verlangt oder ein Betreiber mehr will, wird das PDF des Nachweises mit einer höheren Signatur versehen und am Nachweis abgelegt (Abschnitt 15)
- Die Datenbank lehnt Änderung und Löschen eines Nachweises ab, auch für den Eigentümer der Tabellen. Das Löschen einer Anlage, eines Artikels oder eines Benutzers ändert keinen Nachweis
- **Berichtigung** statt Zurücksetzen: ein neuer Nachweis nennt den, den er ersetzt, und beide bleiben. Ein fälschlich unterschriebener Rundgang wird für ungültig erklärt, mit Grund und Person, und bleibt lesbar
- Nachweise tragen eine laufende Nummer aus einem Nummernkreis
- **Aufbewahrung** je Pflichtart aus dem Regelpaket, mindestens so lange, wie die Vorschrift es verlangt; der Betreiber kann länger aufbewahren, nicht kürzer. Sie ist keine einzelne Zahl, sondern eine Regel mit drei Formen: eine Zahl von Jahren, mindestens bis zur nächsten Prüfung, oder so lange die Anlage verwendet wird. Nach Ablauf schlägt der Löschlauf vor, und die Leitung bestätigt

### 2.7 Abgleich ohne Netz

Der Abgleich von OpenGewerk, mit den Regeln dieser Anwendung:

- **Auswahl je Gerät**: ein Techniker hält die Orte und Anlagen seines Bereichs, seine Rundgänge und Aufträge, auch die, an denen er beteiligt ist, seine Aufgaben, die Formulare und Pakete. Die Leitung hält den ganzen Betreiber. Beim Abmelden wird die lokale Ablage gelöscht
- Liegenschaft, Gebäude und Geschoss ändert das Büro mit Verbindung
- Raum, Anlage und Komponente lassen sich vor Ort ohne Netz anlegen und ergänzen: die Bestandsaufnahme ist der häufigste Fall
- Findet der Server beim Abgleich zu einer vor Ort angelegten Anlage eine mögliche Dublette, die das Gerät nicht halten konnte, wird der Vorgang ein Konflikt: die Person sieht die andere Anlage, soweit sie in ihrem Bereich liegt, und entscheidet, ob es dieselbe ist oder ob sie trotzdem angelegt wird
- Lesen zwei Geräte denselben Zähler am selben Tag ab, bekommt das zweite einen Konflikt und entscheidet, ob sein Stand den ersten berichtigt oder verworfen wird (4.9)
- Antworten eines Rundgangs und eines Protokolls sind je Punkt eine eigene Zeile. Zwei Leute an verschiedenen Punkten kollidieren nicht, am selben Punkt entsteht ein Konflikt
- Unterschrift und Nachweis entstehen und werden nie geändert
- Pflichten, Pflichtenübertragungen und Verträge pflegt das Büro mit Verbindung
- Dokumente liegen nicht von selbst auf dem Gerät; eine Anlage lässt sich mit ihren Unterlagen für unterwegs merken

### 2.8 Zuständigkeitsbereiche

- Ein **Bereich** bündelt Liegenschaften. Ein kleiner Betreiber hat einen einzigen und merkt nichts davon
- Eine Zugehörigkeit gilt für alle Bereiche oder für genannte. Rollen und Bereich zusammen ergeben, was jemand sieht und tut
- **Vertretung**: befristet übernimmt jemand die Bereiche einer anderen Person, mit Anfang und Ende
- Ein Bereich lässt sich erst entfernen, wenn keine Liegenschaft mehr in ihm liegt; sie werden vorher in einen anderen verlegt. Wer danach keinen Bereich mehr hat, sieht nichts mit Ortsbezug, und die Liste der Zugänge sagt es; gesperrt wird dadurch niemand
- Durchgesetzt wird der Bereich in der Datenbank, nicht in jeder einzelnen Abfrage: eine Zeile mit Ortsbezug trägt ihren Bereich, und die Policy lässt nur die Bereiche der Anfrage durch
- Betreiberweit und ohne Bereich: Katalog, Fremdfirmen, Lager, Schlüsselanlagen, Einstellungen

### 2.9 Regel-Engine

Die Regel-Engine von OpenGewerk, um zwei Dinge erweitert:

- **Geltungsbereich**: ein Regeldatensatz gilt bundesweit oder in einem Land. Bauordnungsrecht ist Landesrecht, und eine Prüfung, die in einem Land vorgeschrieben ist, gibt es im nächsten nicht
- **Einheiten**: Monate, Grad Celsius in Zehnteln, Kilowatt, Kilogramm und Tonnen CO2-Äquivalent, Anzahl je 100 ml, dazu was die Formulare an Messwerten brauchen
- **Gesetzliche Feiertage** je Land sind Regeln wie alle anderen, mit Fundstelle und Gültigkeit, damit der Plan eines Rundgangs sie auslassen kann (4.5)

Wie dort gilt: jede Abfrage nennt einen Tag, und für einen Tag ohne hinterlegte Regel gibt es keine Antwort statt einer erfundenen.

---

## 3. Querschnittsfunktionen

- Benutzer, Rollen und Bereiche (Abschnitt 7); Anmeldung mit Passwort, zweitem Faktor und Passkeys; für Leitung und Verwaltung ist der zweite Faktor Pflicht
- Eigene Angaben (Name, E-Mail, Passwort, zweiter Faktor, Geräte) ändert jede Person selbst unter „Konto“, mit erneuter Bestätigung; Name und E-Mail eines Kontos berichtigt auch die Leitung ⚖
- Mehrere Betreiber auf einer Instanz, Wechsel ohne neue Anmeldung; Bereich für die Verwaltung der Instanz
- Rechtstexte der Instanz (Impressum, Datenschutzhinweise) pflegt ihre Verwaltung in der Oberfläche; sie stehen nicht im Quelltext
- Änderungsprotokoll über alle Module, für die Leitung einsehbar
- Aufgaben mit Fälligkeit und verantwortlicher Person, an Ort, Anlage oder Vorgang. Jede Person legt eigene an; einer anderen teilt sie zu, wer auch Vorgänge plant und verteilt. Die eigenen Aufgaben liegen auf dem Gerät und lassen sich ohne Netz erledigen
- Benachrichtigungen per E-Mail und Push, gespeist nur aus der Fristen-Engine und aus Statuswechseln; welche Anlässe als Push kommen, wählt jede Person selbst. Die Anlässe: eine Frist wird fällig; ein Rundgang, eine Prüfung oder ein Auftrag wird jemandem zugeteilt; ein Auftrag wird zurückgewiesen; ein Rundgang wartet auf die Gegenzeichnung; ein Auftrag wartet auf die Abnahme; eine Aufgabe wird fällig. Nur ein Auftrag der Dringlichkeit „sofort“ kommt immer als Push (4.8)
- Suche über Liegenschaften, Gebäude, Räume, Anlagen und Vorgänge nach Name, Nummer und Kennzeichen. Vor Ort fragt sie mit Netz den Server und findet im eigenen Bereich auch, was das Gerät nicht hält; ohne Netz sucht sie im Bestand des Geräts. Volltextsuche über Dokumente ⏳
- Etiketten: QR-Code je Anlage und je Raum, für den Etikettendrucker oder als Bogen; ein verlorenes Etikett wird gesperrt
- Import und Export (CSV, Excel) mit Vorschau und Dubletten-Prüfung; jede Liste im Büro lässt sich als Tabelle ausgeben, mit dem, was ihr Filter gerade zeigt
- DSGVO-Funktionen ⚖: Löschkonzept mit Aufbewahrungsfristen, Auskunft und Datenexport, Verzeichnis der Verarbeitungstätigkeiten als erzeugtes Dokument, Vorlage für den Vertrag zur Auftragsverarbeitung
- Verfahrensbeschreibung für Betriebsrat, Personalrat oder Mitarbeitervertretung als erzeugtes Dokument ★ ⚖ (Abschnitt 9)
- Barrierefreiheit ⚖: Tastatur, Kontrast und Beschriftungen für Bildschirmleser von Anfang an in den Bausteinen, geprüft in der CI; die Unterschrift hat einen Weg ohne Schriftzug (2.6)
- Betrieb: Sicherung und Rückspielen, Update mit Migrationen, Gesundheitsprüfung, Docker-Compose-Referenzinstallation, signierte Releases

---

## 4. Funktionsumfang

### 4.1 Liegenschaften, Gebäude, Räume

- Liegenschaften mit Anschrift, Land, Ansprechpartnern, Fotos und Zugängen (Schlüssel, Codes, versiegelt gespeichert, jedes Aufdecken festgehalten ⚖)
- Gebäude mit Kürzel, Gebäudeart, Baujahr, Flächen und Schließzeiten, in denen kein Rundgang entsteht (4.5); Geschosse; Räume mit Nummer, Nutzung und Fläche
- **Lagebild je Gebäude** statt einer Mappe mit Reitern: oben, was zu tun ist (überfällig, fällig, nie erfasst, offene Mängel, offene Störungen, fehlende Zählerstände), darunter der Bestand, darunter die letzten Vorgänge. Jede Zahl ist ein Link auf die gefilterte Liste
- **Übersicht über alle Liegenschaften** mit denselben Zahlen je Gebäude, in fester Reihenfolge, auf Wunsch nach Dringlichkeit
- Raumseite mit den Anlagen, die dort stehen, und denen, die den Raum versorgen
- Zeitachse je Liegenschaft, Gebäude und Raum über alle Vorgänge
- Navigation über den Pfad Liegenschaft › Gebäude › Geschoss › Raum › Anlage, auf jedem Gerät gleich. Vor Ort hat jede Ebene eine schlichte Seite mit dem, was darunter liegt, ohne Lagebild

### 4.2 Anlagen und Anlagenakte

- Anlagenverzeichnis je Gebäude und über alle Gebäude, gefiltert nach Kostengruppe, Anlagenart, Zustand, Standort, Lebenszyklus
- **Anlagenakte** mit eigener Adresse: Stammdaten, Standort und Versorgungsbereich, Komponenten, Pflichten mit Zustand, Nachweise, Mängel, Aufträge, Störungen, Dokumente, Verträge und Gewährleistung, Zeitachse
- **Anlagenarten** aus Paketen (Abschnitt 5): jede Art bringt ihre Felder, ihre Kostengruppe und die Pflichten mit, die für sie in Frage kommen. Eigene Anlagenarten und eigene Felder des Betreibers kommen dazu. Für jede Anlage, die kein Fachpaket beschreibt, gibt es eine allgemeine Anlagenart ihrer Kostengruppe, damit Import und Bestandsaufnahme den ganzen Bestand erfassen, bevor das passende Paket oder die eigene Anlagenart da ist
- **Bestandsaufnahme vor Ort** ★: Anlage auf dem Telefon anlegen, auch ohne Netz, Typenschild fotografieren, Seriennummer mit der Kamera lesen, Etikett kleben und zuordnen
- Dubletten-Prüfung beim Anlegen und Importieren (gleiche Seriennummer, gleiches Kennzeichen); bei einer ohne Netz angelegten Anlage prüft der Abgleich (2.7)
- Etikett je Anlage: der Scan öffnet die Akte, für Melder ohne Konto die Störungsmeldung (4.7)
- Elektro: Verteiler, Felder, Stromkreise und Betriebsmittel mit Stromkreisverzeichnis für die Verteilertür
- Tausch einer Anlage: die alte wird zurückgebaut, die neue übernimmt Standort und Versorgungsbereich; Pflichten werden neu vorgeschlagen, die Nachweise der alten bleiben bei der alten. Was an der alten offen ist, endet mit ihr: ein offener Mangel gilt mit dem Tausch als behoben, ein offener Vorgang wird mit Grund als nicht durchgeführt geschlossen. Komponenten bleiben bei der alten, einzelne lassen sich mitnehmen

### 4.3 Betreiberpflichten ★ ⚖

- **Pflichtenverzeichnis**: alle Pflichten des Betreibers mit Anlage, Fundstelle, Frist, Verantwortlichem, Ausführendem, letztem Nachweis und nächster Fälligkeit
- **Vorschläge** aus dem Katalog je Anlage, zum Bestätigen oder Verwerfen mit Begründung; auch im Stapel für viele gleichartige Anlagen
- **Eigene Pflichten**: Herstellervorgabe, Auflage, Forderung des Versicherers, eigene Festlegung, jeweils mit Quelle
- **Frist festlegen**: innerhalb dessen, was die Pflichtart zulässt, mit Begründung und Verweis auf das Dokument, das sie trägt (Gefährdungsbeurteilung). Der Verweis ist empfohlen und nicht verlangt; er merkt sich die Fassung des Dokuments vom Tag der Bestätigung, und liegt eine neuere vor, sagt die Pflicht „Frist prüfen“
- **Übersicht Betreiberverantwortung**: über alle Liegenschaften oder einen Bereich, was überfällig ist, was in 30 und 90 Tagen fällig wird, wo eine Pflicht nie erfasst wurde, wo ein Nachweis fehlt, welche Mängel über ihrer Frist sind
- **Pflichtenübertragung** ⚖: schriftlich, mit Aufgaben, Bereich und Befugnissen, von beiden unterschrieben, mit Beginn und Ende, als eingefrorenes Dokument; die beauftragte Person erhält eine Ausfertigung. Eine Pflicht ohne Verantwortlichen wird angezeigt, statt still weiterzulaufen
- **Qualifikationen** der Mitarbeiter mit Ablaufdatum (Elektrofachkraft, zur Prüfung befähigte Person für ein Arbeitsmittel, Hygieneschulung, Sachkunde); wird ein Vorgang jemandem zugewiesen, dem die Qualifikation fehlt oder abgelaufen ist, weist die Oberfläche darauf hin
- **Nachweisverzeichnis** als PDF und Tabelle: je Anlage die Pflichten mit dem letzten Nachweis, für Begehungen und Audits
- **Lesender Zugang für Prüfer von außen** ★: befristet, auf Liegenschaften oder Anlagenarten beschränkt, jeder Zugriff festgehalten
- Gefährdungsbeurteilungen als Dokument mit Gültigkeit und Wiedervorlage an Anlage oder Tätigkeit; die Erstellung selbst ⏳

### 4.4 Prüfungen und Wartungen

- Aus einem fälligen Termin entsteht ein Vorgang, mit Vorlauf, beim Verantwortlichen oder beim Ausführenden
- **Eigene Durchführung**: Protokoll aus dem Paket der Anlagenart, Messwerte mit Grenzwertprüfung, Ergebnis, Mängel, Unterschrift. Das letzte Protokoll einer Anlage ist die Vorlage des nächsten, soweit die Definition es zulässt
- **Fremde Durchführung**: Termin mit der Fremdfirma, Bericht oder Prüfbescheinigung hochladen, Prüfer, Organisation, Datum und Ergebnis eintragen. Ein Bericht kann viele Anlagen abdecken und wird in einem Zug zugeordnet
- **Ergebnis**: ohne Mangel, mit Mängeln, nicht bestanden, nicht durchgeführt (mit Grund). Die Mängelklassen kommen aus dem Paket (4.6, Abschnitt 5)
- Die nächste Fälligkeit rechnet sich aus dem Nachweis und der Frist; ob ab dem Tag der Prüfung oder ab dem fälligen Tag gezählt wird, sagt die Pflichtart. Zählt sie ab dem fälligen Tag, erfüllt eine Durchführung den offenen Termin, wenn sie höchstens ein Zwölftel der Frist vor ihm liegt, und der Rhythmus bleibt; liegt sie früher, zählt die Frist neu ab ihrem Tag, wie es § 14 Abs. 5 BetrSichV für Arbeitsmittel vorsieht. So fällt kein Termin aus, und keine Durchführung geht verloren. Die Fälligkeit rückt erst mit dem Nachweis weiter und nie mit dem Anlegen des Vorgangs: eine Prüfung, die geplant und nicht durchgeführt wurde, bleibt überfällig
- Sammelvorgänge: alle Feuerlöscher eines Gebäudes, alle ortsveränderlichen Betriebsmittel eines Bereichs
- Unterscheidung nach DIN 31051: Wartung, Inspektion, Instandsetzung, Verbesserung, damit Auswertungen dieselbe Sprache sprechen wie Verträge und Leistungsverzeichnisse

### 4.5 Rundgänge und Checklisten

- **Vorlage** des Betreibers mit Kapiteln und Punkten, als Formular mit Fassungen. Ein laufender Rundgang bleibt auf seiner Fassung. Vorlagen führt, wer das Recht dafür hat, ab der Objektleitung; eine Vorlage, die auf Anlagen zeigt, ändert nur, wer deren Bereich sieht. Ein Punkt zeigt auf eine bestimmte Anlage, einen bestimmten Raum oder auf nichts; die Wiederholung über alle Anlagen einer Art kommt mit den Sammelvorgängen (4.4)
- **Plan**: Vorlage, Ort, Rhythmus (täglich, wöchentlich, monatlich, jährlich, mit Wochentag oder Tag), zuständige Person oder Bereich, Vorlauf. Zuteilung im Büro, auch als „wie letzte Woche“. Ein Plan nennt die Wochentage, an denen er gilt, und kann gesetzliche Feiertage auslassen (2.9); in den Schließzeiten des Gebäudes (4.1) entsteht kein Rundgang. Sonst zählt ein Feiertag wie jeder Tag
- **Jeder fällige Durchgang ist ein eigener Rundgang** mit eigener Unterschrift. Ein täglicher Rundgang ergibt sieben in der Woche und keine Wochenliste mit sieben Spalten; was in kürzerem Abstand zu belegen ist, etwa eine Spülung nach spätestens 72 Stunden, ist eine eigene Pflicht mit eigenem Nachweis
- **Durchführung** auf dem Telefon, ohne Netz, jede Eingabe sofort auf dem Gerät gesichert: Prüfpunkt, Messwert mit Grenzwert, Zählerstand, Foto, Bemerkung
- Ein Punkt kann eine **Pflicht erfüllen**: die monatliche Funktionskontrolle im Rundgang ist dann der Nachweis dieser Pflicht, ohne zweite Erfassung ★
- „Nicht in Ordnung“ verlangt eine Bemerkung und wird mit der Unterschrift ein **Mangel** an der Anlage oder dem Raum des Punkts. Ein Messwert außerhalb seines Grenzwerts ebenso, mit Wert und Grenzwert
- **Abgabe** erst, wenn jeder Punkt eine Antwort hat. „Entfällt“ und „nicht möglich“ sind Antworten und verlangen einen Grund; einen Rundgang mit unbeantworteten Punkten nimmt das System nicht an, und das lässt sich nicht abschalten
- Unterschrift, danach unveränderlich (2.6). Verlangt die Vorlage eine **Gegenzeichnung** der Objektleitung, gilt der Nachweis erst mit beiden Unterschriften, jede mit eigenem Zeitpunkt
- Offene Rundgänge vergangener Zeiträume bleiben sichtbar und lassen sich mit Grund als nicht durchgeführt schließen, statt still zu verschwinden
- PDF des Rundgangs aus dem eingefrorenen Stand, mit Fotos und Unterschrift; Datenexport als Tabelle
- Übersicht für die Objektleitung: welcher Rundgang ist in dieser Woche offen, begonnen, abgegeben, nach Gebäude und nicht nach Person

### 4.6 Mängel

- Entstehen aus Rundgang, Prüfung, Störmeldung oder von Hand, immer an einer Anlage oder einem Ort, mit Foto
- Klasse und Frist zur Beseitigung, die Vorgabe je Klasse stellt der Betreiber ein. Die Klassen kommen aus dem Paket: ein Mangel aus einer Prüfung nimmt die des Pakets seiner Pflichtart, jeder andere die drei allgemeinen Stufen des Pakets Allgemein (gering, erheblich, gefährlich). Ein gemeldeter Mangel hat zuerst keine Klasse; vergeben wird sie von dem, der Mängel führt, und bis dahin steht er als „ohne Klasse“ in der Liste
- Status: festgestellt → beauftragt → behoben → nachgeprüft; „behoben“ kommt aus dem Auftrag, mit der Unterschrift dessen, der ihn führt, und eine Zurückweisung bei der Abnahme setzt den Mangel auf „beauftragt“ zurück; „nachgeprüft“ ist ein eigener Schritt
- Ein Mangel, der eine Anlage unsicher macht, setzt sie außer Betrieb und sagt das an der Anlage, am Raum und im Lagebild
- Offene Mängel je Anlage, Gebäude und Bereich; Mängelbericht als PDF

### 4.7 Störmeldungen

- **Mit Konto**: die Rolle Melder legt eine Störung an und sieht ihre eigenen
- **Ohne Konto** ★: das Etikett am Raum oder an der Anlage öffnet eine Seite mit Kategorie, Beschreibung und Foto, auf Wunsch mit Kontakt für die Rückmeldung. Die Seite gibt nichts preis außer dem Namen des Raums auf dem Etikett, hat ein Ratenlimit je Etikett und Adresse, und ein gesperrtes Etikett öffnet nichts
- **Eingang** bei der Objektleitung des Bereichs: annehmen (wird ein Auftrag), zusammenführen (dieselbe Störung dreimal gemeldet), ablehnen mit Grund
- Rückmeldung an den Melder bei Annahme und Erledigung
- Zeit bis zur Annahme und bis zur Erledigung je Kategorie und Gebäude, als Kennzahl des Betriebs und nicht einer Person
- Meldungen aus der Gebäudeleittechnik landen im selben Eingang (4.15)

### 4.8 Arbeitsaufträge und Leistungsnachweis

- Auftrag mit Nummer, Ort oder Anlage, Art (Störung, Mangelbeseitigung, Wartung, Prüfung, sonstiger Auftrag), Dringlichkeit (normal, dringend, sofort), Frist, einer verantwortlichen Person und weiteren Beteiligten
- „Sofort“ ist für eine Störung, die den Betrieb aufhält, und erreicht die verantwortliche Person immer als Push (Abschnitt 3)
- Weitere Beteiligte arbeiten mit: sie haben den Auftrag auf ihrem Gerät und schreiben Notizen, Fotos und Dauer dazu. Abschließen können sie ihn nicht, und auf der unterschriebenen Seite stehen sie nicht
- Entsteht aus Störmeldung, Mangel, Termin oder von Hand, und bleibt mit seinem Ursprung verknüpft
- Vor Ort: Notizen als eigene Einträge, Fotos, Material aus dem Lager, Dauer, Protokoll; abschließen mit Unterschrift
- **Abnahme** durch die Objektleitung oder den Ersteller: abgenommen oder zurückgewiesen mit Begründung. Eine Zurückweisung macht die Unterschrift ungültig und lässt sie stehen
- Abschließen kann einen Auftrag nur, wer ihn führt: der Knopf, der etwas unumkehrbar macht, steht der verantwortlichen Person zu und nicht jedem, der das Formular sieht
- **Leistungsnachweis** für den Auftraggeber im Haus oder beim Kunden: geleistete Arbeit, Dauer, Material, Unterschrift des Auftraggebers mit Namen in Druckschrift, als eingefrorenes PDF, ohne Preise. Die Dauer ist Aufwand des Auftrags und keine Arbeitszeiterfassung; Namen und Uhrzeiten der Ausführenden stehen nur darauf, wenn der Betreiber es einschaltet, und dann auch in der Verfahrensbeschreibung (Abschnitt 9) ⚖
- Wiederkehrende Aufträge sind Pflichten mit der Verbindlichkeit „eigene Festlegung“ und laufen über dieselbe Engine

### 4.9 Zähler und Energie

- Messstellen als Anlagen: Medium (Strom, Wasser, Wärme, Fernwärme, Gas, Kälte), Einheit, Zählernummer, Wandlerfaktor, Haupt- und Unterzähler, Kennung in der Leittechnik
- **Ablesung** zum Stichtag auf dem Telefon, als Punkt eines Rundgangs oder als eigene Runde, mit dem Vormonatswert daneben und einer Prüfung auf Unmögliches (kleiner als der letzte Stand, Sprung um ein Vielfaches). Den Stichtag stellt der Betreiber ein, eine einzelne Messstelle kann davon abweichen
- Ein Stand wird nie überschrieben: berichtigt wird durch einen neuen Eintrag, der den alten nennt, mit Grund und Person
- **Verbrauch** wird abgeleitet und nie gespeichert
- **Zählertausch** als Eintrag an der Messstelle (Endstand alt, Anfangsstand neu, beide Nummern, Tag); der Verbrauch des Tauschmonats rechnet über beide Geräte
- **Stilllegung als Zeitraum**, **Sperre mit Begründung**, **Notiz** an der Messstelle („Zutritt nur für Elektrofachkräfte“)
- **Auswertung**: Verlauf über 12 und 24 Monate, Vergleich mit dem Vorjahr, Verbrauch je Quadratmeter, Ausreißer als Hinweis (ein Wasserverlust fällt auf, bevor die Rechnung kommt)
- Stände aus Dateien, Datenloggern oder der Leittechnik übernehmen, Stände an ein Energiemanagementsystem ausgeben (4.15)
- Datengrundlage für Energieaudit und Energiemanagement; die Zertifizierung selbst ist nicht Gegenstand ⚖

### 4.10 Dokumente

- Ablage an Liegenschaft, Gebäude, Raum, Anlage, Vorgang, Vertrag und Fremdfirma, mit Fassungen
- Art des Dokuments (Betriebsanleitung, Prüfbescheinigung, Schaltplan, Revisionsunterlage, Genehmigung, Konzept) und **Gültigkeit**: ein Ablaufdatum wird eine Frist
- **Soll-Dokumente** je Anlagenart aus dem Paket: was zu einer Anlage vorliegen sollte. Vollständig ist eine Akte, wenn die Datei da ist, nicht wenn ein Haken gesetzt wurde
- Fotos werden auf dem Gerät verkleinert, Dateien von außen nach ihren ersten Bytes geprüft
- Volltextsuche und Texterkennung ⏳

### 4.11 Fremdfirmen und Verträge

- Firmen mit Ansprechpartnern, Leistungen und Nachweisen mit Ablaufdatum (Zertifikate, Versicherung, Fachbetriebseigenschaft)
- Verträge: Firma, erfasste Anlagen und Gebäude, welche Pflichten der Vertrag erfüllt, Laufzeit, Kündigungsfrist, Reaktionszeiten, Preis als Angabe; Kündigungsfrist und Verlängerung über die Fristen-Engine
- Gewährleistung je Anlage oder Maßnahme, mit Erinnerung vor Ablauf
- Einsatz einer Fremdfirma: Auftrag, Einweisung vor Ort mit Unterschrift, Erlaubnisschein für feuergefährliche Arbeiten als Formular, Bericht hochladen
- Zugang für Fremdfirmen zu ihren Aufträgen und Anlagen, um Berichte selbst einzustellen ⏳
- Verbindung zur Handwerkersoftware der Fremdfirma ⏳ (Abschnitt 6)

### 4.12 Lager und Material

- Artikel und Lieferanten wie in OpenGewerk, einschließlich des Imports aus DATANORM
- Lager und Fahrzeuge mit Bestand, Mindestbestand mit Hinweis, Entnahme am Auftrag per Scan
- Der Verbrauch an einem abgenommenen Auftrag bleibt stehen, auch wenn der Artikel später entfällt
- Preise sind eine Angabe für die Kostensicht (4.16), kein Belegwesen

### 4.13 Schlüssel und Zugänge

- Zugänge zu Liegenschaften und Räumen (Codes, Schlüsselkästen) versiegelt wie in OpenGewerk
- Schließanlagen, Schlüssel mit Nummer, Exemplare; Ausgabe an Mitarbeiter und Fremdfirmen mit Unterschrift, Rückgabe, Verlust; Quittung als eingefrorenes PDF
- Übersicht: wer hat welchen Schlüssel, was ist überfällig zurückzugeben

### 4.14 Personal: Unterweisungen, Bereitschaft, Arbeitszeit

- Unterweisungen mit Thema, Datum, Teilnehmern und Unterschrift; die Wiederholung über die Fristen-Engine ⚖
- Rufbereitschaft: wer ist außerhalb der Arbeitszeit zuständig, wohin geht eine dringende Störung
- Einsatzplanung: wer macht wann welchen Rundgang und welchen Auftrag, als Tafel je Bereich
- **Arbeitszeit** als abschaltbares Modul, ausgeschaltet ausgeliefert: die Zeiterfassung von OpenGewerk mit den Warnungen nach dem Arbeitszeitgesetz aus dem Regelpaket. Beim Einschalten sagt die Anwendung, dass die Einführung der Mitbestimmung unterliegt, wo es eine Arbeitnehmervertretung gibt ⚖
- Ressourcen buchen (Fahrzeuge, Geräte, Räume) ⏳

### 4.15 Gebäudeleittechnik und Messwerte

- **Nur lesend.** Es gibt keinen Schaltbefehl und keinen Schreibzugriff auf eine Leittechnik
- **Meldungsquellen**: ein Adapter je System holt Meldungen und Alarme ab, ordnet sie über die Datenpunktadresse einer Anlage zu und legt sie in den Eingang der Störmeldungen. Der erste Adapter ist der des Pilotbetriebs
- **Messwerte und Zählerstände**: Übernahme aus Dateien (CSV) und von Datenloggern, Zuordnung über die Kennung der Messstelle
- **Ausgabe**: Zählerstände als Datei in einem dokumentierten Format für ein Energiemanagementsystem, das sie abholt
- Jede Verbindung nach außen läuft über einen eigenen Dienst mit eigenen Zugangsdaten, versiegelt gespeichert; welche Adressen im eigenen Netz erreichbar sind, gibt die Verwaltung der Instanz frei, nicht der einzelne Betreiber

### 4.16 Auswertungen

- Lagebilder und die Übersicht Betreiberverantwortung (4.1, 4.3)
- Erfüllung der Pflichten über die Zeit, offene Mängel nach Alter und Klasse, Störungen nach Kategorie und Gebäude, Zeiten bis zur Annahme und Erledigung
- **Kostensicht** auf Wunsch: Kostenstelle je Gebäude oder Anlage, Stundensätze und Materialpreise als Einstellung, Kosten je Gebäude, Anlage und Gewerk, eigene gegen fremde Leistung. Keine Rechnungen, keine Buchhaltung
- **Keine Auswertung je Person** als Vorgabe: keine Rangliste, kein Verzug je Mitarbeiter. Die Planungsansicht der Objektleitung zeigt, was wem zugeteilt ist, und sonst nichts ⚖
- Export jeder Liste; lesender Zugang für eigene Auswertungen ⏳

---

## 5. Pakete: Pflichtenkatalog, Anlagenarten, Formulare

Pakete im Format von ADR 0008, als Daten im Repository, mit den Tests, die prüfen, was ein Beitrag ohne Code falsch machen kann:

```
pakete/<name>/
  manifest.json          # Name, Fassung, benötigte Kernfassung
  anlagenarten/*.json    # Arten mit Kostengruppe, Feldern, Merkmalen, Soll-Dokumenten
  pflichten/*.json       # Pflichtarten mit Fundstelle, Qualifikation, Geltungsbereich
  regeln/*.json          # Fristen und Grenzwerte mit Gültigkeit und Fundstelle
  formulare/*.json       # Prüf- und Wartungsprotokolle
  vorlagen/*.json        # Vorlagen für Rundgänge, die ein Betreiber übernehmen und anpassen kann
  mangelklassen.json     # Klassen der Mängel mit Fundstelle, und ob eine Klasse eine Anlage unsicher macht
  abnahmen.json          # je Eintrag: zuletzt gegen die Quelle geprüft, abgenommen von wem und wann
```

**Die Pakete bis Version 1**, in der Reihenfolge, in der sie gebaut werden. Jedes erscheint vollständig für seinen Bereich und nicht nur im Umfang eines Betreibers:

| Paket | Inhalt |
| --- | --- |
| Elektro | elektrische Anlagen und ortsfeste Betriebsmittel, ortsveränderliche Betriebsmittel, Fehlerstrom-Schutzeinrichtungen, Sicherheitsbeleuchtung, Sicherheitsstromversorgung, Blitzschutz; die Formulare des Elektro-Pakets von OpenGewerk |
| Brandschutz | Feuerlöscher, Brandmelde- und Alarmierungsanlagen, Rauch- und Wärmeabzug, Feststellanlagen, Brandschutzklappen, Wandhydranten, Löschanlagen, Brandschutztüren |
| Trinkwasser | Trinkwassererwärmung und Legionellen, Temperaturen, Probenahme, Sicherungseinrichtungen, Filter |
| Raumluft und Kälte | Lüftungs- und Klimaanlagen (Hygiene, Filter, energetische Inspektion), Kälteanlagen (Dichtheit), Verdunstungskühlanlagen |
| Heizung | Wärmeerzeuger und Wärmepumpen, Abgasanlage, Heizöllagerung, Gasinstallation |
| Förderanlagen und Arbeitsmittel | Aufzüge, kraftbetätigte Türen und Tore, Leitern und Tritte, Regale, Druckbehälter |
| Landesrecht | je Bundesland die Prüfung technischer Anlagen in Sonderbauten, zuerst Baden-Württemberg |

Dazu kommt vor ihnen das Paket **Allgemein**: je Kostengruppe nach DIN 276 eine allgemeine Anlagenart, in eigenen Worten benannt und ohne Pflichtarten. Es ist der Auffang für jede Anlage, die kein Fachpaket beschreibt, damit der Bestand eines Betreibers vollständig erfasst werden kann, auch bevor das Paket für seine Anlagen erscheint. Kommt das Fachpaket, wird die Anlagenart der Anlage berichtigt; ihre Pflichten werden dann vorgeschlagen. Eigene Pflichten kann eine Anlage mit allgemeiner Art von Anfang an tragen (4.3). Das Paket bringt außerdem die drei allgemeinen Mängelklassen mit, für jeden Mangel, der nicht aus einer Prüfung kommt (4.6)

**Was der Katalog nennen darf**, hängt an der Herkunft der Pflicht. Jede Pflichtart trägt sie als Angabe:

| Herkunft | Was im Paket steht |
| --- | --- |
| Staatliches Recht: Gesetz, Verordnung, amtliche Bekanntmachung | Fundstelle, Frist, Qualifikation und die Pflicht in eigenen Worten. Amtliche Werke sind gemeinfrei (§ 5 Abs. 1 UrhG) |
| Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse | Fundstelle, Frist und Qualifikation in eigenen Worten; ob mehr zulässig ist, klärt die rechtliche Prüfung, die parallel läuft (Abschnitt 15) |
| Private Normen und Richtlinien (DIN, VDE, VDI, VDMA, VdS, DVGW und andere) | Der Verweis auf Norm, Ausgabe und Abschnitt und die Pflicht in eigenen Worten. Kein Normtext, keine Tabelle, kein Leistungskatalog: das Urheberrecht an privaten Normen bleibt bestehen, auch wo ein Gesetz auf sie verweist (§ 5 Abs. 3 UrhG). Die Frist nennt das Paket nur, soweit die rechtliche Prüfung das trägt; bis dahin steht dort der Verweis, und der Betreiber trägt die Frist ein |

Regeln für jeden Beitrag:

- Eine Pflichtart ohne Fundstelle wird nicht aufgenommen: Paragraf, Norm mit Ausgabe und Abschnitt, oder die Regel der Technik, die sie trägt
- Die Mängelklassen eines Pakets gelten für jede seiner Pflichtarten, solange eine Pflichtart die Auswahl nicht einengt
- Der Katalog nennt Fundstelle, Frist und Qualifikation. Er gibt keine Normtexte wieder
- Jede Pflichtart und jeder Grenzwert braucht eine fachkundige Abnahme, bevor ein Betreiber sich darauf verlässt. Bis dahin ist der Eintrag gekennzeichnet, und die Oberfläche sagt es. Wer abgenommen hat und wann, steht am Eintrag
- Jeder Eintrag trägt den Tag, an dem er zuletzt gegen seine Quelle geprüft wurde, und die Oberfläche zeigt ihn. Liegt die Prüfung länger als ein Jahr zurück, ist der Eintrag gekennzeichnet, und ein geplanter Lauf erinnert daran, wie bei den Regelpaketen von OpenGewerk
- Ein Paket erscheint, sobald seine Einträge aus staatlichem Recht stehen. Was die rechtliche Prüfung für die übrigen Quellen freigibt, kommt als neue Fassung dazu
- Eine gemergte Definition wird nicht geändert, sie bekommt eine neue Fassung. Regeln werden fortgeschrieben: ändert sich die Vorschrift, endet der alte Datensatz und ein neuer beginnt; war ein Wert falsch eingetragen, wird er berichtigt, und seine Abnahme entfällt, bis jemand vom Fach ihn erneut ansieht
- Prüfung und Abnahme stehen neben dem Eintrag und nicht in ihm, damit sie sich ändern können, ohne dass der Eintrag sich ändert (ADR 0005)
- Vorlagen, Checklisten und Texte eines Betreibers werden nicht aufgenommen, auch nicht abgewandelt. Was das Projekt mitliefert, ist neu geschrieben und steht unter der Lizenz des Projekts
- Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Er sagt, was er abdeckt, und die Verantwortung des Betreibers bleibt beim Betreiber

---

## 6. Schnittstellen

- Formate: CSV und Excel für Struktur, Anlagen und Zählerstände; DATANORM für Artikel; iCalendar als Abo je Person für Termine
- Übernahme aus einer Vorgängeranwendung oder aus Listen: Importweg mit Zuordnung der Spalten, Vorschau und Übernahme ganz oder gar nicht (Abschnitt 11)
- Gebäudeleittechnik, Datenlogger, Energiemanagement (4.15)
- CAFM-Connect (ifcXML) und IFC für die Übernahme von Raumbuch, Struktur und Anlagenliste aus anderen Systemen, COBie als Tabelle ⏳. Geometrie wird nicht übernommen
- Pflichten aus einem Regelwerksdienst, den der Betreiber selbst lizenziert hat, in seine Instanz übernehmen ⏳. Die Inhalte bleiben dort und werden nicht Teil des Projekts
- Digitales Gebäudelogbuch nach der europäischen Gebäuderichtlinie ⏳: die Angaben dafür (Energieausweis, Verbräuche, Dokumente) werden geführt, ein Export folgt, sobald es ein verbindliches Format gibt
- **Verbindung zur Handwerkersoftware** ⏳ ★: Die Fremdfirma arbeitet mit OpenGewerk, der Betreiber mit OpenGewerk Haustechnik. Der Betreiber lädt die Firma ein, wie ein Betrieb seine Kanzlei einlädt: Aufträge gehen hinüber, Prüfprotokolle und Berichte kommen als Nachweis zurück, jede Seite behält ihre Daten. Das wird ein eigener Vertrag, erst der Vertrag und dann die Implementierungen
- Offene REST-API mit Webhooks für Dritte ⏳, als eigener Vertrag
- KI optional über selbst gehostete Modelle ⏳: Typenschild lesen, Bericht einer Fremdfirma den Anlagen zuordnen, immer als Vorschlag

---

## 7. Rollen und Rechte

| Rolle | Rechte |
| --- | --- |
| Leitung | alles im Betreiber: Zugänge, Einstellungen, Änderungsprotokoll, Pflichtenübertragung; zweiter Faktor Pflicht |
| Technische Leitung | alle Bereiche: Pflichtenverzeichnis, Katalogvorschläge, Fristen, Verträge, Auswertungen |
| Objektleitung | ihre Bereiche: Rundgänge planen, Störungen annehmen, Aufträge verteilen und abnehmen, Anlagen pflegen |
| Haustechnik | ihre Bereiche: Rundgänge, Aufträge, Prüfungen ausführen, Anlagen aufnehmen, Zähler ablesen, Mängel melden |
| Melder | Störung melden, eigene Meldungen sehen |
| Fremdfirma ⏳ | zugewiesene Aufträge und Anlagen, Berichte einstellen |
| Prüfer | lesend auf Pflichten und Nachweise, befristet, protokolliert |

- Rechte sind feingranular und werden zentral vor jeder Route geprüft; die Datensichtbarkeit sichert zusätzlich die Datenbank (Mandant und Bereich)
- Zugänge entstehen über Einmal-Links; gesperrt wird die Zugehörigkeit, nicht das Konto; die letzte Leitung lässt sich nicht entmachten
- Sicherheitsrelevante Zusagen sind nicht einstellbar: die Unterschrift vor einem Nachweis, die Abnahme eines Auftrags und die Unveränderlichkeit lassen sich per Einstellung verschärfen, nie abschalten
- Eigene Rollen des Betreibers ab Phase 2. Das Fundament führt Rollen dafür von Anfang an als Daten: die mitgelieferten Rollen sind Zeilen, eigene kommen als weitere dazu. Was sich nach dem Satz darüber nicht abschalten lässt, hängt an keinem Recht, das eine eigene Rolle entziehen könnte

**Rechte je Rolle.** Die Tabelle oben sagt in Worten, wofür eine Rolle da ist. Was sie im Einzelnen darf, steht hier, für die vier Rollen aus Phase 1. Der Katalog der Rechte im Code ist dieselbe Liste, und ein Test hält beide gegeneinander. Die Bezeichnungen sind die, die ein Betreiber liest, wenn ihm ein Recht fehlt, und ab Phase 2, wenn er eigene Rollen anlegt.

| Recht | Leitung | Technische Leitung | Objektleitung | Haustechnik |
| --- | --- | --- | --- | --- |
| Liegenschaften, Gebäude und Räume ansehen | ja | ja | ja | ja |
| Liegenschaften, Gebäude und Geschosse pflegen | ja | ja | nein | nein |
| Räume aufnehmen | ja | ja | ja | ja |
| Anlagen ansehen | ja | ja | ja | ja |
| Anlagen aufnehmen | ja | ja | ja | ja |
| Anlagen pflegen | ja | ja | ja | nein |
| Zähler ablesen | ja | ja | ja | ja |
| Pflichten ansehen | ja | ja | ja | ja |
| Das Pflichtenverzeichnis führen | ja | ja | nein | nein |
| Fristen ansehen | ja | ja | nein | nein |
| Fristen bearbeiten | ja | ja | nein | nein |
| Vorgänge ansehen | ja | ja | ja | ja |
| Vorgänge ausführen | ja | ja | ja | ja |
| Vorgänge planen und verteilen | ja | ja | ja | nein |
| Aufträge abnehmen und Rundgänge gegenzeichnen | ja | ja | ja | nein |
| Nachweise ansehen | ja | ja | ja | ja |
| Nachweise eintragen, berichtigen und für ungültig erklären | ja | ja | ja | nein |
| Mängel ansehen | ja | ja | ja | ja |
| Mängel melden | ja | ja | ja | ja |
| Mängel führen | ja | ja | ja | nein |
| Daten abgleichen | ja | ja | ja | ja |
| Änderungen senden | ja | ja | ja | ja |
| Zugänge ansehen | ja | nein | nein | nein |
| Zugänge verwalten | ja | nein | nein | nein |
| Einstellungen ansehen | ja | nein | nein | nein |
| Einstellungen ändern | ja | nein | nein | nein |
| Das Änderungsprotokoll einsehen | ja | nein | nein | nein |

- Jede Rolle darf, was die Rolle rechts von ihr darf, und der Bereich begrenzt, wo: ein Recht gilt in den Bereichen der Person (2.8)
- **Aufnehmen und pflegen.** Aufnehmen heißt anlegen und die Angaben ergänzen und berichtigen, wie es die Bestandsaufnahme vor Ort braucht (2.7, 4.2). Pflegen ist, was Folgen über den Datensatz hinaus hat: der Lebenszyklus einer Anlage, weil ihre Pflichten ruhen, sobald sie außer Betrieb ist, der Tausch, das Verlegen an einen anderen Ort und das Entfernen. Einen Raum verlegt oder entfernt, wer Liegenschaften, Gebäude und Geschosse pflegt
- **Ausführen, planen, abnehmen.** Vorgänge sind Rundgänge, Prüfungen, Wartungen und Aufträge (2.2). Ausführen ist die Arbeit daran bis zur Unterschrift. Planen und verteilen ist, was davor geschieht: einen Rundgang planen, einen Auftrag anlegen und zuteilen, einen offenen Rundgang mit Grund schließen. Abnehmen und gegenzeichnen ist die zweite Unterschrift (4.5, 4.8)
- **Melden und führen.** Melden heißt einen Mangel festhalten, mit Bemerkung und Foto. Führen ist sein weiterer Weg: Klasse, Frist und Status (4.6)
- **Abgleichen und senden** ist der Weg eines Geräts zum Server, mit Netz und ohne (2.7): was sich geändert hat, auf das Gerät holen, und was es ohne Netz festgehalten hat, schicken. Das ist kein eigenes Tun, sondern ein anderer Weg hinein; was ein Vorgang anfasst, entscheiden die Rechte darüber, und deshalb haben alle Rollen beide
- **Nachweise eintragen** meint den Bericht einer Fremdfirma oder Prüforganisation (4.4). Der Nachweis aus einem eigenen Protokoll oder einem Rundgang entsteht mit der Unterschrift dessen, der ausführt, und braucht kein weiteres Recht
- Kein Recht hebt eine der Zusagen auf, die sich nicht abschalten lassen: es gibt keines, das einen Nachweis ändert oder löscht, eine Unterschrift ersetzt oder die Abnahme eines Auftrags überspringt. Ob eine Rolle einen Betreiber führt und ob sie den zweiten Faktor verlangt, sind Angaben der Rolle und keine Rechte
- Was die Tabelle oben nennt und hier noch fehlt, kommt mit seiner Phase: Störungen annehmen, Verträge, Auswertungen über die Zeit und die Pflichtenübertragung in Phase 2. Rechte für Aufgaben, Dokumente, Benachrichtigungen und die Vorlagen der Rundgänge kommen mit diesen Bausteinen in Phase 1, und wer sie bekommt, ist entschieden: Dokumente sehen und ablegen alle vier Rollen, entfernen ab der Objektleitung; Aufgaben legt jede Rolle an, einer anderen Person teilt sie zu, wer Vorgänge plant und verteilt; die Vorlagen der Rundgänge führen Leitung, Technische Leitung und Objektleitung. Jedes neue Recht steht dann auch in dieser Tabelle

---

## 8. Rechtliche Anforderungen im Überblick ⚖

Die Tabelle nennt, woran sich der Funktionsumfang ausrichtet. Die Fundstellen sind am 01.10.2026 gegen die amtlichen Texte geprüft; wo ein Gesetzgebungsverfahren läuft, steht es dabei. Fristen und Grenzwerte selbst stehen in den Paketen, mit Gültigkeitszeitraum und Fundstelle. Welche Pflicht für eine konkrete Anlage gilt, entscheidet der Betreiber. Die Tabelle ist keine Rechtsberatung.

| Thema | Anforderung | Umsetzung im System |
| --- | --- | --- |
| Organisation des Arbeitsschutzes | Beurteilung der Arbeitsbedingungen und ihre Dokumentation (§§ 5, 6 ArbSchG); schriftliche Beauftragung zuverlässiger und fachkundiger Personen mit Verantwortungsbereich und Befugnissen, von der beauftragten Person unterzeichnet (§ 13 Abs. 2 ArbSchG, § 13 DGUV Vorschrift 1) | Pflichtenübertragung mit Unterschrift und Ausfertigung für die beauftragte Person, Gefährdungsbeurteilung als Dokument mit Frist |
| Arbeitsmittel | Art, Umfang und Fristen der Prüfungen ermittelt der Arbeitgeber und dokumentiert sie (§ 3 Abs. 6 und 8 BetrSichV); Prüfung durch zur Prüfung befähigte Personen (§ 2 Abs. 6, § 14); Aufzeichnung mit Art, Umfang, Ergebnis, Name und Unterschrift, aufzubewahren mindestens bis zur nächsten Prüfung, auch elektronisch (§ 14 Abs. 7) | Pflicht mit festgelegter Frist und Begründung, Qualifikation, Nachweis mit Unterschrift, Aufbewahrung als Regel |
| Überwachungsbedürftige Anlagen | Prüfung vor Inbetriebnahme und wiederkehrend, in der Regel durch zugelassene Überwachungsstellen, mit Höchstfristen (§§ 15, 16 und Anhang 2 BetrSichV; ÜAnlG); Aufzeichnungen und Prüfbescheinigungen während der gesamten Verwendungsdauer aufbewahren (§ 17 Abs. 1) | Pflichtarten mit Höchstfrist und Qualifikation, Bescheinigung als Nachweis, Aufbewahrung bis zum Rückbau der Anlage |
| Elektrische Anlagen und Betriebsmittel | Prüfung vor der ersten Inbetriebnahme und in bestimmten Zeitabständen (§ 5 DGUV Vorschrift 3 und Vorschrift 4); die Fristen der Durchführungsanweisungen sind Richtwerte und in beiden Vorschriften verschieden; beide werden überarbeitet | Pflichtarten mit Richtwert je Vorschrift, Prüfprotokoll über die Formular-Engine |
| Arbeitsstätten | Sicherheitseinrichtungen instand halten und in regelmäßigen Abständen auf ihre Funktionsfähigkeit prüfen lassen: Sicherheitsbeleuchtung, Brandmelde- und Feuerlöscheinrichtungen, Signalanlagen, Notaggregate, Notschalter, raumlufttechnische Anlagen (§ 4 Abs. 3 ArbStättV, Technische Regeln für Arbeitsstätten) | Pflichtarten für diese Einrichtungen und für kraftbetätigte Türen und Tore |
| Trinkwasser | Untersuchung auf Legionellen in Anlagen nach § 31 Abs. 1 TrinkwV, jährlich oder alle drei Jahre je nach Art der Abgabe; technischer Maßnahmenwert; bei dessen Erreichen Ursachenklärung, Risikoabschätzung und Maßnahmen (§ 51); Niederschriften und Dokumentation zehn Jahre aufbewahren (§ 44 Abs. 3, § 51) | Probenahme als Pflichtart mit Geltungsbereich, Maßnahmenwert als Regel, Risikoabschätzung als Dokument, Temperaturen als Messwerte mit Grenzwert |
| Gebäudeenergie | Wartung und Instandhaltung, Betriebsprüfung von Wärmepumpen, Heizungsprüfung, Inspektion von Klimaanlagen (§§ 60 bis 60c und 74 bis 76 des Gebäudemodernisierungsgesetzes, bis Juli 2026 Gebäudeenergiegesetz); zum 01.01.2027 ändern sich Fristen und Geltungsbereich | Pflichtarten mit Geltungsbereich nach Leistung; beide Fassungen als Regeln mit Gültigkeitszeitraum |
| Energieeffizienz | Energie- oder Umweltmanagementsystem und Umsetzungspläne ab bestimmten Verbräuchen, eigene Pflichten für öffentliche Stellen (§§ 6, 8, 9 EnEfG; eine Novelle ist im Verfahren) | Zählerstände und Verbrauch als Datengrundlage |
| Kälteanlagen | Dichtheitskontrollen nach Füllmenge und Aufzeichnungen, fünf Jahre aufzubewahren (Art. 5 und 7 der Verordnung (EU) 2024/573; Chemikalien-Klimaschutzverordnung von 2026) | Pflichtart mit Geltungsbereich nach Füllmenge, Nachweis mit Aufbewahrung |
| Verdunstungskühlanlagen | Betriebstagebuch, Laboruntersuchungen, Überprüfung alle fünf Jahre durch Sachverständige (§§ 4, 12, 14 der 42. BImSchV) | Pflichtarten, Probenahme, Betriebstagebuch aus den Nachweisen |
| Bauordnungsrecht | Prüfung technischer Anlagen in Sonderbauten nach dem Recht des Landes, in eigenen Prüfverordnungen oder in den Sonderbauverordnungen; in der Regel alle drei Jahre, mit Abweichungen je Land und Anlagenart | Regelpakete je Land, Geltungsbereich nach Land, Gebäudeart und Anlagenart |
| Arbeitszeit | Höchstarbeitszeit, Pausen, Ruhezeit, Aufzeichnung (§§ 3 bis 5 und 16 ArbZG, § 17 MiLoG); Pflicht zur Erfassung von Beginn und Ende nach dem Beschluss des Bundesarbeitsgerichts vom 13.09.2022 (1 ABR 22/21); eine gesetzliche Neuregelung gibt es nicht | Abschaltbares Modul, Warnungen aus dem Regelpaket, unveränderliche Aufzeichnung |
| Mitbestimmung | Technische Einrichtungen, die geeignet sind, Verhalten oder Leistung zu überwachen; auf die Absicht kommt es nicht an (§ 87 Abs. 1 Nr. 6 BetrVG, § 80 Abs. 1 Nr. 21 BPersVG und die Entsprechungen im Landes- und kirchlichen Recht) | Keine Auswertung je Person, erzeugte Verfahrensbeschreibung, Arbeitszeit ausgeschaltet ausgeliefert |
| Datenschutz | Rechtmäßigkeit, Information, Auskunft, Berichtigung, Löschung, Auftragsverarbeitung, Verzeichnis, Sicherheit, Folgenabschätzung (DSGVO, BDSG); die Liste der Aufsichtsbehörden nennt die Ortung von Beschäftigten als Beispiel für eine Verarbeitung, die eine Folgenabschätzung verlangen kann | Löschkonzept, Auskunft, erzeugtes Verzeichnis, Vertragsvorlage, Standort nur mit Einwilligung |
| Barrierefreiheit | Für öffentliche Stellen auch bei Anwendungen für die eigenen Beschäftigten: im Bund § 12a BGG mit der BITV 2.0, in den Ländern nach Landesrecht | Bausteine nach den Anforderungen der EN 301 549, Prüfung in der CI |
| Informationssicherheit beim Betreiber | Betreiber, die unter das BSI-Gesetz von 2025 fallen, etwa Krankenhäuser ab den Größenschwellen, betreiben Risikomanagement für ihre Informationstechnik und verlangen Auskunft von ihrer Software | Zweiter Faktor, Protokollierung, Beschreibung der technischen und organisatorischen Maßnahmen als erzeugtes Dokument |
| Software als Produkt | Cyber Resilience Act (Verordnung (EU) 2024/2847, anwendbar ab 11.12.2027, Meldepflichten seit 11.09.2026) und Produkthaftungsrichtlinie (EU) 2024/2853: freie Software außerhalb einer Geschäftstätigkeit ist ausgenommen; wer sie gegen Entgelt bereitstellt oder betreut, prüft seine eigenen Pflichten | Meldeweg für Schwachstellen nach der `SECURITY.md` der Organisation, signierte Abbilder, Sicherheitskorrekturen als eigene Fassung |

---

## 9. Sicherheit, Datenschutz und Mitbestimmung ⚖

**Sicherheit**

- Aus dem Fundament: zweiter Faktor, Passkeys, Sitzungen je Gerät mit Widerruf, Ratenbegrenzung, Guard vor jeder Route, Schutz in der Datenbank, Content-Security-Policy, versiegelte Zugangsdaten, signierte Abbilder
- Befunde werden Issues, Sicherheitslücken private Advisories, wie in der `SECURITY.md` der Organisation
- Externe Sicherheitsprüfung vor dem ersten Release mit einer Seite ohne Anmeldung (Störmeldung über das Etikett) oder einem Zugang für Fremdfirmen
- Jede Zusage in den Unterlagen hat einen Test, der sie hält. Eine Zusage ohne Test ist eine Absicht

**Datenschutz**

- Personenbezogene Daten: Konten und Rollen, Zuteilungen, Unterschriften, Qualifikationen, Schlüsselausgaben, auf Wunsch Arbeitszeiten; von Dritten die Kontaktangabe eines Melders, der Name eines Prüfers, die Unterschrift eines Auftraggebers
- Der Betreiber ist Verantwortlicher. Wer die Instanz für ihn betreibt, ist Auftragsverarbeiter und braucht einen Vertrag; die Vorlage dafür liegt auf opengewerk.de
- Verzeichnis der Verarbeitungstätigkeiten und Beschreibung der technischen und organisatorischen Maßnahmen werden aus der Anwendung erzeugt
- Ein Nachweis nennt, wer unterschrieben hat, solange er aufbewahrt wird: das ist sein Zweck. Mit dem Ende der Aufbewahrung wird er gelöscht, und der Name mit ihm
- Verlässt jemand den Betreiber, endet der Zugang am letzten Tag, und nach einer einstellbaren Frist werden die Angaben des Kontos entfernt, die kein Nachweis mehr braucht. Beides läuft über die Fristen-Engine und hängt an keinem Handgriff
- Im Änderungsprotokoll wird ein personenbezogener Wert geschwärzt, die Hashkette bleibt ganz
- Zeitpunkte einzelner Eingaben braucht der Abgleich. Sie werden nicht angezeigt und nicht ausgewertet; ein Nachweis nennt den Zeitpunkt der Unterschrift
- Die Seite für Störmeldungen ohne Konto informiert über die Verarbeitung, erhebt den Kontakt nur freiwillig und löscht ihn nach der Erledigung
- Standort nur mit Einwilligung, keine Auswertung von Bewegungen

**Mitbestimmung**

- Die Software ist geeignet, Verhalten und Leistung zu überwachen, weil sie festhält, wer was wann unterschrieben hat. Ihre Einführung ist deshalb mitbestimmungspflichtig, wo es eine Arbeitnehmervertretung gibt, und sie ist so gebaut, dass eine Vereinbarung darüber leicht fällt:
  - keine Auswertung je Person als Vorgabe, keine Ranglisten, keine Verzugsstatistik je Mitarbeiter
  - Einsicht in das Änderungsprotokoll nur für die Leitung
  - Arbeitszeit und Standort nur nach bewusstem Einschalten
- **Verfahrensbeschreibung** als erzeugtes Dokument ★: welche personenbezogenen Daten in welchem Modul stehen, wer sie sieht, welche Auswertungen es gibt und welche nicht, wie lange sie aufbewahrt werden. Erzeugt aus dem, was eingeschaltet und eingestellt ist, damit sie stimmt. Bis die Anwendung sie erzeugt, gibt es sie für den Stand von Phase 1 von Hand geschrieben, damit eine Arbeitnehmervertretung sie vor dem Parallelbetrieb in der Hand hat
- Vorlage für eine Betriebs- oder Dienstvereinbarung auf opengewerk.de

---

## 10. Plattform und Betrieb

- Webanwendung als PWA: Einstieg `/` für das Büro (Maus und Tastatur, datenintensiv), Einstieg `/m` für die Arbeit vor Ort (Telefon und Tablet, eine Hand, ohne Netz)
- Kamera, Scan von QR- und Strichcodes und Unterschrift über den Browser
- Self-hosted: Docker-Compose-Referenzinstallation, ein Befehl zum Starten und Aktualisieren, PostgreSQL, Renderer als eigener Dienst, nächtliche Sicherung mit sichtbarem Zeitpunkt, Rückspielen und Prüfung der Sicherung
- Releases mit Versionsnummer und signierten Abbildern; ein Update migriert zuerst und tauscht dann
- Läuft neben OpenGewerk auf demselben Server, mit eigenem Hostnamen, eigenem Port, eigenem PostgreSQL-Container und eigenem Namen des Compose-Projekts. Zwei Anwendungen unter demselben Hostnamen teilten sich die Sitzungs-Cookies, zwei unter demselben Projektnamen die Volumes
- Zielgröße: ein kleiner Server mit 2 GB Arbeitsspeicher für die Anwendung neben der Datenbank trägt einen Betreiber mit einigen tausend Anlagen
- Hilfe: kontextsensitiv an jedem Bildschirm, Kurzanleitungen zu den Kernabläufen, Handbuch für die Verwaltung der Instanz

---

## 11. Ablösung einer Vorgängeranwendung

Der Pilotbetrieb arbeitet heute mit einer Vorgängeranwendung des Maintainers und mit Excel-Listen. Der Weg von dort ist derselbe, den jeder Betreiber mit Listen oder einem Altsystem geht, und er ist Teil des Produkts.

- **Struktur und Anlagen**: Import aus Tabellen mit Zuordnung der Spalten, Vorschau, Dubletten-Prüfung, Übernahme ganz oder gar nicht; ein Import ist ein Eintrag im Änderungsprotokoll
- **Anlagenarten zuordnen**: eine Tabelle von alten Bezeichnungen auf Anlagenarten des Katalogs, einmal gepflegt, danach schlägt das System die Pflichten vor
- **Laufende Fristen**: letzter Nachweis und nächste Fälligkeit je Anlage werden übernommen, damit keine Frist beim Wechsel neu zu laufen beginnt. Je Pflicht entsteht dafür ein Nachweis mit der Herkunft „Altbestand“: mit dem Tag der letzten Durchführung, dem ursprünglichen PDF und dem Vermerk, dass er nicht in dieser Anwendung unterschrieben wurde. Er zählt für die Frist wie jeder Nachweis und sieht nie aus wie ein unterschriebener
- **Alte Nachweise** darüber hinaus: werden als Dokumente mit ihrem ursprünglichen PDF übernommen und als Altbestand gekennzeichnet. Sie werden nicht neu unterschrieben und nicht umgeschrieben
- **Zähler**: Messstellen und Stände mit Tauschen und Stilllegungen
- **Vorlagen der Rundgänge**: die eigenen Vorlagen des Betreibers werden als Formulare in seine Instanz übernommen, die Punkte nachträglich Anlagen zugeordnet. Sie gehören ihm und bleiben dort; in die Pakete des Projekts wandert keine davon (Abschnitt 5)
- **Was die Vorgängeranwendung nicht belegen kann**, wird nicht nachträglich geheilt: ein Nachweis ohne prüfbare Unterschrift kommt als Altbestand mit genau diesem Vermerk
- **Offene Aufträge** werden nicht übernommen: sie werden im Parallelbetrieb in der Vorgängeranwendung zu Ende geführt, und was am Stichtag noch offen ist, wird hier neu angelegt
- **Zugänge**: Einladung jedes Kontos, niemand bekommt ein übernommenes Passwort
- **Parallelbetrieb**: mindestens ein voller Monat mit allen Rundgängen in beiden Systemen, danach Umstellung an einem Stichtag. Die Vorgängeranwendung bleibt lesend erreichbar, bis ihre Aufbewahrungsfristen abgelaufen oder ihre Nachweise übernommen sind

---

## 12. Fahrplan

Leitgedanke wie bei OpenGewerk: **So früh wie möglich einen echten Betrieb damit führen.** Pilotbetrieb ist die Haustechnik eines Trägers mit rund zwanzig Liegenschaften. Version 1 ist erreicht, wenn dort die Vorgängeranwendung abgeschaltet werden kann. Was sich nicht nachrüsten lässt (Datenmodell, Bereiche, Festschreibung der Nachweise, Abgleich ohne Netz), gehört ins Fundament, auch wenn die Oberfläche dafür später kommt.

| Phase | Inhalt | Ergebnis |
| --- | --- | --- |
| 0: Fundament | Einrichtung des Repositorys, das Fundament als Pakete im Repository `opengewerk` und seine Einbindung nach ADR 0010, Ausgangsmigration, Datenmodell-Kern (Ort, Anlage, Pflicht, Vorgang, Nachweis, Mangel), Bereiche, Rechte und Rollen als Daten, Abgleichregeln, Paketformat mit Geltungsbereich, eigenes Abbild und eigene Vorschau, Tafeln der Oberfläche für Phase 1 | Gerüst, auf dem Phase 1 ohne Umbau aufsetzt |
| 1: MVP Pilotbetrieb | Liegenschaft bis Raum mit Import, Anlagen mit Anlagenarten und Akte, Etiketten, Bestandsaufnahme vor Ort, Pflichtenverzeichnis mit Vorschlägen und Übersicht, Nachweis aus Protokoll oder Bericht, Rundgänge mobil und ohne Netz, Mängel, Arbeitsaufträge, Zähler mit Ablesung, Dokumente, Benachrichtigungen, die Pakete Elektro, Brandschutz, Trinkwasser und Landesrecht, Importweg aus der Vorgängeranwendung | Pilotbetrieb arbeitet produktiv damit, Parallelbetrieb beginnt |
| 2: Betreiberpflichten vollständig | Pflichtenübertragung, Qualifikationen, weitere Protokolle und Pakete, Sammelnachweise, Nachweisverzeichnis, Prüfer-Zugang, Störmeldungen mit und ohne Konto, Fremdfirmen und Verträge, Leistungsnachweis, Lager mit Verbrauch am Auftrag, Auswertungen über die Zeit, eigene Rollen, Dokumente mit Gültigkeit, DSGVO-Funktionen, Verfahrensbeschreibung | Vorgängeranwendung abgeschaltet; ein Betreiber kann eine Begehung allein aus dem System bestreiten |
| 3: Schlüssel, Energie, Planung | DATANORM und Fahrzeuglager, Schlüsselverwaltung, Energieauswertung mit Flächenbezug, Einsatzplanung, Kalender-Abo, Kostensicht | Tagesgeschäft ohne Listen daneben |
| 4: Anbindungen | Gebäudeleittechnik lesend, Messwerte und Zählerstände aus Dateien und Loggern, Ausgabe an ein Energiemanagementsystem, Übernahme aus CAFM-Connect, IFC und COBie, Übernahme aus einem Regelwerksdienst, Zugang für Fremdfirmen | Daten fließen, ohne dass jemand sie abtippt |
| 5: Personal und Arbeitsschutz | Unterweisungen, Rufbereitschaft, Arbeitszeit als Modul, Gefährdungsbeurteilung, Ressourcen | Arbeitsschutz-Organisation im selben System |
| 6: Verbund und Erweiterung | Verbindung zur Handwerkersoftware, offene API, weitere Länder und Sonderbauten, Volltextsuche, lokale KI | Vollausbau |

**Zuordnung im Einzelnen.** Die Tabelle nennt die Schwerpunkte. Die übrigen Punkte der Abschnitte 2 bis 10 gehören so zu den Phasen; beides zusammen ist der Fahrplan, und aus beidem werden die Issues einer Phase geschnitten. Was in keiner Phase steht, steht in Abschnitt 14. Wer in 2 bis 10 einen Punkt einträgt, trägt seine Phase im selben Zug hier ein.

- **Phase 0:** die Pakete und Nähte im Repository `opengewerk`, die Phase 1 braucht: Abgleichregeln, Rechte, Rollen als Daten, Bezeichnungen im Änderungsprotokoll, Schlüssel der Nummernkreise, Quellen der Fristen-Engine, Anlässe der Benachrichtigungen, Formulare ohne Stromkreis (2.1); die Regel-Engine mit Geltungsbereich und den neuen Einheiten (2.9); die Nummernkreise für Anlagen, Nachweise und Aufträge (2.2, 2.6, 4.8); die Fassungen des eingefrorenen Nachweises und die Trigger darunter (2.6); der Lebenszyklus als Zeitraum (2.2); die Auswahl je Gerät nach Bereich (2.7, 2.8); die Herkunft einer Pflichtart, der Tag ihrer letzten Prüfung und ihre Abnahme im Paketformat (5)
- **Phase 1:** Lagebild je Gebäude, Übersicht über alle Liegenschaften, Raumseite, Zeitachse und Pfadnavigation (4.1); Dubletten-Prüfung und Tausch einer Anlage (4.2); eigene Pflichten und die festgelegte Frist mit Begründung (4.3); eigene und fremde Durchführung mit Ergebnis (4.4); Vorlage, Plan, ein eigener Rundgang je Durchgang, Zuteilung, Punkt erfüllt Pflicht, Abgabe nur vollständig, Gegenzeichnung, PDF und Übersicht der Rundgänge (4.5); Mängel mit Klasse, Frist und Status, die Mängelklassen im Paketformat (4.4, 4.6, 5); Aufträge aus Mangel und Termin mit Abnahme (4.8); Zählertausch, Stilllegung, Sperre und Notiz (4.9); Ablage mit Fassungen (4.10); Suche nach Name, Nummer und Kennzeichen, Aufgaben, Änderungsprotokoll, eigene Angaben unter „Konto“, Rechtstexte der Instanz, Bereich der Instanz und Passkeys, soweit das Fundament sie mitbringt (3); Barrierefreiheit der Bausteine (3) ⚖; Vertretung (2.8); die Rollen Leitung, Technische Leitung, Objektleitung und Haustechnik (7); das Paket Allgemein mit einer allgemeinen Anlagenart je Kostengruppe (4.2, 5); die Pakete Elektro, Brandschutz und Trinkwasser vollständig und das Landesrecht von Baden-Württemberg, dazu der Lauf, der an die Prüfung der Katalogeinträge erinnert (5) ⚖; Hilfe an den Bildschirmen (10); die Seiten vor Ort für Liegenschaft, Gebäude und Geschoss, Ansprechpartner und Fotos an der Liegenschaft (4.1); der Konflikt bei einer möglichen Dublette (2.7, 4.2); der Verweis auf das Dokument, das eine Frist trägt (4.3); die Zählweise ab dem fälligen Tag mit ihrem Fenster (4.4); Wochentage, Feiertage und Schließzeiten im Plan eines Rundgangs, die Feiertage zuerst für Baden-Württemberg (2.9, 4.1, 4.5); die Dringlichkeit in drei Stufen und weitere Beteiligte (4.8); Stichtag, Berichtigung eines Stands und der Verlauf über 12 und 24 Monate mit dem Vergleich zum Vorjahr, schlicht (4.9); die Ausgabe jeder Liste im Büro als Tabelle und die Anlässe der Benachrichtigungen (3); die Meldung einer neuen Fassung eines Pakets an bestätigte Pflichten (2.3); der Weg ohne Schriftzug bei der Unterschrift (2.6); im Paket Elektro die Formulare, die ohne Stromkreis auskommen, im Landesrecht die Pflichtarten für die Anlagenarten der Pakete aus Phase 1 (5); die Vorlage für den Vertrag zur Auftragsverarbeitung und die von Hand geschriebene Verfahrensbeschreibung (9, 15) ⚖
- **Phase 2:** Sammelvorgänge und die Unterscheidung nach DIN 31051 (4.4); außer Betrieb durch Mangel und Mängelbericht (4.6); Eingang, Zusammenführen, Rückmeldung und Zeiten der Störmeldungen (4.7); Gewährleistung, Einweisung und Erlaubnisschein (4.11); Soll-Dokumente (4.10); Lager, Mindestbestand und Entnahme am Auftrag (4.12); Auswertungen über die Zeit, ohne Auswertung je Person (4.16) ⚖; eigene Rollen (7); die Elektro-Struktur mit Stromkreisverzeichnis (4.2); eigene Anlagenarten des Betreibers und eigene Felder an Anlagenarten (2.5, 4.2); das Ende einer Zugehörigkeit als Frist (2.4, 9) ⚖; die Rollen Melder und Prüfer (7); die Aufbewahrung der Nachweise mit Löschvorschlag und das höher signierte PDF am Nachweis (2.6) ⚖; die Pakete Raumluft und Kälte, Heizung, Förderanlagen und Arbeitsmittel (5) ⚖; Gefährdungsbeurteilung als Dokument mit Frist (4.3); die externe Sicherheitsprüfung vor dem Release mit der Seite ohne Anmeldung (9); die Wiederholung eines Punkts über alle Anlagen einer Art (4.5); der Datenexport eines Rundgangs und der Export für Auswertungen (4.5, 4.16); Unterlagen für unterwegs (2.7); die Messwerte je Stromkreis im Paket Elektro und die Pflichtarten des Landesrechts für die Anlagenarten der Pakete aus Phase 2 (5); die Vorlage für eine Betriebs- oder Dienstvereinbarung (9); was die Auswertungen über die Zeit am Verlauf der Zähler zusätzlich brauchen (4.9)
- **Phase 3:** DATANORM und Fahrzeuglager (4.12); Zugänge versiegelt und Schlüsselquittung (4.13); Ausreißer und Verbrauch je Quadratmeter, Flächen an Gebäuden und Räumen (4.1, 4.9); was die Energieauswertung am Verlauf der Zähler zusätzlich braucht (4.9)
- **Phase 4:** Meldungen der Leittechnik im Eingang der Störmeldungen (4.7, 4.15); der Adapter des Pilotbetriebs und die Freigabe von Adressen im eigenen Netz (4.15); die Rolle Fremdfirma (7)
- **Phase 5:** die Hinweise zur Mitbestimmung beim Einschalten der Arbeitszeit (4.14) ⚖
- **Phase 6:** Angaben und Export für das digitale Gebäudelogbuch (6); Volltextsuche und Texterkennung (3, 4.10); lesender Zugang für eigene Auswertungen (4.16); KI als Vorschlag (6)

---

## 13. Schwächen der Vergleichssysteme und unser Ansatz

Stand der Recherche: 01.10.2026. Geprüft wurden die Datenblätter von zwölf Systemen aus der Marktübersicht CAFM-Software 2026, zwölf quelloffene Systeme an ihren Repositorys und Lizenzdateien, zehn mobile Checklisten- und Wartungswerkzeuge an ihren Preisseiten und die öffentlichen Vergaben seit 2024. Angaben zu kommerziellen Systemen sind Herstellerangaben.

**Was die Recherche belegt**

| Schwäche in Vergleichssystemen | Unser Ansatz |
| --- | --- |
| Kein quelloffenes System bringt einen deutschen Pflichtenkatalog mit; Fristen sind dort freie Intervalle ohne Herkunft | Pflichtenkatalog als offene Daten mit Fundstelle, Gültigkeit und Geltungsbereich, im Kern |
| Bei den kommerziellen Systemen ist das Regelwerk eine zweite Lizenz bei einem Dritten: keines der zwölf geprüften hat einen eigenen Katalog, alle verweisen auf einen Regelwerksdienst | Der Katalog gehört zum Projekt; wer einen Regelwerksdienst schon lizenziert hat, übernimmt dessen Inhalte in seine Instanz ⏳ |
| Quelloffene Systeme ziehen die Bezahlgrenze bei der Arbeit vor Ort: App, Arbeit ohne Netz, Checklisten, Zähler oder Wartungsplanung nur in der bezahlten Fassung, in einem Fall mit Grenzen von 5 Nutzern und 50 Anlagen ohne Lizenzschlüssel | Alles in einem Repository unter AGPL-3.0, ohne Lizenzschlüssel und ohne Mengengrenze |
| Die mobile Lösung ist bei der Hälfte der geprüften kommerziellen Systeme ein eigener Kostenposten, obwohl mobiles Arbeiten 2021 und 2023 der wichtigste Trend aus Sicht der Anwender war | Eine PWA, vollständig ohne Netz, Teil des Kerns |
| Lizenz je Arbeitsplatz, Nutzer oder Fläche, keine Listenpreise; die veröffentlichten Zuschläge seit 2024 reichen von rund 133.000 Euro bis über 4 Millionen Euro | Keine Lizenzkosten, keine Nutzerlimits, self-hosted auf einem kleinen Server |
| Die Bestandserfassung ist ein eigenes Projekt und bleibt oft unvollständig; eine öffentliche Vergabe von 2026 nennt allein dafür rund 333.000 Euro | Bestandsaufnahme vor Ort mit dem Telefon, im Zuge der Rundgänge, dazu der Import mit Vorschau |
| Ein Erfahrungsbericht aus einem Landkreis zeigt die Stände von rund 1.200 Zählern, die auch nach der Einführung eines CAFM über Papierlisten und Handeingabe kamen | Ablesung auf dem Telefon als Punkt eines Rundgangs, mit Prüfung gegen den letzten Stand |
| Mobile Checklisten-Werkzeuge kennen Formulare, aber keine Liegenschaft, keine Anlagenakte und keine Pflicht; fast alle laufen nur in der Cloud und kosten je Nutzer | Der Rundgang hängt am selben Datenmodell wie Anlage, Pflicht und Nachweis |
| Am offenen Austauschformat CAFM-Connect wird seit 2021 nicht mehr sichtbar gearbeitet | Import und Export in dokumentierten, offenen Formaten; CAFM-Connect als Importweg |

**Was Betreiber mit Listen und einfachen Werkzeugen kennen**

| Schwäche | Unser Ansatz |
| --- | --- |
| „Kein Termin hinterlegt“ ist ein leeres Feld | „Nie erfasst“ ist ein eigener Zustand und steht vor „überfällig“ |
| Ein Punkt einer Checkliste hat keinen Bezug zur Anlage, ein Mangel endet im PDF | Punkte zeigen auf Anlagen, ein „nicht in Ordnung“ wird ein Mangel mit Frist |
| Ein Nachweis lässt sich nachträglich ändern | Eingefroren, an die Unterschrift gebunden, in der Datenbank geschützt |
| Dieselbe Angabe steht an mehreren Stellen und läuft auseinander | Eine Stelle je Frage, der Zustand wird abgeleitet |
| Auswertungen je Mitarbeiter entstehen nebenbei | Keine Auswertung je Person, Unterlagen für die Arbeitnehmervertretung |

**Wo die etablierten Systeme weiter sind und bleiben**

- CAD, BIM und Grafik: eigene CAD-Module, Kopplung an Planungssoftware, Darstellung in 2D und 3D
- Flächen-, Umzugs-, Belegungs-, Reinigungs- und Vermietungsmanagement samt Betriebskostenabrechnung
- Anbindung an ERP-Systeme und an die Finanzverfahren der öffentlichen Hand
- Redaktionell gepflegtes Regelwerkswissen: ein Regelwerksdienst mit Juristen und über 2.000 ausgewerteten Regelwerken ändert nach eigener Angabe ein Fünftel bis ein Viertel seiner Inhalte im Jahr. Ein offener Katalog deckt weniger ab und sagt es (Abschnitt 5)
- Zertifizierung nach GEFMA 444, die Ausschreibungen häufig verlangen, zertifizierte Rechenzentren, Schulungs- und Supportorganisation

Wer eine Ausschreibung mit diesen Anforderungen bestehen muss, ist dort besser aufgehoben.

---

## 14. Bewusst ausgeklammert / später

- **Flächenmanagement mit CAD, BIM-Modelle, Grundrisse mit anklickbaren Räumen**: ohne Planbestand nicht befüllbar; Flächen als Zahl am Raum genügen für Kennwerte
- **Miet- und Immobilienverwaltung, Nebenkostenabrechnung**: kaufmännisches Gebäudemanagement, andere Software
- **Reinigungs-, Umzugs- und Cateringmanagement**: infrastrukturelles Gebäudemanagement
- **Belege, Rechnungen, Buchhaltung**: dafür gibt es OpenGewerk
- **Steuerung von Anlagen**: die Leittechnik wird gelesen, nicht bedient
- **Medizintechnik**: eigenes Regelwerk mit eigenem Bestandsverzeichnis und eigenen Kontrollen, in Kliniken meist eine eigene Abteilung; als Paket denkbar, wenn jemand vom Fach es trägt
- **Frei einstellbare Abläufe**: Aufträge und Rundgänge haben feste Zustände. Ein Ablauf, den jeder Betreiber umbaut, lässt sich nicht absichern
- **Mehrsprachigkeit**: Deutsch zuerst. Der Pilotbetrieb braucht keine weitere Sprache, und eine zweite beträfe das ganze Fundament
- **Native Apps**: erst, wenn Push oder Hardwarezugriff es verlangen
- **Zertifizierung nach GEFMA 444**: die Kriterien sind Orientierung, eine Zertifizierung ist kein Ziel der ersten Fassungen. Das schließt Ausschreibungen aus, die das Zertifikat verlangen

---

## 15. Entscheidungen

Die offenen Fragen aus v0.1 sind am 01.10.2026 entschieden worden, die Phasen der eigenen Anlagenarten und der Mängelklassen am 03.10.2026, und am 04.10.2026 kam dazu, was vor dem Bau von Phase 1 zu klären war. Jede Antwort steht an ihrer Stelle im Konzept; diese Tabelle nennt sie einmal im Zusammenhang.

| Frage | Entscheidung | Steht in |
| --- | --- | --- |
| Wie das Fundament bezogen wird | Als Pakete im Repository `opengewerk`, eingebunden als Git-Submodul auf einem festen Commit, ohne Abschrift | 0, 2.1, ADR 0010 dort, ADR 0001 hier |
| Zuständigkeitsbereiche | In der Datenbank erzwungen, als Policy je Zeile | 2.8 |
| Name des Mandanten in der Oberfläche | Betreiber | durchgehend |
| Störmeldung ohne Konto | Ja, in Phase 2, mit externer Sicherheitsprüfung davor | 4.7, 9, 12 |
| Arbeitszeit | Abschaltbares Modul in Phase 5 | 4.14 |
| Namen und Uhrzeiten auf dem Leistungsnachweis | Als Vorgabe aus | 4.8 |
| Sprachen | Deutsch, keine weitere | 14 |
| Gebäudeleittechnik | Phase 4 | 4.15, 12 |
| Eigene Rollen | Ab Phase 2; das Fundament führt Rollen von Anfang an als Daten | 7, 12 |
| Umfang des Katalogs | Alle sieben Pakete vollständig vor Version 1 | 5, 12 |
| Fachkundige Abnahme | Durch den Maintainer für Elektro, durch den Pilotbetrieb für die übrigen Pakete; bis dahin ist jeder Eintrag gekennzeichnet | 5 |
| Erstes Land | Baden-Württemberg | 5 |
| Veröffentlichung der Pakete | Staatliches Recht sofort, die rechtliche Prüfung läuft parallel | 5 |
| Was der Pilotbetrieb braucht | Rundgänge, Aufträge, Leistungsnachweis, Zähler, Anlagen, Wartungen, Lager, Verträge und Auswertungen; kein Ausdruck muss aussehen wie bisher | 12 |
| Der Pilotbetrieb im Repository | Bleibt ungenannt, bis er zustimmt | 11, 12 |
| Eigene Anlagenarten | In Phase 2, mit den eigenen Feldern; bis dahin findet jede Anlage eine allgemeine Anlagenart im Paket Allgemein, das in Phase 1 kommt | 4.2, 5, 12 |
| Mängelklassen | Im Paketformat als eigene Datei je Paket, gebaut in Phase 1 mit den Mängeln; für einen Mangel, der nicht aus einer Prüfung kommt, drei allgemeine Stufen im Paket Allgemein | 4.4, 4.6, 5, 12 |
| Wann ein Mangel behoben ist | Mit der Unterschrift unter dem Auftrag; eine Zurückweisung setzt ihn zurück | 4.6 |
| Messwert außerhalb seines Grenzwerts | Wird mit der Unterschrift ein Mangel, wie „nicht in Ordnung“ | 2.5, 4.5 |
| Dringlichkeit eines Auftrags | Normal, dringend, sofort; „sofort“ kommt immer als Push | 3, 4.8 |
| Weitere Beteiligte an einem Auftrag | Arbeiten mit und schließen nicht ab | 4.8 |
| Zählweise ab dem fälligen Tag | Ein Zwölftel der Frist vor dem Termin erfüllt ihn; früher zählt die Frist neu ab dem Tag | 4.4 |
| Seiten vor Ort für Liegenschaft, Gebäude und Geschoss | Schlichte Listen ohne Lagebild | 4.1 |
| Paket Elektro in Phase 1 | Die Formulare, die ohne Stromkreis auskommen; Messwerte je Stromkreis mit der Elektro-Struktur in Phase 2 | 12 |
| Landesrecht in Phase 1 | Die Pflichtarten für die Anlagenarten der Pakete aus Phase 1; der Rest mit den Fachpaketen | 12 |
| Anlässe der Benachrichtigungen | Sechs, genannt in Abschnitt 3 | 3 |
| Ein Bereich wird entfernt | Erst, wenn keine Liegenschaft mehr in ihm liegt | 2.8 |
| Tausch einer Anlage | Was an der alten offen ist, endet mit ihr; Komponenten bleiben, einzelne lassen sich mitnehmen | 4.2 |
| Vorlagen der Rundgänge | Geführt ab der Objektleitung; ein Punkt zeigt auf eine feste Anlage; ein Grenzwert kommt aus einer Regel oder ist ein eigener Wert mit Quelle | 2.5, 4.5, 7 |
| Feiertage und Schließzeiten | Der Plan nennt seine Wochentage und kann gesetzliche Feiertage auslassen, das Gebäude hat Schließzeiten | 2.9, 4.1, 4.5 |
| Zähler | Verlauf schlicht in Phase 1 und erweitert mit Phase 2 und 3; Berichtigung als neuer Eintrag; Stichtag je Betreiber, an der Messstelle abweichend; zwei Ablesungen am selben Tag sind ein Konflikt | 2.7, 4.9, 12 |
| Rechte an Dokumenten und Aufgaben | Dokumente sehen und ablegen alle, entfernen ab der Objektleitung; Aufgaben legt jede Rolle an, zuteilen ab der Objektleitung; die eigenen liegen auf dem Gerät | 3, 7 |
| Suche vor Ort | Mit Netz auf dem Server, ohne Netz im Bestand des Geräts | 3 |
| Verweis auf das Dokument, das eine Frist trägt | In Phase 1, empfohlen und nicht verlangt | 4.3 |
| Unterschrift ohne Schriftzug | Name tippen und bestätigen; der Nachweis sagt, welcher Weg es war | 2.6 |
| Export | Jede Liste im Büro in Phase 1, der Datenexport eines Rundgangs und der Export für Auswertungen in Phase 2 | 3, 12 |
| Neue Fassung eines Pakets | Die Meldung an bestätigte Pflichten kommt am Ende von Phase 1 | 2.3, 12 |
| Unterlagen für unterwegs | Phase 2 | 2.7, 12 |
| Altbestand | Je Pflicht ein Nachweis mit der Herkunft „Altbestand“; offene Aufträge bleiben in der Vorgängeranwendung | 2.6, 11 |
| Mögliche Dublette bei der Bestandsaufnahme | Ein Konflikt auf dem Gerät | 2.7, 4.2 |
| Vertrag zur Auftragsverarbeitung | Die Vorlage entsteht im Projekt, die technischen und organisatorischen Maßnahmen als eigene Anlage; bis zur rechtlichen Prüfung ist sie gekennzeichnet | 9, 12 |
| Verfahrensbeschreibung für den Parallelbetrieb | Von Hand geschrieben für den Stand von Phase 1; die erzeugte löst sie in Phase 2 ab | 9, 12 |
| Vorlage für eine Betriebs- oder Dienstvereinbarung | Phase 2 | 9, 12 |

**Noch offen**

1. **Rechtliche Prüfung.** Drei Fragen für einen Fachanwalt: ob Fristen aus privaten Normen als Tatsachen genannt werden dürfen; wie die Regelwerke der Unfallversicherung und der staatlichen Ausschüsse einzuordnen sind; und ob die Unterschrift auf dem Gerät als elektronische Signatur für jede Nachweisart genügt, denn § 14 Abs. 7 BetrSichV verlangt sie bei ausschließlich elektronisch übermittelten Dokumenten und nennt keine Stufe. Bis zur Antwort gilt die vorsichtige Lesart aus den Abschnitten 2.6 und 5. Dazu sieht er die Vorlage für den Vertrag zur Auftragsverarbeitung, die bis dahin als nicht rechtlich geprüft gekennzeichnet ist.
2. **Externe Sicherheitsprüfung.** Wer sie vor der Fassung mit der Seite ohne Anmeldung macht.

---

## 16. Änderungsprotokoll

### v0.7 → v0.8

- Die Entscheidungen vom 04.10.2026 stehen an ihrer Stelle und in der Tabelle in Abschnitt 15. Sie beantworten, was die Issues von Phase 1 unter "Zu klären vor dem Bau" offen hatten
- Mängel: die Klassen stehen als eigene Datei im Paket, das Paket Allgemein bringt drei allgemeine Stufen mit, "behoben" ist ein Mangel mit der Unterschrift unter dem Auftrag, und ein Messwert außerhalb seines Grenzwerts wird ein Mangel (2.5, 4.5, 4.6, 5)
- Aufträge haben drei Stufen der Dringlichkeit, und weitere Beteiligte arbeiten mit, ohne abzuschließen (4.8)
- Die Zählweise ab dem fälligen Tag hat ein Fenster von einem Zwölftel der Frist; eine frühere Durchführung zählt neu ab ihrem Tag (4.4)
- Rundgänge: wer Vorlagen führt, worauf ein Punkt zeigt, woher ein Grenzwert kommt, und Wochentage, Feiertage und Schließzeiten im Plan (2.5, 2.9, 4.1, 4.5)
- Zähler: Stichtag, Berichtigung eines Stands, zwei Ablesungen am selben Tag als Konflikt, und der Verlauf hat seine Phasen (2.7, 4.9, 12)
- Abgleich: eine mögliche Dublette aus der Bestandsaufnahme ist ein Konflikt, und die eigenen Aufgaben liegen auf dem Gerät (2.7, 3)
- Der Tausch einer Anlage sagt, was mit Offenem und mit Komponenten geschieht, und ein Bereich wird erst entfernt, wenn er leer ist (2.8, 4.2)
- Die Unterschrift hat einen Weg ohne Schriftzug, und ein Nachweis kann als Altbestand hereinkommen (2.6, 11)
- Abschnitt 3 nennt die Anlässe der Benachrichtigungen, die Suche vor Ort und die Ausgabe jeder Liste als Tabelle; Abschnitt 7 sagt, wer die Rechte für Dokumente, Aufgaben und Vorlagen bekommt
- Was in keiner Phase stand, hat eine: der Export, die Meldung einer neuen Fassung eines Pakets, Unterlagen für unterwegs, die Vorlage für eine Betriebs- oder Dienstvereinbarung, Ansprechpartner und Fotos an der Liegenschaft, der Verlauf der Zähler und die Vorlage für den Vertrag zur Auftragsverarbeitung (12)
- Unter den offenen Punkten stehen die Mängelklassen und die Vorlage für den Vertrag zur Auftragsverarbeitung nicht mehr: beide sind entschieden (15)

### v0.6 → v0.7

- Eigene Anlagenarten des Betreibers hatten keine Phase, nur die eigenen Felder an Anlagenarten standen bei Phase 2. Sie stehen jetzt beide dort, wie in 4.2 nebeneinander (12)
- Damit Import und Bestandsaufnahme in Phase 1 den ganzen Bestand erfassen, auch Anlagen, deren Fachpaket erst in Phase 2 kommt, gibt es das Paket Allgemein mit einer allgemeinen Anlagenart je Kostengruppe, ohne Pflichtarten (4.2, 5, 12)
- Die Mängelklassen kommen nach 4.4 aus dem Paket, das Paketformat in Abschnitt 5 nannte aber keinen Ort dafür. Sie stehen jetzt in der Zuordnung bei Phase 1, mit den Mängeln; wo genau, ist unter den offenen Punkten (12, 15)

### v0.5 → v0.6

- Abschnitt 7 nennt die Rechte für den Abgleich, "Daten abgleichen" und "Änderungen senden", mit der Hülle der Oberfläche, deren Leiste des Abgleichs den Server fragt. Alle vier Rollen haben beide: was ein Gerät sendet, entscheiden die übrigen Rechte Vorgang für Vorgang

### v0.4 → v0.5

- Abschnitt 7 nennt für die vier Rollen aus Phase 1 jedes Recht einzeln. Die Tabelle der Rollen darüber bleibt, wie sie war; die neue Tabelle führt aus, was sie in Worten sagt, und ist dieselbe Liste wie der Katalog der Rechte im Code
- Wo die Tabelle der Rollen zwei Wörter für dasselbe Ding hat, sind es zwei Rechte: aufnehmen und pflegen, ausführen und planen, melden und führen. Die Abnahme und die Gegenzeichnung sind ein eigenes Recht
- Zugänge, Einstellungen und Änderungsprotokoll hat nur die Leitung; die Struktur der Liegenschaften, das Pflichtenverzeichnis und die Fristen pflegen Leitung und Technische Leitung

### v0.3 → v0.4

- Abschnitt 5: Prüfung und Abnahme eines Eintrags stehen in `abnahmen.json` neben den Definitionen; Regeln werden fortgeschrieben und berichtigt statt neu gefasst (ADR 0005)
- Wer eine Instanz betreibt, heißt durchgehend "Verwaltung der Instanz", damit "Betreiber" in der Oberfläche nur eines bedeutet (3, 4.15; ADR 0002)
- Die ADRs 0002 bis 0006 entscheiden, wie die Abschnitte 2.2, 2.6, 2.7, 2.8 und 5 gebaut werden; am Funktionsumfang ändert sich nichts

### v0.2 → v0.3

- Die Technik der Einbindung ist entschieden und steht nicht mehr unter den offenen Punkten: das Repository `opengewerk` wird als Git-Submodul auf einem festen Commit eingebunden, seine Pakete unter `packages/platform/` sind Mitglieder des Arbeitsbereichs dieser Anwendung (ADR 0010 dort, ADR 0001 hier; Abschnitt 15)
- Die Anlässe der Benachrichtigungen stehen in der Zuordnung bei Phase 0: Abschnitt 2.1 nennt sie als Naht, und Phase 1 braucht sie (12)

### v0.1 → v0.2

- Die Entscheidungen vom 01.10.2026 stehen an ihren Stellen, Abschnitt 15 nennt sie im Zusammenhang und führt, was offen bleibt
- Fundament: als Pakete im Repository `opengewerk`, eingebunden über einen festen Stand, ohne Abschrift (Leitentscheidung 7, 2.1, Phase 0)
- Katalog: alle sieben Pakete vollständig vor Version 1, Abnahme am Eintrag, staatliches Recht erscheint sofort, erstes Land ist Baden-Württemberg (5)
- Rollen: eigene Rollen ab Phase 2, im Fundament von Anfang an als Daten (7)
- Fahrplan: Lager mit Verbrauch am Auftrag, Auswertungen über die Zeit und eigene Rollen rücken nach Phase 2, weil der Pilotbetrieb sie vor der Abschaltung seiner bisherigen Anwendung braucht; Phase 3 heißt Schlüssel, Energie, Planung (12)
- Sprachen: Deutsch, keine weitere (14)

### v0.1

- Erster Entwurf vom 01.10.2026, vor den Entscheidungen aus Abschnitt 15
- Die Fundstellen in Abschnitt 8 sind am selben Tag gegen die amtlichen Texte geprüft, der Vergleich in Abschnitt 13 stammt aus einer Marktrecherche vom selben Tag
