# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Auswertungen über die Zeit (#334, Abschnitt 4.16 des Konzepts): unter „Auswertungen“ die Erfüllung der Pflichten
  je Monat, Quartal oder Jahr (fällig geworden, rechtzeitig, später, noch offen), die offenen Mängel nach Alter und
  Klasse, die Störungen nach Kategorie und Gebäude mit der Zeit bis zur Annahme und bis zur Erledigung und die Vorgänge
  nach DIN 31051, je Bereich, Liegenschaft und Gebäude und als Tabelle. Keine Zahl je Person, auch nicht in der
  Tabelle. Warum: der Pilotbetrieb braucht die Kennzahlen, bevor die Vorgängeranwendung abgeschaltet wird, und deren
  Rückstandsliste je Person wird nicht nachgebaut. Das neue Recht „Auswertungen ansehen“ haben Leitung und Technische
  Leitung; bestehende Betreiber bekommen es mit der Migration `0066_report_right`.
- Störmeldung ohne Konto über das Etikett (#332, Abschnitt 4.7 des Konzepts): das Etikett an einem Raum oder einer
  Anlage öffnet ohne Anmeldung eine Seite mit Kategorie, Beschreibung, Foto und auf Wunsch einer E-Mail-Adresse für die
  Rückmeldung, sobald die Leitung sie unter „Einstellungen“, „Störungen“ einschaltet. Die Seite nennt nur den Raum; ein
  unbekanntes, ein gesperrtes und ein ausgeschaltetes Etikett sagen dasselbe. Statt eines Captchas nimmt sie je Anschluss
  fünf und je Etikett zehn Meldungen in der Stunde an, mit einem versteckten Feld und einer Mindestzeit. Die Meldung landet
  im Eingang wie eine mit Konto und nennt niemanden; die Adresse bekommt bei Annahme und Erledigung eine E-Mail über den
  Mailserver des Betreibers, steht in keinem Änderungsprotokoll und wird mit der Erledigung oder einer Ablehnung gelöscht.
  Warum: wer in einem Gebäude ist und kein Konto hat, soll eine Störung dort melden können, wo sie ist. Die Migration
  `0065_fault_reports_by_label` bringt die Einstellung, die Tabelle der Adressen und den Weg in die Datenbank für eine
  Meldung ohne Person; das Fundament zeigt die Seite vor der Anmeldung (opengewerk/opengewerk#652).

### Geändert

- Unter „Benachrichtigungen“ stehen nur noch die Anlässe für Push, die eine Person mit ihren Rechten betreffen
  können (#398): ein Melder sieht „Ihre Störmeldungen“ und sonst nichts, die Rolle Haustechnik sieht
  „Eingegangene Störungen“ nicht. Warum: ein Anlass, der nie eintritt, ließ sich einschalten und blieb
  stumm, und beim Melder war die Liste fast ganz ohne Bedeutung. Jeder Anlass nennt dafür sein Recht; das
  Fundament lässt die übrigen weg (opengewerk/opengewerk#653).
- Vor Ort hat ein Melder keinen Reiter „Konflikte“ mehr und keinen Weg ins Büro, weder als Vorschlag
  auf einem Arbeitsplatz noch im Menü (#392). Warum: sein Gerät hält nichts vom Betreiber, ein
  Konflikt kann dort nicht entstehen, und das Büro schickte ihn gleich zurück nach „Vor Ort“. Dafür
  ist das Submodul des Fundaments angehoben (opengewerk/opengewerk#651).

## [0.1.6] - 2026-10-16

Eine zweite Zwischenfassung für den Pilotbetrieb, mit drei weiteren Stücken aus Phase 2. Wer in
einem Gebäude arbeitet, meldet eine Störung mit Konto dort, wo sie ist, und das Büro nimmt sie unter
„Störungen“ an. Ein wöchentlicher, monatlicher oder jährlicher Rundgang steht vor Ort ab dem Tag, den
sein Plan unter „Sichtbar ab“ nennt, und bleibt bis zur Unterschrift ausfüllbar. Lager, Artikel und
Lieferanten lassen sich entfernen, und ein Artikel zieht mit seinem Bestand in ein anderes Lager um.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten, vorher gesichert. Drei Migrationen kommen
mit (`0062_fault_reports`, `0063_round_plans_shows_from`, `0064_stock_transfer`); mit der ersten
bekommen bestehende Betreiber die Rolle Melder und die beiden neuen Rechte. Bestehende Pläne zeigen
ihre Rundgänge danach ab dem ersten Tag ihrer Woche, ihres Monats oder ihres Jahres; wer einen
anderen Tag will, stellt ihn im Plan ein.

### Hinzugefügt

- Störmeldungen mit Konto (#331, Abschnitt 4.7 des Konzepts): die neue Rolle Melder meldet vor Ort an
  einem Gebäude, einem Raum oder über das Etikett an einer Anlage, mit Kategorie, Beschreibung und
  Foto, und sieht ihre eigenen Meldungen mit ihrem Stand. Wer in einem Bereich Störungen annimmt,
  findet sie im Büro unter „Störungen“: Annehmen legt einen Auftrag der Art „Störung“ an, der die
  Meldung nennt, Zusammenführen legt Meldungen derselben Störung zusammen, Ablehnen verlangt einen
  Grund. Erledigt ist eine Meldung mit der Unterschrift unter ihrem Auftrag. Aus einer Meldung lässt
  sich ein Mangel melden, das Lagebild zählt die offenen Störungen eines Gebäudes und die Anlagenakte
  nennt sie. Die Kategorien legt die Leitung unter „Einstellungen“ fest, mit sechs Vorschlägen beim
  ersten Start. Dazu zwei Anlässe für Push: eine Störung geht ein, und eine eigene Meldung wird
  angenommen oder erledigt. Warum: wer in einem Gebäude arbeitet, soll eine Störung dort melden können,
  wo sie ist, und erfahren, was daraus wird; eine Meldung nennt dabei niemanden, wer gemeldet hat,
  steht nur im Änderungsprotokoll. Bestehende Betreiber bekommen die Rolle Melder und die beiden neuen Rechte mit
  der Migration `0062_fault_reports`.

### Geändert

- Ein Rundgang eines wöchentlichen, monatlichen oder jährlichen Plans steht vor Ort ab dem Tag, den
  der Plan unter „Sichtbar ab“ nennt, vorgegeben ab Montag, ab dem 1. und ab dem 1. Januar, und lässt
  sich von da an bis zur Unterschrift ausfüllen (#394, Abschnitt 4.5 des Konzepts). Er entsteht
  rechtzeitig vor diesem Tag, also auch mehr als 14 Tage vor seinem Durchgang. Ein täglicher Plan
  behält seinen Vorlauf in Tagen. Warum: ein monatlicher Rundgang zum Monatsende erschien höchstens
  14 Tage vorher, gedacht ist er für den ganzen Monat. Bestehende Pläne zeigen ihre Rundgänge ohne
  weiteres ab dem ersten Tag ihrer Woche, ihres Monats oder ihres Jahres; die Migration
  `0063_round_plans_shows_from` bringt die beiden Spalten dafür.
- Lager, Artikel und Lieferanten lassen sich im Büro entfernen, und ein Artikel zieht mit seinem
  Bestand in ein anderes Lager um (#391, Abschnitt 4.12 des Konzepts). Ein Lager geht, solange es
  keinen Artikel führt, ein Artikel, solange er nirgends Bestand hat; alle drei bleiben an ihren
  Buchungen lesbar. Der Umzug bucht den Bestand als Umbuchung, einen Abgang hier und einen Zugang
  dort, mit der neuen Art aus dem Fundament; führt das andere Lager den Artikel schon, kommt der
  Bestand dazu. Warum: ein Lager ließ sich nicht entfernen, und ein Artikel im falschen Lager kam
  dort nicht mehr heraus; die Routen zum Entfernen gab es, ohne Prüfung und ohne Knopf. Eine
  entfernte Lagerzeile kommt mit der nächsten Buchung dort zurück. Die Migration
  `0064_stock_transfer` bringt die Spalte für das andere Lager und die Prüfungen dazu.

## [0.1.5] - 2026-10-16

Eine Korrekturfassung für den Pilotbetrieb. Die Datenschutzhinweise einer Instanz blieben leer,
sobald ihr Text auf einen Pfad verwies, etwa auf das Impressum; jetzt öffnet ein solcher Verweis die
Seite im selben Fenster. Abschnitte und Fett eines Rechtstexts passen zum Text, und unter
„Rechtstexte“ der Instanz steht, unter welchen Adressen Impressum und Datenschutzhinweise zu lesen
sind.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten, vorher gesichert. Es gibt keine Migration
und kein neues Recht. Wer in seinen Rechtstexten bisher mit der vollen Adresse auf den anderen Text
verwiesen hat, kann wieder den Pfad nehmen (`/rechtliches`, `/rechtliches/datenschutz`).

### Behoben

- Die Datenschutzhinweise der Instanz unter `/rechtliches/datenschutz` blieben leer, sobald ihr Text
  auf einen Pfad verwies, etwa auf das Impressum (#386). Die Rechtsseite steht vor dem Router, und der
  Verweis suchte einen; ohne Router ist ein Pfad jetzt ein gewöhnlicher Verweis. Unter "Rechtstexte"
  der Instanz steht dazu, unter welchen Adressen Impressum und Datenschutzhinweise zu lesen sind.
- Fett und Überschriften der Rechtstexte passen zum Text (#387). Ein Abschnitt kam als graues Etikett
  in Kapitälchen, kleiner als der Text darunter, und Fett stand schwerer als jede Überschrift der
  Anwendung; jetzt ist ein Abschnitt eine Überschrift mit Abstand davor, Fett hat das Gewicht 600.
  Die Hilfe neben einem Bildschirm behält ihre Etiketten.

Für beide ist das Submodul des Fundaments angehoben (opengewerk/opengewerk#649).

## [0.1.4] - 2026-10-16

Eine Zwischenfassung für den Pilotbetrieb mit dem, was aus Phase 2 schon fertig ist, vor der Fassung
0.2.0 am Ende der Phase. Ein Auftrag bekommt auf Wunsch einen Leistungsnachweis mit der Unterschrift
des Auftraggebers, Material kommt aus dem Lager an den Auftrag, und ein Dokument trägt ein Datum, bis
zu dem es gilt, als Frist. Fremdfirmen stehen in einer Liste mit Ansprechpartnern, Dokumenten,
Verträgen und Gewährleistung; an einem Auftrag einer Fremdfirma werden ihre Leute vor Ort
eingewiesen, und der Erlaubnisschein für feuergefährliche Arbeiten ist ein Formular des Pakets
Brandschutz. Dazu kommen das Nachweisverzeichnis, die Einordnung nach DIN 31051 und abgeschlossene
Rundgänge als Tabelle; das Büro lädt seine Bildschirme je Adresse nach und startet damit schneller.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten, vorher gesichert. Die Migrationen
`0053_service_reports` bis `0061_briefings_and_permits` laufen dabei von selbst; die neuen Rechte
„Verträge ansehen“ und „Verträge führen“ bekommen die Rollen, die sie nach dem Konzept haben. Das
Formular des Erlaubnisscheins ist neu und noch nicht fachkundig abgenommen; es ist überall so
gekennzeichnet, wo es gelesen wird.

### Hinzugefügt

- Einsatz einer Fremdfirma (#330): Ein Auftrag nennt die Fremdfirma aus der Liste, die ihn ausführt,
  auch einer von Hand oder aus einem Mangel. Vor Ort weist, wer den Auftrag führt oder Arbeit plant und
  verteilt, die Leute der Firma ein: Name in Druckschrift, worin, und ihr Schriftzug auf dem Gerät, auch
  ohne Netz. Für feuergefährliche Arbeiten stellt er dort den Erlaubnisschein aus, ein neues Formular im
  Paket Brandschutz (`hot_work_permit`), in dem die ausführende Person unterschreibt. Beides steht am
  Auftrag und an der Fremdfirma, lässt sich nicht ändern, auch nicht in der Datenbank, und der
  Erlaubnisschein bleibt in der Fassung seines Formulars lesbar. So liegt im System, wer vor Ort
  eingewiesen war und unter welchen Auflagen gearbeitet wurde, statt auf Papier neben der Anwendung.
  Migration `0061_briefings_and_permits`.
- Verträge und Gewährleistung (#329): Verträge mit Fremdfirmen unter „Verträge“, mit Beginn, Ende der
  Laufzeit, Verlängerung, Kündigungsfrist, dem Tag einer Kündigung und Reaktionszeit, Preis und Notiz
  als Angaben. Ein Vertrag erfasst Gebäude und Anlagen, zeigt sie aus den Bereichen der Person und
  steht in der Akte jeder erfassten Anlage unter „Verträge und Gewährleistung“, neben der
  Gewährleistung der Anlage und der abgenommenen Aufträge an ihr. Eine Pflicht nennt den Vertrag, den
  sie erfüllt, und sagt „Vertrag abgelaufen“, wenn er geendet hat. Kündigungsfrist und Ende eines
  Vertrags und das Ende einer Gewährleistung stehen in „Fristen“, damit niemand eine Kündigung oder
  eine Gewährleistung verpasst; bisher stand das in Listen neben der Anwendung. Ein Vertrag hat
  Dokumente wie eine Fremdfirma, ohne Bereich. Neue Rechte „Verträge ansehen“ (Leitung, Technische
  Leitung, Objektleitung) und „Verträge führen“ (Leitung, Technische Leitung), wie am 15.10.2026
  entschieden. Migration `0060_contracts`.
- Rundgänge als Tabelle (#344): ein abgeschlossener Rundgang neben dem PDF als Excel oder CSV,
  je Punkt eine Zeile mit Antwort, Grenzwert und Bemerkung, und die Rundgänge eines Plans über
  einen Zeitraum, etwa die Temperaturen eines Monats. Gelesen wird der eingefrorene Stand, ohne
  Namen und Uhrzeiten, wie am 15.10.2026 entschieden.
- Der Leistungsnachweis eines Auftrags (#324): wo ein Auftraggeber da ist und es möchte,
  unterschreibt er vor dem Abschließen auf dem Gerät die geleistete Arbeit und die Dauer, mit
  Schriftzug und seinem Namen in Druckschrift, auch ohne Netz. Der Pilotbetrieb führt seinen Rapport
  heute täglich; damit gibt es ihn in der Anwendung. Die Signatur des Kontos, das das Gerät hält,
  deckt die Seite, der Server nimmt sie nur für genau diese Seite und von der Person, die den Auftrag
  führt, einer zählt je Auftrag, und eine Zurückweisung macht ihn ungültig. Der Server friert ihn ein,
  das PDF entsteht aus diesem Stand und trägt keine Preise; er steht am Auftrag im Büro und auf der
  Zeitachse des Orts. Namen und Uhrzeiten der Ausführenden nennt er nur, wenn die Leitung es unter
  „Einstellungen“, „Aufträge“ einschaltet; die Vorgabe ist aus, weil die Dauer Aufwand des Auftrags
  und keine Arbeitszeiterfassung ist. Die Verfahrensbeschreibung nennt den Namen des Auftraggebers
  als Angabe eines Dritten und die Einstellung. Migration `0053_service_reports`.
- Das Lager (#325): Artikel mit Nummer, Bezeichnung, EAN des Herstellers, Einheit und Preis,
  Lieferanten und mehrere ortsfeste Lager. Der Bestand je Lager ist die Summe seiner Buchungen, ein
  Wareneingang erhöht ihn, eine Zählung setzt ihn mit ihrem Grund auf das Gezählte, und keine Buchung
  wird geändert oder gelöscht. Unter dem Mindestbestand steht ein Artikel in der Bestellliste des
  Lagers, als Filter und als Tabelle, ohne Benachrichtigung. Die Vorgängeranwendung beim
  Pilotbetrieb führt heute ein Lager, und vor ihrer Abschaltung braucht es eines in der Anwendung.
  Gebaut auf dem Baustein des Fundaments (ADR 0011 in `opengewerk`), dessen Submodul dafür
  angehoben ist. Ansehen kann das Lager jede Rolle (`store.read`), führen ab der Objektleitung
  (`store.write`); Planungskonzept v0.41. Die Verfahrensbeschreibung nennt, dass eine Buchung
  festhält, wer gebucht hat. Migration `0054_stock`.
- Liegenschaft und Gebäude für alle Zeilen eines Imports (#173): im ersten Schritt lässt sich unter
  „Was die Datei nicht sagt“ eine Liegenschaft wählen, die für jede Zeile ohne eine gilt, beim Import
  der Anlagen dazu eines ihrer Gebäude. Die Spalten sind dann keine Pflicht mehr; nennt eine Zeile
  eine, gilt die Zeile. Eine Raum- oder Anlagenliste gilt oft für ein Haus und nennt es nur im
  Dateinamen, und bisher musste dafür vor dem Import eine Spalte eingefügt und gleich gefüllt werden.
  Zur Wahl steht, was die Person sieht.
- Material am Auftrag (#326): vor Ort entnimmt, wer den Auftrag ausführt, Material aus einem
  Lager, per Scan des Strichcodes des Herstellers oder eines eigenen Etiketts am Fach, sonst über
  die Suche, auch ohne Netz. Der Server bucht jede Entnahme genau einmal im Lager; liegt weniger da,
  wird trotzdem gebucht und der Bestand sagt, dass er unter null steht, bis eine Zählung ihn
  berichtigt. Das Material steht am Auftrag im Büro, auf der Seite, die der Auftraggeber für den
  Leistungsnachweis unterschreibt, und auf dessen PDF, jeweils ohne Preis und ohne Person. Für
  Artikel ohne EAN druckt das Büro Etiketten der Fächer. So ersetzt die Anwendung die Erfassung
  des Verbrauchs in der Vorgängeranwendung beim Pilotbetrieb. Das Submodul liest dafür auch EAN-8
  (opengewerk/opengewerk#646). Migration `0055_work_order_materials`.
- Gültigkeit von Dokumenten (#327): eine Fassung trägt auf Wunsch ein Datum, bis zu dem sie gilt,
  bei einer Gefährdungsbeurteilung den Tag ihrer Wiedervorlage, und das Datum der neuesten Fassung
  wird eine Frist unter „Fristen“. Eine neue Fassung bringt ihr eigenes Datum, ohne Datum oder mit
  dem Dokument fällt die Frist weg. Verantwortlich ist, wer das Datum gesetzt hat; wie vorher
  erinnert wird, steht je Fristart unter den Einstellungen. Zertifikate und Gefährdungsbeurteilungen
  liefen bisher nur über die Erinnerung der Leute; die Fremdfirmen und Verträge (#328, #329) bauen
  darauf auf. Die Gefährdungsbeurteilung ist eine eigene Art eines Dokuments (Planungskonzept
  v0.42), und eine Pflicht, die auf eine zeigt, nennt ihre Wiedervorlage. Migration
  `0056_document_validity`.
- Fremdfirmen (#328, erster Teil): eine Liste der Firmen des Betreibers mit Anschrift, Telefon,
  E-Mail, den Kostengruppen, in denen sie arbeiten, und einer Notiz, betreiberweit und ohne Bereich.
  Eine Pflicht, ein Vorgang und der Bericht einer Fremdfirma wählen die Firma aus dieser Liste statt
  sie als Text zu schreiben; ein Vorgang übernimmt sie von seiner Pflicht, ein Nachweis behält seine
  Organisation, wie sie geschrieben wurde. Namen, die noch als Text an Pflichten stehen, übernimmt
  das Büro mit einem Klick. Entfernt wird eine Firma nur, solange keine offene Pflicht und kein
  offener Vorgang sie nennt. Neue Rechte „Fremdfirmen ansehen“ (alle Rollen) und „Fremdfirmen
  pflegen“ (Leitung und Technische Leitung), Planungskonzept v0.43. Migration `0057_contractors`.
- Einordnung nach DIN 31051 (#333): jeder Vorgang und jeder Auftrag ist Wartung, Inspektion,
  Instandsetzung oder Verbesserung, damit die Auswertungen (#334) dieselbe Sprache sprechen wie
  Verträge und Leistungsverzeichnisse. Die Einordnung folgt aus der Art, wie am 15.10.2026
  entschieden; nur ein sonstiger Auftrag wählt sie, und ein solcher aus der Zeit davor sagt „nicht
  eingeordnet“, bis er geändert wird. Die Seiten von Auftrag und Prüfung nennen sie. Migration
  `0058_basic_measure`.
- Nachweisverzeichnis (#338): im Pflichtenverzeichnis je Anlage ihre Pflichten mit Fundstelle, Frist,
  Begründung, letztem Nachweis und nächster Fälligkeit, für eine Liegenschaft, ein Gebäude, einen Bereich
  und eine Auswahl von Anlagenarten, als PDF im Querformat oder als Tabelle, jeweils für den Tag, an dem
  es entsteht. Ein Nachweis aus dem Altbestand trägt seine Marke, eine Pflicht ohne Nachweis steht als
  „Nie erfasst“ darin, beendete Pflichten nur auf Wunsch, und der Dialog sagt vorher, wie viele Pflichten
  es enthält. Im PDF folgen auf Wunsch die Nachweise und die Prüfbescheinigungen, auf denen sie beruhen,
  so wie die Anwendung sie aufbewahrt, und jede Zeile nennt die Seite ihres Nachweises. So lässt sich eine
  Begehung allein aus der Anwendung bestreiten. Erzeugen darf, wer das Pflichtenverzeichnis und die
  Nachweise ansieht; enthalten ist nur, was die Person in ihren Bereichen sieht. Mit Anhang wiegt es
  höchstens 200 MB, darüber sagt der Server, die Auswahl einzugrenzen.
- Ansprechpartner und Dokumente einer Fremdfirma (#328, zweiter Teil): auf der Seite der Firma ihre
  Ansprechpartner und ihre Zertifikate, Versicherung und Nachweise als Fachbetrieb, deren „Gültig bis“
  eine Frist in „Fristen“ wird, auch abgelaufen. Damit ist die Liste der Fremdfirmen vollständig, wie
  Abschnitt 4.11 sie beschreibt. Wie die Firma liegen ihre Ansprechpartner und Dokumente in keinem
  Bereich: entschieden am 16.10.2026, eine Zeile in `contacts`, `attachments` und `deadlines` darf
  genau dann ohne Liegenschaft und Bereich stehen, wenn sie an etwas Betreiberweitem hängt; eine
  Prüfung in der Datenbank hält das, die Policies lassen solche Zeilen für jeden im Betreiber durch,
  und das Recht „Fremdfirmen pflegen“ entscheidet, wer sie anlegt, wer über ein Dokument einer
  Firma eine neue Fassung legt, es ändert und es entfernt (Nachtrag in ADR 0003). Lesen,
  in der Liste, als Datei, in der Tabelle „Dokumente“ und auf dem Gerät, kann sie nur, wer
  „Fremdfirmen ansehen“ hat, weil das Recht genau das schützen soll und die Bereiche hier nicht
  greifen; dafür kennt das Fundament ein Leserecht je Elternteil eines Ansprechpartners
  (opengewerk/opengewerk#648), das Submodul ist angehoben. Der Name einer Firma ist dagegen keine
  geschützte Angabe: die Frist eines Firmendokuments nennt Titel und Firma jedem, der Fristen ansieht
  (Planungskonzept v0.44). Eine entfernte Firma nimmt ihre Ansprechpartner und Dokumente mit.
  Migration `0059_contractor_contacts_and_documents`.

### Geändert

- Das Büro lädt seine Bildschirme je Adresse nach (#374), statt alle beim ersten Aufruf: der Einstieg
  sinkt von 449,0 auf 291,8 kB gzip, bei einem Budget von 450 kB, das mit jedem Bildschirm knapper
  wurde. Statisch bleiben nur die Übersicht, mit der das Büro beginnt, und was die Hüllen ohnehin
  laden. Der Einstieg vor Ort steigt dabei von 267,3 auf 276,2 kB, weil sich die gemeinsamen Teile in
  kleinere Stücke schneiden; er hält sein Budget von 300 kB. Der Schritt „Budget“ prüft zusätzlich,
  dass der Service Worker jedes Skript des Baus hält: so öffnet sich ein Bildschirm auch dann noch,
  wenn schon die nächste Fassung auf dem Server liegt.
- Ein Gerät, dessen Person das Recht „Fremdfirmen ansehen“ nicht hat, hält von den Fremdfirmen nur
  noch, welche Firma es ist, und ihren Namen (#377). Bisher kamen Anschrift, Telefon, E-Mail-Adresse,
  Kostengruppen und Notiz mit, obwohl die Person sie im Büro nicht sieht. Der Name bleibt, weil ein
  Auftrag vor Ort die Firma nennt und der Name keine geschützte Angabe ist. Verliert die Person das
  Recht, lässt ihr Gerät die übrigen Angaben beim nächsten Abgleich los.
- Das Büro lädt die Bildschirme der Importe und den Dialog des Nachweisverzeichnisses erst, wenn sie
  geöffnet werden (#338). Der Einstieg des Büros stand an seinem Budget von 450 kB gzip und liegt jetzt
  bei 440 kB; gebraucht werden die Importe beim Einzug eines Betreibers und selten danach.
- Der Import schlägt eine Spalte auch vor, wenn ihr Kopf ä, ö, ü und ß ausschreibt, wie es ein
  Programm ohne Umlaute tut (GEBAEUDE, STRASSE UND HAUSNUMMER), und umgekehrt (#177). Solche Tabellen
  kamen bisher ohne Vorschlag an, und jede Spalte musste von Hand zugeordnet werden. Nur die Köpfe:
  die Werte, an denen der Import Liegenschaften und Gebäude wiedererkennt, bleiben genau. Dafür ist
  das Submodul des Fundaments angehoben.
- Der Katalog ist fachkundig abgenommen, alle 114 Einträge der sieben Pakete am 16.10.2026: Elektro
  vom Maintainer, die übrigen Pakete vom Pilotbetrieb, wie Abschnitt 15 des Planungskonzepts es
  vorsieht. Jede Abnahme nennt die Prüfsumme dessen, was abgenommen wurde, in `abnahmen.json` des
  Pakets. Bis dahin stand jeder Eintrag überall als „Nicht abgenommen“ da, und ein Betreiber sollte
  sich auf keine Frist daraus verlassen.

## [0.1.3] - 2026-10-15

Die dritte Nachlieferung für den Pilotbetrieb, aus dem Anlegen der Pläne und dem ersten Blick auf
die Liste der Liegenschaften. Ein Plan eines Rundgangs, der am falschen Ort angelegt wurde, lässt
sich entfernen, solange von ihm nichts gegangen ist, und Namen mit Zahlen stehen in jeder Liste nach
dem Wert der Zahl, Hausnummer 2 vor 10. Dazu steht im Planungskonzept (v0.40), was vor dem Bau von
Phase 2 entschieden wurde.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten; 0.1.3 bringt keine Migration mit.

### Hinzugefügt

- Ein Plan eines Rundgangs, der irrtümlich angelegt wurde, lässt sich entfernen (#320), solange von
  ihm kein Rundgang begonnen, unterschrieben, abgegeben oder als nicht durchgeführt geschlossen ist.
  Bisher blieb nur, ihn zu beenden, und weil sich der Ort eines Plans nicht ändern lässt, stand nach
  jedem Plan am falschen Gebäude ein beendeter in der Liste. Der Plan wird markiert und nie gelöscht,
  mit ihm jeder seiner Rundgänge, den noch niemand begonnen hat, auch auf den Geräten vor Ort, und
  seine Frist entfällt; das Änderungsprotokoll nennt, wer ihn angelegt und wer ihn entfernt hat. Ist
  schon ein Rundgang gegangen, wird der Plan beendet, wie eine Pflicht mit Nachweis.

### Geändert

- Planungskonzept v0.40: die Entscheidungen vom 15.10.2026 vor dem Bau von Phase 2 stehen an ihrer
  Stelle und in der Tabelle in Abschnitt 15 (#324 bis #361). Die Issues von Phase 2 hatten unter
  "Zu klären vor dem Bau" offen, was das Konzept nicht sagte. Entschieden ist unter anderem: der
  Leistungsnachweis entsteht auf Wunsch beim Abschließen vor Ort, einer je Auftrag, und eine Person
  ohne Konto unterschreibt mit Schriftzug und Namen unter der Signatur des Kontos, das das Gerät
  hält; Lager und Qualifikationen entstehen im Fundament, weil die Handwerkersoftware beides auch
  plant; eine neue Störmeldung kommt als Push an die, die sie annehmen, und die Seite ohne
  Anmeldung ist ausgeliefert aus; die Auswertungen zählen rechtzeitig erfüllte Termine je Monat bis
  zur Ebene Gebäude; ein Sammelvorgang hat eine Unterschrift und einen Nachweis je Pflicht; außer
  Betrieb durch Mangel ist ein Zustand bis "behoben", die Pflichten laufen weiter; von einem
  Nachweis, dessen Aufbewahrung abgelaufen ist, bleibt eine leere Hülle; das Änderungsprotokoll
  bleibt auch mit eigenen Rollen der Leitung vorbehalten.

### Behoben

- Namen mit Zahlen stehen in jeder Liste nach dem Wert der Zahl (#322): Musterstraße 2 vor
  Musterstraße 10, 2.1 zwischen 2 und 3, Raum E.2 vor E.10. Bisher sortierten die Listen als Text,
  und bei einer Liegenschaft, deren Gebäude nach Straße und Hausnummer heißen, stand 10 vor 2. Das
  gilt im Büro und auf dem Telefon, in den Auswahlfeldern und Filtern und auf dem Server: in der
  Tabelle der Liegenschaften, in den Routen, die Liegenschaften, Gebäude, Geschosse und Räume
  liefern, und auf dem Bogen mit den Etiketten der Räume eines Gebäudes.

## [0.1.2] - 2026-10-15

Die zweite Nachlieferung für den Pilotbetrieb, aus dem ersten Tag mit den übernommenen Daten. Im Plan
eines Rundgangs stehen bei einem Gebäude mit eigenem Bereich die Leute dieses Bereichs zur Wahl, und
eine künftige Migration prüft einen neuen Fremdschlüssel gegen alle Zeilen statt gegen die, die der
Eigentümer der Tabellen sieht.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten; 0.1.2 bringt keine Migration mit. Wer noch
auf 0.1.0 steht und schon Anlagen in Gebäuden oder Etiketten an Räumen hat, kommt über
`0051_building_areas` nur, wenn der Eigentümer der Tabellen für den einen Lauf an den Policies vorbei
darf (#315). Hält `sh docker/start.sh` dort mit dem Fehler 23503 an `assets_follow_their_building` oder
`labels_follow_their_room` an, ist nichts eingespielt, und es geht im Ordner der Instanz so weiter; die
vierte Zeile gehört auch dann dazu, wenn die dritte scheitert:

```sh
docker compose -f docker/compose.yaml stop app
docker compose -f docker/compose.yaml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER ROLE opengewerk_owner BYPASSRLS"'
docker compose -f docker/compose.yaml run --rm migrate
docker compose -f docker/compose.yaml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER ROLE opengewerk_owner NOBYPASSRLS"'
sh docker/start.sh
```

### Behoben

- Der Plan eines Rundgangs bietet bei einem Gebäude mit eigenem Bereich die Leute dieses Bereichs an
  (#316). Das Formular fragte nach den Personen im Bereich der Liegenschaft, auch wenn der Ort ein
  Gebäude war, und nannte unter "Alle im Bereich" diesen Bereich; der Plan selbst liegt aber im
  Bereich des Gebäudes, und nur dessen Leute nimmt der Server an. So stand bei einem Betreiber, der
  seine Gebäude auf die Bereiche seiner Teams verteilt hat, unter "Eine Person" nur noch, wer alle
  Bereiche sieht.

- Eine Migration, die einen Fremdschlüssel an eine Tabelle mit Zeilen hängt, prüft ihn gegen alle
  Zeilen (#315). Eine Instanz migriert als Eigentümer der Tabellen, und unter `FORCE ROW LEVEL
  SECURITY` sah die Prüfung nur, was die Policies ihm zeigen: an `0051_building_areas` hielt sie eine
  Anlage in einem Gebäude für verwaist und brach das Update von 0.1.0 ab, und an Tabellen, die der
  Eigentümer gar nicht liest, prüfte sie gegen nichts. Ein Test hält jede Migration nach
  `0052_building_moves` dazu an, `FORCE` für die Anweisung auf beiden Tabellen aufzuheben und danach
  zurückzugeben, wie 0051 es für ihre Änderungen schon tut. 0051 und 0052 bleiben, wie sie sind, weil
  der Lauf eingespielte Migrationen an ihrer Prüfsumme erkennt; ein weiterer Test hält fest, wie eine
  Instanz mit Daten von 0.1.0 trotzdem über sie kommt.

## [0.1.1] - 2026-10-15

Die erste Nachlieferung für den Pilotbetrieb, aus dem, was beim Einrichten seiner Instanz auffiel. Ein
Gebäude kann einen eigenen Bereich haben, sodass an einer Liegenschaft mehrere Objektleiter je ihre
Gebäude führen, und ein Gebäude, das in der falschen Liegenschaft angelegt wurde, lässt sich mit allem
darin in die richtige verlegen. An einer Liegenschaft, deren Bereich man nicht hat, bietet die
Oberfläche nur noch an, was der Server auch annimmt.

Aktualisiert wird wie bei jeder Fassung in zwei Schritten. Die Migrationen `0051_building_areas` und
`0052_building_moves` laufen dabei von selbst; wer was sieht, ändert sich erst, wenn jemand einem
Gebäude einen eigenen Bereich gibt oder eines verlegt.

### Hinzugefügt

- Ein Gebäude kann einen eigenen Bereich haben (#306). An einer Liegenschaft mit mehreren Gebäuden
  arbeiten oft mehrere Objektleiter, jeder für seine Gebäude, und bisher blieb dafür nur, je
  Objektleiter eine eigene Liegenschaft an derselben Anschrift anzulegen. Ein Gebäude hat den Bereich
  seiner Liegenschaft, bis es im Formular einen eigenen bekommt, und alles darin folgt ihm: Geschosse,
  Räume, Anlagen, Pflichten, Nachweise, Mängel, Vorgänge, Aufgaben, Dokumente, Zähler und Etiketten.
  Was an der Liegenschaft selbst hängt, bleibt bei ihrem Bereich. Wer nur den Bereich eines Gebäudes
  hat, sieht die Liegenschaft mit Anschrift, Notiz und Ansprechpartnern und darin seine Gebäude,
  ändert an der Liegenschaft aber nichts und stellt auch kein Gebäude auf sie. Die
  Datenbank hält das wie bisher mit Schlüsseln: jede Zeile folgt dem Bereich dessen, woran sie hängt
  (Migration `0051_building_areas`, Nachtrag zu ADR 0003). Die Liste der Liegenschaften filtert nach
  dem Bereich auch über die Gebäude, „Bereiche“ nennt die Gebäude mit eigenem Bereich, und ein Bereich
  wird erst entfernt, wenn auch sie verlegt sind.
- Ein Gebäude lässt sich in eine andere Liegenschaft desselben Betreibers verlegen (#307). Bei der
  Einrichtung kann ein Gebäude mit Anlagen in der falschen Liegenschaft stehen, und bisher blieb nur,
  alles neu anzulegen. Alles darin zieht mit: Geschosse, Räume, Anlagen mit ihren Komponenten,
  Pflichten, Mängel, Vorgänge, Aufträge, Aufgaben, Dokumente, Zähler und Etiketten, und es bekommt
  den Bereich der neuen Liegenschaft, außer es hat einen eigenen. Ein Nachweis, eine Unterschrift oder
  eine Antwort eines Rundgangs darin hält es fest, ebenso, was über das Gebäude hinaus zusammenhängt,
  und ein anderes Bundesland; der Dialog „In eine andere Liegenschaft verlegen“ im Formular des
  Gebäudes sagt dann mit einem Satz, warum. In der Datenbank folgen die Schlüssel über die
  Liegenschaft dem, woran eine Zeile hängt (Migration `0052_building_moves`, Nachtrag zu ADR 0002).

### Geändert

- Die Seite einer Liegenschaft bietet Bearbeiten, „Neues Gebäude“, Ansprechpartner, Dokumente und
  Aufgaben an der Liegenschaft nur noch an, wer ihren Bereich hat (#309). Wer sie nur über ein
  Gebäude in seinem Bereich sieht, kann dort nichts ändern; bisher kam die Absage des Servers erst
  nach dem Klick.
- Die Formulare bieten die Liegenschaft selbst als Ort nur noch an, wer ihren Bereich hat (#310):
  Aufgabe, Dokument, Mangel, Auftrag, Pflicht, Plan eines Rundgangs und der Bogen mit Etiketten.
  Ihre Gebäude im eigenen Bereich bleiben zur Wahl; wo nur ein Gebäude geht, fragt das Formular nach
  einem. Bisher sagte erst der Server beim Speichern nein.

## [0.1.0] - 2026-10-15

Die erste Fassung von OpenGewerk Haustechnik: Phase 1 des Planungskonzepts, der Stand, mit dem der
Pilotbetrieb in den Parallelbetrieb geht. Ein Betreiber führt damit seine Liegenschaften bis zum
Raum, seine Anlagen mit Akte, Etikett und Zählern, das Pflichtenverzeichnis mit den Vorschlägen aus
den Paketen Elektro, Brandschutz, Trinkwasser, Messstellen, Allgemein und Landesrecht
(Baden-Württemberg), die Nachweise aus Protokoll oder Bericht, die Rundgänge vor Ort auch ohne Netz,
Mängel, Aufträge, Dokumente und die Erinnerungen an Fristen per E-Mail und Push, je Fristart
einstellbar. Die Daten der Vorgängeranwendung kommen über den Importweg herein, und eine von Hand
geschriebene Verfahrensbeschreibung liegt für eine Arbeitnehmervertretung bei.

Installiert wird aus dem Paket dieser Seite mit einem Befehl, ohne Quelltext; die Abbilder sind
signiert. Neben OpenGewerk auf demselben Server läuft die Haustechnik mit eigenem Port, eigenem
Hostnamen und eigener Datenbank.

Was noch fehlt, steht in Phase 2 des Planungskonzepts: unter anderem die Pakete Raumluft und Kälte,
Heizung, Förderanlagen und Arbeitsmittel, Störmeldungen, eigene Rollen, die Aufbewahrung der
Nachweise mit Löschvorschlag und die erzeugte Verfahrensbeschreibung. Die externe Sicherheitsprüfung
kommt vor der Fassung mit der ersten Seite ohne Anmeldung, der Störmeldung über das Etikett.

### Hinzugefügt

- Je Fristart lässt sich unter „Einstellungen“, „Fristen“ einstellen, wie eine Frist erinnert:
  per E-Mail und Push, nur per E-Mail oder mit keiner Nachricht (#269), wie es die Tafel
  `HT-Einst-Fristen` zeigte. Ohne Nachricht steht die Frist weiter in der Liste und legt ihre
  Aufgabe oder ihren Vorgang an; nur per Push gibt es nicht, weil Push nur die erreicht, die es für
  sich eingeschaltet haben (Moritz, 14.10.2026). Die Spalte kommt aus dem Fundament
  (`opengewerk/opengewerk#643`) mit Migration 0050; E-Mail und Push fragen die Einstellung vor dem
  Schreiben und vor dem Senden, und der Satz unter „Konto“ sagt es. Verfahrensbeschreibung
  (Abschnitte 3.15 und 6) und Planungskonzept v0.36 ziehen mit.
- „Angemeldete Geräte“ unter „Konto“ nennt an jedem Gerät die Netzadresse, von der es sich
  angemeldet hat, aus dem Fundament (`opengewerk/opengewerk#563`). Die Zeile der Sitzung hielt sie
  schon; jetzt sieht die Person selbst sie und erkennt eine Anmeldung, die nicht ihre ist, die
  Leitung unter „Zugänge“ sieht sie nicht (Moritz, 14.10.2026). Die Verfahrensbeschreibung sagt es
  in Abschnitt 3.3 als Zusage, der offene Punkt in Abschnitt 10 entfällt, und das Planungskonzept
  nennt die Adresse unter den personenbezogenen Daten.
- Releases (#136): ein Tag `v<fassung>` auf `main` startet den Workflow "Release". Er baut die
  Abbilder der Anwendung und der Sicherung für x86_64 und ARM64, legt sie unter der Fassung in
  ghcr.io ab, signiert sie ohne Schlüssel über Sigstore und schreibt die Seite des Releases mit dem
  Abschnitt des CHANGELOG und dem Installationspaket, das `docker/pack-kit.sh` packt: der Ordner
  `docker` mit der Fassung in seiner `compose.yaml` und die Skripte des Fundaments, mit denen er
  startet, jeder Eintrag root gehörig. Ist der Abschnitt für die Seite zu lang, wie bei der ersten
  Fassung, bleibt seine Einleitung stehen und der Rest ist ein Verweis. Der Lauf "Installationspaket"
  der CI packt das Paket bei jedem Pull Request, entpackt es ohne Quelltext daneben und startet es
  mit einem Befehl; die Instanz meldet dann die Fassung des Pakets. So wie in der
  Handwerkersoftware, damit eine Installation ohne Checkout und ohne Bauen auskommt.
- Initiales Repository-Gerüst: README, Lizenz, Vorlagen für Issues und Pull Requests
- Planungskonzept v0.1 unter `docs/konzept/`: Leitentscheidungen, Datenmodell vom Ort bis
  zum Nachweis, Funktionsumfang, Pflichtenpakete, rechtliche Anforderungen mit Fundstellen,
  die am 01.10.2026 gegen die amtlichen Texte geprüft sind, und der Fahrplan in sieben
  Phasen
- CI mit den Prüfungen "Kodierung und Zeilenenden" und "Schreibweise", wie in den anderen
  Repositories der Organisation: UTF-8 ohne BOM, LF, keine Gedankenstriche, keine
  umgeschriebenen Umlaute, geprüft am ganzen Bestand und nicht nur am Diff
- CodeQL, das die zu prüfenden Sprachen aus dem Dateibestand ermittelt, und Dependabot für
  die Actions der Workflows
- Der Arbeitsbereich: das Repository `opengewerk` ist als Git-Submodul unter
  `upstream/opengewerk` eingebunden, auf einem festen Commit, und seine Pakete unter
  `packages/platform/` sind Mitglieder des Arbeitsbereichs (ADR 0010 dort). Compiler-Optionen,
  Lint-Regeln, Testbasis und Formatierung werden aus dem Submodul gelesen und nicht
  abgeschrieben; `pnpm run check:toolchain` vergleicht die Fassungen der Werkzeuge mit denen
  des Fundaments. Das erste eigene Paket ist `@opengewerk/haustechnik-domain`. Ein Import aus
  der Handwerkersoftware am Fundament vorbei scheitert im Lint und an einem Test, der die
  `package.json` des Pakets liest
- CI-Job "Typprüfung, Lint und Tests" über alle Mitglieder des Arbeitsbereichs, die Pakete
  des Fundaments eingeschlossen. Er wird rot, wenn das Submodul auf einen Commit zeigt, der
  nicht auf `main` des Fundaments liegt, oder wenn die Werkzeuge von denen des Fundaments
  abweichen. Dependabot schlägt den neuen Stand des Fundaments wöchentlich vor
- ADR 0001, Derselbe Stack, das Fundament als Submodul: welche Architekturentscheidungen der
  Handwerkersoftware hier gelten, wie das Repository aufgebaut ist, wie die Pakete heißen und
  was diese Anwendung selbst nennt, damit sie neben der Handwerkersoftware auf demselben
  Server laufen kann
- Die Serverseite des Fundaments ist Mitglied des Arbeitsbereichs: `@opengewerk/platform-server`
  mit Datenbankzugriff, Migrationslauf, den Tabellen für Betreiber, Konten, Zugehörigkeiten,
  Audit-Log und Abgleich und den SQL-Bausteinen, aus denen die erste Migration dieser Anwendung
  entsteht. Ihre Tests laufen damit auch hier, in der CI gegen ein PostgreSQL 18 als Dienst und
  lokal gegen eine eigene Testdatenbank aus `docker/compose.test.yaml` auf Port 5434.
  `pnpm run test` richtet jedes Paket auf sie aus, damit die Tests des Fundaments nicht die
  Testdatenbank eines anderen Repositorys leeren, die auf demselben Rechner läuft
- ADR 0002 bis 0006, die Entscheidungen vor der ersten Tabelle: das Datenmodell vom Ort bis
  zum Nachweis mit den Namen im Code, die Zuständigkeitsbereiche in der Datenbank samt einer
  Messung gegen PostgreSQL 18 (eine Policy, die ihre Funktionen direkt aufruft, ist
  zweihundertmal langsamer als dieselbe mit Unterabfragen), der Nachweis mit eingefrorenem
  Stand und Fingerabdruck, die Pakete als Daten mit unveränderlichen Fassungen, und die
  Regeln dafür, was ein Gerät ohne Netz hält, anlegt und ändert
- Der Server dieser Anwendung beginnt mit ihrer Datenbank: das Paket
  `@opengewerk/haustechnik-server` mit dem Schema, der ersten Migration `0000_foundation` samt
  Rücknahme und dem Befehl `migrate`, der Migrationen als Eigentümer der Tabellen einspielt. Die
  Migration legt in einer leeren Datenbank an, was jede Anwendung der Organisation trägt:
  Betreiber, Konten und Sitzungen, Zugehörigkeiten und Einladungen, Rollen, das Audit-Log mit
  Hashkette, die Tabellen des Abgleichs, Nummernkreise, versiegelte Zugangsdaten und den Bereich
  der Instanz. Sie ist aus den Schema-Modulen und SQL-Bausteinen des Fundaments zusammengesetzt
  und nicht abgeschrieben. Die Nummernkreise dieser Anwendung sind `asset` für die Anlagennummer,
  `work_order` für die Nummer eines Auftrags und `evidence` für den Nachweis, der eine Zweck
  versiegelter Zugangsdaten ist `smtp_password`; die Einstellungen mit Gültigkeitszeitraum kommen
  mit der ersten Einstellung (ADR 0001, Nachträge vom 02.10.2026)
- Tests gegen die echte Datenbank, migriert als Eigentümer der Tabellen und nicht als Superuser,
  für den keine Policy gilt. Eine leere Datenbank ist nach dem Lauf bereit, und ein zweiter Lauf
  tut nichts; eine geänderte Migration wird abgelehnt; schlägt eine von mehreren fehl, bleibt die
  Datenbank auf dem Stand davor; die Rücknahme führt zu einer leeren Datenbank. Zwei Betreiber
  bekommen in jeder Tabelle eine Zeile, und geprüft wird je Tabelle, aus dem Katalog der
  Datenbank und nicht aus einer Liste, dass jeder nur seine sieht, keiner dem anderen eine
  schreibt, ändert oder löscht, und dass von innen nichts von dem zu sehen ist, was der Instanz
  gehört. Eine Tabelle, die eine spätere Migration ohne `FORCE`, ohne Policy, ohne Recht, ohne
  Audit-Trigger oder ohne eine Zeile in diesem Test bringt, macht ihn rot. Dazu der Vergleich
  der Datenbank mit den Bausteinen des Fundaments, der anzeigt, wenn das Fundament sich bewegt
  hat und diese Anwendung eine Migration schuldet
- Rechte und Rollen dieser Anwendung. Der Katalog der Rechte steht in `packages/domain`: lesen
  und schreiben für Ort, Anlagen, Pflichten, Vorgänge, Nachweise und Mängel, dazu Zugänge,
  Einstellungen und Änderungsprotokoll, jedes mit einem Schlüssel aus Ding und Tätigkeit und
  einer Bezeichnung in Worten. Wo das Konzept zwei Wörter für dasselbe Ding hat, sind es zwei
  Rechte: Anlagen aufnehmen und pflegen, Vorgänge ausführen, planen und abnehmen, Mängel
  melden und führen. Ein Betreiber beginnt mit den vier Rollen aus Phase 1, Leitung, Technische
  Leitung, Objektleitung und Haustechnik, geschrieben als Zeilen, sobald er entsteht. Die
  Leitung führt den Betreiber und arbeitet nur mit zweitem Faktor; beides sind Angaben der Rolle
  und keine Rechte, und die letzte Leitung lässt sich weder herabstufen noch sperren. Kein
  Recht ändert oder löscht einen Nachweis, ersetzt eine Unterschrift oder überspringt eine
  Abnahme
- Die Schnittstelle des Servers beginnt mit dem, was das Fundament mitbringt: Ersteinrichtung
  mit Einrichtungscode, Einmal-Link, Konto und Geräte, die Verwaltung der Zugänge und der
  Bereich der Instanz, hinter dem Guard und in den Worten dieser Anwendung (Betreiber, Leitung,
  Verwaltung der Instanz). Gestartet wird sie noch nicht, und eine Einladung geht als Link
  hinaus, bis ein Betreiber seinen Mailserver einrichten kann
- Tests dazu: je Rolle, was sie darf und was nicht; die Tabelle in Abschnitt 7 des Konzepts
  gegen den Katalog, sodass ein Recht, das nur an einer der beiden Stellen steht, anders heißt
  oder einer anderen Rolle gehört, den Lauf rot macht; jede Route des Moduls gegen den Guard,
  mit den Routen ohne Anmeldung als Liste, die sich nur mit Absicht verlängert; und gegen die
  echte Datenbank der Weg von der leeren Instanz über die Ersteinrichtung bis zur Anmeldung, bei
  der die Leitung ohne zweiten Faktor nicht weiterkommt
- Die Oberfläche beginnt mit ihrer Hülle (#13, erster Teil): das Paket
  `@opengewerk/haustechnik-web` mit den beiden Einstiegen `/` für das Büro und `/m` für die
  Arbeit vor Ort, mit Tor, Anmeldung, Ersteinrichtung, Einladung, zweitem Faktor, "Konto",
  "Zugänge", dem Bereich der Instanz, der Leiste des Abgleichs und dem Konfliktbildschirm aus dem
  Fundament. Was diese Anwendung dazu sagt, sagt sie in ihren Worten: der Mandant ist der
  Betreiber, wer ihn führt, die Leitung, wer die Instanz betreibt, die Verwaltung der Instanz,
  und die Einstiege heißen "Büro" und "Vor Ort". Name, Symbol und beide Manifeste tragen
  "OpenGewerk Haustechnik"; die Markendateien liegen als die eine erlaubte Kopie unter
  `assets/brand`. Bis die Datensätze aus Phase 1 eigene Listen haben, beginnt das Büro bei den
  Einstellungen und der Einstieg vor Ort bei den Konflikten. Die CI prüft das Bündelbudget je
  Einstieg (gebaut 150 kB vor Ort und 168 kB im Büro, Grenzen 300 und 450 kB) und den Bau auf
  Wörter der Handwerkersoftware für Betreiber, Leitung und den Einstieg vor Ort. Der Einstieg
  vor Ort öffnet auf einem Gerät, das schon angemeldet war, auch ohne Netz
- Der Server startet (#13, zweiter Teil): `pnpm --filter @opengewerk/haustechnik-server run
  start` setzt eine Instanz aus ihrer Konfiguration zusammen, liefert beide Einstiege der
  Oberfläche aus, meldet unter `/health` seine Gesundheit mit der Fassung und zeigt auf einer
  leeren Instanz die Ersteinrichtung mit Einrichtungscode; mit `CLOSED` läuft er, ohne etwas
  herauszugeben. Dazu kommen die Routen des Abgleichs unter `/sync`, die die Leiste des
  Abgleichs fragt, mit den Regeln dieser Anwendung: bis die Datensätze ihre Richtlinien haben
  (#27), reist keiner, und ein Gerät, das trotzdem einen schickt, bekommt die Ablehnung mit dem
  Vorgang genannt
- Das Änderungsprotokoll (#13, dritter Teil): unter den Einstellungen für die Leitung, die es
  nach Abschnitt 7 des Konzepts als einzige einsieht, und im Bereich der Instanz unter
  "Protokoll". Bildschirm und Routen sind die des Fundaments, die Wörter die dieser Anwendung:
  ein Betreiber, seine Einstellungen, die Rolle, die ihn leitet, die Verwaltung der Instanz,
  die Gründe einer Änderung und die Bezeichnungen der Rechte und Rollen. Sie stehen einmal in
  `packages/domain` und gelten für Server und Oberfläche. Eigene Tabellen hat diese Anwendung
  noch nicht; jede, die kommt, braucht dort Namen für sich und jede Spalte, sonst wird ein Test
  rot, der die Wörter gegen den Katalog der Datenbank hält. Dazu Tests, dass nur die Leitung
  das Protokoll liest und die anderen Rollen die Ablehnung mit dem fehlenden Recht in Worten
  bekommen, dass die Prüfung der Kette antwortet und dass die Einstellungen den Eintrag nur dem
  anbieten, der ihn lesen darf, mit Gegenproben
- Der Betrieb über Docker Compose (#15): ein eigenes Abbild, gebaut mit dem Submodul und geprüft
  auf Bündelbudget und Wörter der Handwerkersoftware, die Compose-Datei mit Datenbank,
  Migrationsdienst, Anwendung und Sicherung, und `sh docker/start.sh` als der eine Befehl für
  den ersten Start und jedes Update. Die Skripte dahinter sind die des Fundaments; diese
  Anwendung nennt ihnen ihren Namen, den Anfang ihrer Variablen (`HAUSTECHNIK_`) und eine
  Beispieladresse. Projektname, Port, Datenbank und Volumes sind ihre eigenen, damit sie neben
  einer Installation von OpenGewerk läuft, und die Archive der Sicherung heißen nach ihrer
  Datenbank. Den Renderer bringt #23 mit, weil die Anwendung bis dahin nichts druckt
- Die Befehle für die Kommandozeile: `add-staff`, `reset-password`, `appoint-operator` und
  `add-tenant`, die Befehle des Fundaments mit den Worten und Rollen dieser Anwendung, als
  Rückweg, wenn sich jemand ausgesperrt hat. Ein Passwort kommt verdeckt vom Terminal oder aus
  `HAUSTECHNIK_PASSWORD`, nie aus einem Argument
- Die CI-Läufe "Betrieb über Docker Compose", "Sicherung und Rückspielen" und "Update einer
  laufenden Instanz" mit den Schritten des Fundaments gegen den Stapel dieser Anwendung. Dazu
  meldet sich nach dem Rückspielen ein Konto von vor der Sicherung mit seinem Passwort an, und
  das Update führt von der ersten Migration auf die zweite, mit dem Nummernkreis für Aufträge an
  seiner Stelle. Ein vierter Lauf, "Neben OpenGewerk auf einem Server", startet OpenGewerk aus
  dem Submodul und die Haustechnik daneben: beide antworten auf ihrem Port und mit eigenen
  Volumes, eine Sitzung gilt nur bei ihrer Anwendung, ihr Cookie nennt keine Domain und gilt
  damit nur unter dem Hostnamen, von dem es kam, und die Haustechnik lässt sich samt Volumes
  entfernen, ohne dass sich an OpenGewerk etwas ändert

- Zuständigkeitsbereiche in der Datenbank (#17, ADR 0003): ein Betreiber bündelt seine
  Liegenschaften in Bereichen, eine Zugehörigkeit gilt für alle Bereiche oder für genannte, und
  eine Vertretung gibt jemandem an ihren Tagen die Bereiche einer anderen Person dazu. Was eine
  Person sieht, liest die Datenbank selbst aus diesen Tabellen, mit zwei Funktionen, die die
  Policy jeder Tabelle mit Ort als Unterabfrage fragt; die Anwendung gibt keine Liste von
  Bereichen weiter, und eine Route, die sich irrt, kann nichts aufweiten. Eine Transaktion ohne
  Person sieht keine Zeile mit Ort, ein Lauf im Hintergrund sagt ausdrücklich, dass er alle
  Bereiche braucht. Ein neuer Betreiber bekommt mit seiner ersten Zugehörigkeit den Bereich
  "Alle Liegenschaften" und merkt sonst nichts davon; Leitung und Technische Leitung sehen von
  Haus aus alle Bereiche, die anderen den einen, und wer schon vor dem Update bei einem
  Betreiber arbeitete, bekommt dieselbe Vorgabe. Noch hat keine Tabelle einen Ort, die
  Liegenschaften kommen mit #18 und bringen die Policy aus dem Baustein mit. Geprüft ist die
  Grenze an Tabellen, die der Test nach demselben Baustein anlegt: Lesen, Ändern und Löschen je
  Tabelle, ein Verweis auf einen Ort eines anderen Bereichs, das Verlegen einer Liegenschaft, das
  jede Zeile darunter mitnimmt, und die Vertretung an ihren Tagen. Ein Katalogtest wird rot,
  sobald eine Tabelle mit Ort einen Teil der Grenze vergisst oder ihre Policy die Funktionen
  direkt aufruft, was beim Zählen von 6000 Anlagen 54.160 statt 169 Puffer kostet
- Der Ort (#18, ADR 0002): Liegenschaft mit Anschrift, Bundesland und Bereich, Gebäude mit
  Kürzel, Gebäudearten und Baujahr, Geschoss mit Ebene, Raum mit Nummer, Bezeichnung und
  Nutzung, in den Tabellen `properties`, `buildings`, `floors` und `rooms`. Jede Ebene trägt
  die Kennungen der Ebenen darüber, und zusammengesetzte Schlüssel lassen einen Raum nur auf
  einem Geschoss seines Gebäudes stehen und ein Gebäude nur auf seiner Liegenschaft. Jede
  Zeile trägt den Bereich ihrer Liegenschaft, die Policy aus dem Baustein der Bereiche und die
  Spalten des Abgleichs; verlegt die Leitung eine Liegenschaft in einen anderen Bereich, zieht
  jede Zeile darunter mit. Gelöscht wird durch Markieren, und was darunter hängt, wird im selben
  Augenblick mitmarkiert. Ein Gebäude hat eine Gebäudeart oder mehrere, aus den Sonderbauten
  des § 38 Abs. 2 LBO Baden-Württemberg, dazu Wohngebäude, Garage, Außenanlage und Sonstiges:
  eine Schule mit Aula ist auch Versammlungsstätte. Die Routen unter `/properties`,
  `/buildings`, `/floors` und `/rooms` legen an, ändern, verlegen einen Raum und löschen, mit
  den Rechten aus Abschnitt 7 des Konzepts: Räume nimmt auf, wer vor Ort arbeitet, die
  Struktur pflegen Leitung und Technische Leitung. Dieselben Prüfungen stehen in `domain` und
  in der Datenbank, und der Compiler hält die Typen der Zeilen gegen das Modell. Die Flächen
  kommen nach dem Fahrplan des Konzepts in Phase 3, die Bildschirme in Phase 1, und auf ein
  Gerät reisen die Orte erst mit den Regeln des Abgleichs (#27)
- Das Paketformat (#19, ADR 0005): der Katalog aus Anlagenarten, Pflichtarten, Regeln,
  Formularen und Vorlagen steht als JSON unter `pakete/<name>/`, jede Fassung einer Anlagenart,
  Pflichtart, eines Formulars oder einer Vorlage in einer eigenen Datei, und `abnahmen.json`
  nennt je Fassung und je Regel den Tag der letzten Prüfung gegen die Quelle und, wo es sie
  gibt, die Abnahme mit Person, Tag und Prüfsumme. Das neue Paket
  `@opengewerk/haustechnik-catalogue` liest den Ordner beim Bau, prüft jede Datei gegen ihr
  Schema und die Pakete gegeneinander und schreibt das Bündel, das Server und Oberfläche laden
  werden; ein Fehler hält den Bau an und nennt Datei, Feld und Grund. Rot wird es unter anderem
  bei einer Pflichtart ohne Fundstelle, einer Frist ohne Regel, einer Lücke mitten in einer
  Reihe von Regeln, einem Verweis ohne Ziel, einer Frist aus einer privaten Norm ohne den
  Vermerk der rechtlichen Prüfung und einer Abnahme, deren Prüfsumme nicht passt. In einem Pull
  Request vergleicht die CI jede Fassung, die es auf `main` gibt, Byte für Byte, denn eine
  bestätigte Pflicht muss morgen auf dieselbe Fassung zeigen können. In `domain` beantwortet
  `catalogueOf` die Fragen an den Katalog, jede mit einem Tag: welche Fassung gilt, welche Regel
  der Frist, und für einen Tag vor dem Beginn einer Regel keine. Jeder Eintrag kommt dort nur
  mit seiner Prüfung und Abnahme heraus, sodass ein Eintrag ohne Abnahme überall als solcher
  erkennbar ist. Ein Probepaket mit der Hauptprüfung einer Aufzugsanlage nach der BetrSichV
  liegt als Material bei den Tests und als Vorbild für einen Beitrag, beschrieben in
  `pakete/README.md`. Die Inhalte der Pakete kommen in Phase 1
- Die Technik (#20, ADR 0002): eine Anlage steht in genau einem Gebäude und auf Wunsch in
  einem seiner Räume, hat eine Anlagenart aus dem Katalog der Pakete und dazu Hersteller,
  Typ, Seriennummer, Baujahr, Inbetriebnahme, Gewährleistungsende und das Kennzeichen des
  Betreibers. Eine Komponente ist eine Anlage unter einer Anlage im selben Gebäude, beliebig
  tief; dass keine unter sich selbst hängt, prüft die Datenbank, und zieht die Anlage in ein
  anderes Gebäude, kommen ihre Komponenten mit. Auf ihrer Liegenschaft bleibt eine Anlage,
  denn auf einer anderen gälten andere Pflichten. Die Werte der Merkmale und Felder einer
  Anlagenart stehen an der Anlage und werden gegen die Art geprüft. Eine Messstelle ist eine
  Anlagenart, deren Paket Medium und Einheiten nennt, und ihre Anlage trägt Zählernummer und
  Einheit. Der Lebenszyklus ist eine Liste von Zuständen ab einem Tag, einer je Tag; der
  Zustand an einem Tag wird daraus gerechnet und nie gespeichert, mit Eigenschaftstests über
  beliebige Einträge und Tage. Die Anlagennummer kommt aus dem Nummernkreis `asset`,
  `AN-00001` aufwärts, und wird nach dem Löschen nicht neu vergeben, damit ein Etikett nie auf
  eine andere Anlage zeigt. Was eine Anlage versorgt, ohne dort zu stehen, ist eine Liste von
  Gebäuden und Räumen ihrer Liegenschaft. Die Routen unter `/assets` und
  `POST /buildings/:id/assets` legen an, ändern, verlegen, hängen um, führen den Lebenszyklus
  und löschen, mit den Rechten aus Abschnitt 7: aufnehmen darf, wer vor Ort arbeitet,
  pflegen die Objektleitung und darüber. Ein Raum, in dem eine Anlage steht, zieht seitdem nur
  innerhalb seines Gebäudes um, einer, den eine Anlage versorgt, nur innerhalb seiner
  Liegenschaft, weil die Schlüssel jede Zeile halten, die ihn nennt. Das Probepaket hat einen
  Wasserzähler bekommen, und der Bau gibt es unter `@opengewerk/haustechnik-catalogue/testing`
  für die Tests des Servers aus. Eigene Anlagenarten des Betreibers haben im Fahrplan noch
  keine Phase (#52); die Stände der Zähler und die Bildschirme kommen in Phase 1, und auf ein
  Gerät reisen die Anlagen mit den Regeln des Abgleichs (#27)
- Wie der nächste Termin einer Pflicht gezählt wird, sagt ihre Pflichtart (#25): ab dem Tag der
  Durchführung, ab dem fälligen Tag oder nach § 14 Abs. 5 BetrSichV, wo der Termin ein Monat mit
  Jahr ist und eine Prüfung noch zwei Monate danach fristgerecht. Der Bau eines Pakets verlangt die
  Angabe und lehnt für die BetrSichV eine Frist in Tagen ab. Der nächste Termin aus den Tagen, an
  denen die Pflicht erfüllt wurde, und der Zustand einer Pflicht an einem Tag (nie erfasst, ruht,
  überfällig, fällig, erfüllt bis) sind reine Funktionen in `packages/domain`, mit
  Eigenschaftstests über beliebige Tage; eine nicht bestandene oder nicht durchgeführte Prüfung
  zählt nicht. Das Bündel des Katalogs hat damit das Format 2
- Die Pflicht im Datenmodell (#25, ADR 0002): eine Pflicht hängt an einer Anlage, einem Raum,
  einem Gebäude oder der Liegenschaft. Aus dem Katalog bestätigt hängt sie an einer Anlage, deren
  Art die Pflichtart nennt, und trägt deren Schlüssel und Fassung; eine eigene Pflicht des
  Betreibers trägt Bezeichnung, Grundlage und Quelle. Dazu kommen die tatsächliche Frist in Tagen
  oder Monaten mit Begründung, wer verantwortlich ist, wer ausführt, wer bestätigt hat und wann
  sie endet. Die Höchstfrist vom Tag der Bestätigung steht neben der Frist, und eine längere
  lehnen Route und Datenbank ab, weil sich eine Höchstfrist nur verkürzen lässt und eine
  bestätigte Pflicht sich nicht still ändert, wenn ein Paket eine neue Fassung bekommt. Ein
  verworfener Vorschlag hält Begründung und Person fest, denn auch die Entscheidung, dass eine
  Pflicht nicht gilt, muss sich belegen lassen; bestätigt jemand die Pflicht doch, ist die
  Verwerfung zurückgenommen. Die Routen unter `/duties` und `/duty-dismissals` stehen hinter den
  Rechten aus Abschnitt 7: lesen dürfen alle, führen Leitung und Technische Leitung. Vorschläge,
  Pflichtenverzeichnis und Bildschirme kommen in Phase 1, auf ein Gerät reisen die Pflichten
  mit den Regeln des Abgleichs (#27)
- Der Termin einer Pflicht (#25, ADR 0002): die Fristen-Engine des Fundaments führt ihn als Frist
  der Art "Fälligkeit einer Pflicht", fällig an dem Tag, den der letzte Nachweis mit der Frist und
  der Zählweise der Pflicht ergibt, nach § 14 Abs. 5 BetrSichV als Monat. Keine Frist gibt es für
  eine Pflicht, die nie erfasst wurde, keine, solange ihre Anlage ruht, und keine mehr, wenn die
  Pflicht endet; ein Nachweis, der nicht bestanden oder nicht durchgeführt ist, zählt nicht. Die
  Fristen tragen Pflicht, Liegenschaft und Bereich und bleiben in den Bereichen der Person, die
  fragt; der Lauf startet mit der Anwendung, geht jede Minute durch alle Bereiche eines Betreibers
  und erinnert dreißig Tage vor dem fälligen Tag, bis ein Betreiber einen anderen Vorlauf setzt.
  Die Routen unter `/deadlines` und `/settings/deadlines` sind die des Fundaments, hinter den
  Rechten "Fristen ansehen" und "Fristen bearbeiten". Ein Nachweis ist bis #26 eine Zeile mit
  Pflicht, Tag und Ergebnis, die keine Route schreibt und die sich nicht ändern lässt; das Anheben
  des Fundaments bringt den Weg des Laufs in alle Bereiche (opengewerk#517) und die eigene Policy
  der Bereiche an seiner Tabelle der Fristen (opengewerk#518) mit. Die Sicherung zählt Nachweise
  und Fristen, und der Lauf im Stapel schreibt die Frist selbst
- Vorgang und Mangel im Datenmodell (#26, ADR 0002): ein Rundgang, eine Prüfung, eine Wartung
  und ein Arbeitsauftrag sind Arten eines Vorgangs in einer Tabelle, damit jeder dieselbe Pflicht
  auf demselben Weg erfüllt. Ein Vorgang hängt wie eine Pflicht an Anlage, Raum, Gebäude oder
  Liegenschaft, nennt die Pflichten, die er erfüllen soll, seinen Stand, seine Fälligkeit und wer
  verantwortlich ist und wer ihn ausführt; nicht durchgeführt heißt er nur mit Grund, damit ein
  versäumter Rundgang sichtbar bleibt. Was nur ein Auftrag hat, die Nummer aus dem Nummernkreis
  der Aufträge und die Art des Auftrags, steht daneben, und die Datenbank hält, dass ein Auftrag
  nur an einem Vorgang der Art "Arbeitsauftrag" hängt. Ein Mangel hängt an einer Anlage oder einem
  Ort, nennt den Vorgang, bei dem er aufgefallen ist, und den Auftrag, der ihn beseitigt, mit
  Beschreibung, Klasse, dem Tag der Feststellung, der Frist zur Beseitigung und dem Stand von
  festgestellt bis nachgeprüft. Die Klasse prüft bis zur Antwort auf #59 kein Paket. Wird ein Ort,
  eine Anlage, ein Vorgang oder eine Pflicht markiert, wird markiert, was darunter hängt. Routen
  und Bildschirme kommen mit den Abläufen in Phase 1, auf ein Gerät reisen Vorgänge und Mängel mit
  den Regeln des Abgleichs (#27); die Sicherung zählt die vier neuen Tabellen
- Der festgeschriebene Nachweis (#26, ADR 0004): ein Nachweis trägt jetzt seine Nummer aus dem
  Nummernkreis der Nachweise, seine Herkunft (Protokoll, Bericht, Punkt eines Rundgangs, Auftrag
  oder Altbestand), wer ihn ausgeführt hat, wer ihn festgeschrieben hat und wann, und seinen
  eingefrorenen Stand: alles, was auf der Seite stand, mit der Frist und der Fundstelle des Tages,
  dem Ort in Worten, den Mängeln, den Unterschriften und der Aufbewahrung, damit ein Nachweis von
  2027 im Jahr 2035 zeigt, was 2027 galt. Über dem Stand liegt ein Fingerabdruck, SHA-256 über
  seine kanonische Form, an der Zeile und im Änderungsprotokoll. Festgeschrieben wird nur auf dem
  Server, in einer Transaktion mit der Nummer, sodass die Nummern ohne Lücke laufen. Ändern und
  Löschen lehnt die Datenbank für jede Rolle ab, auch für den Eigentümer der Tabellen und einen
  Superuser; nur der Bereich folgt seiner Liegenschaft. Eine Anlage mit Nachweis wird zurückgebaut
  und nicht gelöscht, auch nicht mit ihrem Gebäude, und die Routen sagen das mit einem Satz.
  Routen, die einen Nachweis schreiben, kommen mit den Abläufen in Phase 1
- Die Unterschrift auf einem Vorgang (#26, ADR 0004): unterschrieben wird auf dem Gerät, mit
  Zeitpunkt, Gerät, Linienzug und dem Fingerabdruck der Seite, die gezeigt wurde, und der Server
  nimmt die Unterschrift nur für genau diese Seite an. Die Seite hält, was vor Ort gesagt wird,
  und nichts, was Server oder Büro später ergänzen, damit Gerät und Server sie gleich berechnen.
  Vor der Unterschrift braucht der Vorgang den Tag der Durchführung und jede seiner Pflichten ein
  Ergebnis; wo die Vorlage es verlangt, zeichnet die Objektleitung danach gegen. Sind alle
  Unterschriften da, entsteht in derselben Transaktion ein Nachweis je Pflicht. Ein Auftrag
  wartet auf seine Abnahme; eine Zurückweisung mit Grund lässt die Unterschrift stehen, die dann
  nicht mehr gilt. Unterschriften und Entscheidungen ändert und löscht die Datenbank für keine
  Rolle. Die Routen und die Sperre des unterschriebenen Vorgangs kommen in Phase 1, der Weg über
  den Abgleich mit #27
- Berichtigung und Ungültigerklärung eines Nachweises (#26, ADR 0004): eine Berichtigung ist ein
  neuer Nachweis derselben Pflicht, der den ersetzten mit Grund nennt, an der Zeile und im
  eingefrorenen Stand, der dafür in Fassung 2 steht; der ersetzte bleibt, wie er war. Eine
  Ungültigerklärung ist eine eigene Zeile mit Grund, Person und Zeitpunkt, höchstens eine je
  Nachweis und für keine Rolle änderbar. Für die Frist einer Pflicht zählt nur, was weder ersetzt
  noch für ungültig erklärt ist, so ist die Pflicht eines fälschlich unterschriebenen Rundgangs
  wieder offen. Ein Test ruft jede Route auf und hält fest, dass keine Antworten, Unterschriften
  oder Nachweise zurücksetzt. Die Routen dafür kommen in Phase 1
- Der Abgleich der Datensätze (#27, erster Teil, ADR 0006): jede Tabelle mit den Spalten des
  Abgleichs hat ihre Richtlinie, und je Art von Datensatz steht fest, welche Felder ein Gerät
  ohne Verbindung anlegt und ändert. Vor Ort entstehen so Räume, Anlagen mit Komponenten,
  Einträge im Versorgungsbereich, Mängel und Aufträge für eine Störung, und ein Vorgang nimmt
  seinen Fortschritt und die Ergebnisse seiner Pflichten bis zur Unterschrift; alles andere
  ist ein Konflikt für genau diesen Vorgang, damit ein strengerer Server keinen Postausgang
  aufhält. Bereich, Liegenschaft und Gebäude leitet der Server ab, die Nummer einer Anlage
  und eines Auftrags zieht er, und einen Ort, der fehlt oder nicht passt, beantwortet er mit
  einem Konflikt statt mit einem Fehler für die ganze Übertragung. Der Konfliktbildschirm
  nennt Datensätze, Felder und Werte auf Deutsch; die Prüfung des Baus auf Wörter der
  Handwerkersoftware nimmt dafür "in Betrieb" und "außer Betrieb" aus, den Zustand einer
  Anlage. Die Auswahl je Gerät und die Unterschrift über den Abgleich folgen in den nächsten
  Teilen
- Was ein Gerät hält (#27, zweiter Teil, ADR 0006): wer alle Bereiche sieht, den ganzen
  Betreiber; wer nur seine sieht, die Orte, Anlagen und Pflichten seiner Bereiche, seine
  Vorgänge, solange sie offen sind, und abgeschlossene noch dreißig Tage, mit ihren Pflichten
  und Aufträgen, und die offenen Mängel. Die Antwort des Abrufs nennt dazu je Art einen
  Fingerabdruck, damit ein Gerät fallen lässt, was es nach einem Wechsel der Person, anderen
  Bereichen oder einer verlegten Liegenschaft nicht mehr halten darf
- Die Unterschrift über den Abgleich (#27, dritter Teil, ADR 0004 und 0006): eine Unterschrift,
  die ein Gerät ohne Verbindung leistet, prüft der Server wie eine über eine Route, und sind alle
  verlangten da, schreibt er in derselben Transaktion je Pflicht den Nachweis, mit den Namen der
  Konten. Eine Seite, die nicht mehr die ist, die der Server errechnet, eine Unterschrift außer der
  Reihe und ein abgeschlossener Vorgang sind ein Konflikt für genau diese Unterschrift, damit sie
  nie still auf einen anderen Stand übertragen wird. Gegengezeichnet wird mit dem Recht "Aufträge
  abnehmen und Rundgänge gegenzeichnen". Ein Gerät hält dafür auch die Mängel, die in seinen
  Vorgängen festgestellt wurden. Das Fundament ist auf opengewerk/opengewerk#520 angehoben
- Formulare und Vorlagen der Pakete werden ganz gelesen (#28, ADR 0005): jedes Feld in der Form,
  die die Formular-Engine des Fundaments liest, und danach die Prüfung der Engine selbst, unter
  dem Schlüssel und der Fassung aus dem Dateinamen. Dazu kennt die Engine den Prüfpunkt mit "in
  Ordnung", "nicht in Ordnung", "entfällt" und "nicht möglich" und den Zählerstand; die
  Haustechnik bindet sie mit Grad Celsius für Messwerte und den drei Einheiten eines Zählers, und
  ein Feld darf auf eine Anlage oder einen Raum zeigen, in einem Paket aber nicht, weil erst eine
  Instanz weiß, welche es gibt. Ein Grenzwert nennt eine Regel, die es gibt und die in einer
  passenden Einheit zählt. Das Probepaket hat ein Formular zur Ablesung des Wasserzählers bekommen.
  Das Fundament ist auf opengewerk/opengewerk#522 angehoben
- Eine Vorschau ohne Anmeldung (#29): `pnpm run preview` legt in einer eigenen Datenbank einen
  erfundenen Beispielbetreiber mit zwei Bereichen, Liegenschaften, Gebäuden, Geschossen, Räumen und
  Anlagen an und beantwortet jede Anfrage als eine seiner Personen, damit Oberflächen ohne Konto
  und Passwort geprüft werden. Mit `PREVIEW_ROLE` und `PREVIEW_AREA` startet sie als eine andere
  Rolle in einem Bereich; Rechte und Bereiche wirken wie auf einer Instanz, als Haustechnik in Nord
  zeigt sie nichts aus Süd. Sie läuft nur auf diesem Rechner, nie in Produktion und nie gegen eine
  Datenbank, deren Name nicht auf `_preview` endet, und kommt nicht in das Abbild. Dazu der CI-Job
  "Breiten und Auflösungen", der jede Seite beider Einstiege gegen die Vorschau bei jeder Breite
  von 320 bis 3840 Pixeln misst, hell und dunkel, mit dem Werkzeug des Fundaments
- Die Hülle der Haustechnik (#83): die Navigation des Büros steht einmal als Liste, wie die Tafel
  "Navigation mit dem Pfad" sie zeichnet, mit der Übersicht vorn, darunter "Bestand", "Pflichten"
  und "Arbeit" und dem Katalog am Fuß vor "Abgleich" und "Einstellungen"; vor Ort sind es die
  Reiter Start, Scannen und Aufnehmen vor "Konflikte" und "Menü". Ein Eintrag erscheint, sobald
  unter seiner Adresse ein Bildschirm steht, und nur für den, der sein Recht hat. So sieht jede
  Rolle nur, was sie öffnen darf, der Objektleitung und der Haustechnik fehlen die Fristen, und
  wer einen Bildschirm baut, trägt seine Route ein und nichts an der Navigation. Bis der erste
  Bildschirm kommt, zeigt die Navigation deshalb weiter nur ihren Fuß. Der Pfad über einer Seite
  an einem Ort wird einmal gesagt: Liegenschaft, Gebäude, Geschoss, Raum und Anlage, soweit die
  Seite darunter steht, im Büro ab der Liste der Liegenschaften und vor Ort ab der Liegenschaft,
  mit denselben Wörtern. Wie ein Raum in einer Zeile heißt, steht dafür einmal im Modell, und die
  Bezeichnung einer Frist liest dieselbe Funktion. Das Fundament ist auf
  `opengewerk/opengewerk#550` angehoben, das dem Rahmen des Büros eine Gruppe ohne Titel und
  eigene Einträge am Fuß gibt und dem Einstieg vor Ort den Pfad
- Routen für Bereiche, Bereiche je Zugang und Vertretungen (#84, erster Teil; ADR 0003): bisher
  standen Bereiche nur in der Datenbank, und wer in welchem arbeitet, ließ sich nur dort ändern.
  Jeder, der Orte sieht, liest die Bereiche, in denen er arbeitet. Die Leitung legt Bereiche an,
  benennt sie um und entfernt einen, sobald er leer ist; die Route verlegt seine Liegenschaften
  auf Wunsch vorher in einen anderen, mit allem darunter, und der letzte Bereich bleibt. Wer nur
  in dem entfernten arbeitete, hat danach keinen und sieht nichts mit Ortsbezug, gesperrt wird
  niemand. Je Zugang gilt "alle" oder die genannten Bereiche, für Leitung und Technische Leitung
  immer alle; geschrieben wird nur, was sich ändert, und das Gerät der Person lässt beim nächsten
  Abgleich fallen, was sie nicht mehr sieht. Eine Vertretung gilt vom ersten bis zum letzten Tag,
  gezählt in Deutschland, und endet sofort, wenn sie beendet wird. Die Bildschirme dazu folgen
- Die Bereiche stehen mit der Einladung fest und werden mit einem Rollenwechsel in einem Zug
  gespeichert (#84; ADR 0003, Migration `0014_invitation_areas`). Bisher trug eine Einladung nur
  die Rolle: die Bereiche ließen sich erst nennen, wenn die Person beigetreten war, und bei mehr
  als einem Bereich sah eine neue Kollegin zuerst eine leere Liste. Jetzt sagt eine Einladung
  "alle Bereiche" oder die genannten, und wer sie einlöst, arbeitet von der ersten Anfrage an
  darin. Wird ein genannter Bereich inzwischen entfernt, geht er aus der Einladung; nannte sie nur
  diesen, hat die Person nach dem Beitritt keinen. Mit einem Rollenwechsel gehen die genannten
  Bereiche in derselben Anfrage mit, und passt beides nicht zusammen, wird nichts gespeichert,
  auch die Rolle nicht. Wer ohne ein Wort zu Bereichen Leitung oder Technische Leitung wird,
  bekommt alle; wer es nicht mehr ist, behält sie, bis seine Bereiche genannt sind.
  `GET /areas/invitations` nennt, was die offenen Einladungen dazu sagen. Eine Anfrage, die
  nichts zu Bereichen sagt, wird genommen wie bisher. Das Fundament ist dafür auf
  `opengewerk/opengewerk#552` angehoben, das eine Anwendung bei Einladung, Beitritt und
  Rollenwechsel in seiner Transaktion mitschreiben lässt
- Die Liegenschaften im Büro, der erste Bildschirm der Tafeln (#85, erster Teil). Bisher gab es
  Liegenschaften nur als Daten und Routen. Die Liste unter `/liegenschaften` zeigt jede
  Liegenschaft mit Anschrift und ihren Gebäuden darunter, nach Namen geordnet; wer mehr als einen
  Bereich sieht, grenzt auf einen ein, unter 1024 Pixeln hat die Liste eine eigene Suche, und auf
  dem Telefon ist jede Liegenschaft eine Karte. Die Seite einer Liegenschaft zeigt Anschrift,
  Bundesland, Notiz und ihre Gebäude mit Gebäudeart und Baujahr, mit dem Knopf "Änderungen" für
  die Leitung. Anlegen, Ändern und Entfernen stehen für Leitung und Technische Leitung auf eigenen
  Seiten; beides braucht eine Verbindung, und das Formular sagt das, bevor jemand tippt. Geändert
  wird nur, was sich geändert hat, und entfernt wird nach einer Rückfrage, die sagt, was mitgeht.
  Liste und Seite liest das Gerät aus dem Abgleich, sie stehen auch ohne Netz. Wer nur einen
  Bereich sieht, liest und wählt keinen. Was die Tafeln mehr zeichnen, kommt mit dem, was es
  zeigt: die Zahlen je Liegenschaft und Gebäude mit der Reihenfolge nach Dringlichkeit (#121), der
  Import (#100), Fotos (#97), Gebäude anlegen (#86), die Zeitachse (#123) und die Ansprechpartner
  mit den nächsten Teilen von #85. Das Fundament ist dafür auf `opengewerk/opengewerk#553`
  angehoben: das Formular über einem Datensatz kennt ein Feld über mehrere Zeilen, den Platz
  eines Felds im Raster und das Sternchen am Pflichtfeld, die schmale Spalte einer Seite steht auf
  Wunsch links, eine leere Liste steht als Baustein für sich, und eine Auswahlliste zeigt, was das
  Formular hält
- Eine Liegenschaft hat eine Notiz zu dem, was man vor dem Weg dorthin wissen muss (#85,
  Migration `0015_property_note` mit Rücknahme, Planungskonzept v0.9, Nachtrag in ADR 0002). Die
  Tafel "Neue Liegenschaft" zeichnet sie, das Datenmodell hatte sie nicht. Ein Text oder keiner,
  höchstens 2000 Zeichen, die Zeilen bleiben Zeilen. Ein Code gehört nicht hinein, und das Formular
  sagt es: die Notiz liegt auf jedem Gerät, das die Liegenschaft hält, und jede Änderung steht im
  Änderungsprotokoll. Die Rücknahme der Migration leert die Notizen vorher, damit das Protokoll des
  Betreibers sagt, dass sie gingen
- Die Ansprechpartner einer Liegenschaft (#85, vierter Teil; Migration `0016_contacts` mit
  Rücknahme, Planungskonzept v0.10, Nachträge in ADR 0002 und 0006). Abschnitt 4.1 des Konzepts
  führt sie, die Tafel "Liegenschaft" zeichnet ihre Karte, und bisher gab es sie nicht. Ein
  Ansprechpartner hängt an einer Liegenschaft und liegt in deren Bereich: Vorname, Nachname,
  Funktion, Telefon und E-Mail, nur der Nachname ist Pflicht. Auf der Seite der Liegenschaft
  steht die Karte unter der Anschrift, je Person eine Zeile, Nummer und Adresse zum Antippen.
  Leitung und Technische Leitung fügen hinzu, berichtigen und entfernen, mit Verbindung wie bei
  der Liegenschaft selbst, und die Karte sagt das, bevor jemand tippt; Objektleitung und
  Haustechnik lesen. Die Ansprechpartner reisen auf jedes Gerät, das die Liegenschaft hält, und
  ein Gerät schreibt keinen. Eine entfernte Liegenschaft nimmt ihre Ansprechpartner mit, die
  Rückfrage sagt es, und zieht eine Liegenschaft in einen anderen Bereich, ziehen sie mit. Das
  Änderungsprotokoll einer Liegenschaft zeigt, was mit ihren Ansprechpartnern geschah. Tabelle,
  Regeln, Routen und die Karte sind die des Fundaments, das dafür auf `opengewerk/opengewerk#554`
  und `#559` angehoben ist; diese Anwendung sagt, woran ein Ansprechpartner hängt, wer ihn pflegt
  und wie ihre Wörter heißen
- Die Schließzeiten eines Gebäudes, unterhalb der Oberfläche (#86, erster Teil; Migration
  `0017_building_closures` mit Rücknahme, Planungskonzept v0.11, Nachträge in ADR 0002 und 0006).
  Abschnitt 4.1 des Konzepts gibt einem Gebäude Zeiten, in denen kein Rundgang entsteht, und
  bisher gab es dafür keine Stelle. Eine Schließzeit reicht von einem Tag bis zu einem Tag, beide
  eingeschlossen, und nennt auf Wunsch ihren Anlass. Sie hängt an ihrem Gebäude, liegt im Bereich
  seiner Liegenschaft und geht mit dem Gebäude, wenn es entfernt wird. Eingetragen und entfernt
  wird sie an den Routen unter `/buildings/:id/closures`, von allen, die Vorgänge planen und
  verteilen, also auch von der Objektleitung; lesen kann sie, wer das Gebäude sieht. Geändert wird
  keine: eine falsche wird entfernt und neu eingetragen. Die Schließzeiten reisen auf jedes Gerät,
  das das Gebäude hält, und ein Gerät schreibt keine. Ob ein Gebäude an einem Tag geschlossen ist,
  beantwortet `closureOn` in `domain`; der Plan eines Rundgangs fragt es mit #113. Die Karte auf
  der Seite des Gebäudes folgt, sobald ihre Tafel freigegeben ist
- Die Seiten eines Gebäudes, eines Geschosses und eines Raums im Büro (#86, zweiter Teil). Abschnitt 4.1 des
  Konzepts gibt jedem Ort eine eigene Seite und eine eigene Adresse, und bisher endete der Weg bei der
  Liegenschaft. Die Seite eines Gebäudes sagt, als was es genutzt wird, sein Baujahr und seinen Bereich, und
  zählt je Geschoss die Räume und die Anlagen, die darin stehen; was im Gebäude und in keinem Raum steht, zählt
  eine eigene Zeile. Die Seite eines Geschosses listet seine Räume nach ihrer Nummer, E.2 vor E.10. Die
  Raumseite zeigt die Anlagen, die im Raum stehen, mit ihrem Zustand am heutigen Tag, und darunter die Anlagen,
  die ihn versorgen, ohne in ihm zu stehen, mit dem Ort, an dem sie stehen; eine Anlage, die das ganze Gebäude
  versorgt, versorgt jeden seiner Räume. Der Pfad führt von der Liegenschaft herunter, auf dem Telefon steht an
  seiner Stelle der Weg eine Ebene zurück, und in der Navigation leuchtet "Liegenschaften". Alle drei Seiten
  liest das Gerät aus dem Abgleich, auch ohne Netz
- Die Formulare für Gebäude, Geschoss und Raum im Büro (#86, dritter Teil). Unterhalb einer Liegenschaft ließ
  sich bisher nichts anlegen, ändern oder entfernen; ein Gebäude kam nur über die Schnittstelle hinein. Ein
  Gebäude bekommt Bezeichnung, Kürzel, Baujahr und eine oder mehrere Gebäudearten zum Ankreuzen, ein Geschoss
  Bezeichnung und Ebene, ein Raum Nummer, Bezeichnung und Nutzung. Gebäude und Geschoss pflegen Leitung und
  Technische Leitung, mit Verbindung, und das Formular sagt es, bevor jemand tippt. Einen Raum legt an und
  berichtigt, wer Räume aufnimmt, also jede der vier Rollen, über den Postausgang und damit auch ohne Netz.
  Entfernt wird nach einer Rückfrage, die sagt, was mitgeht; eine Anlage mit Nachweis bleibt, und dann bleibt
  auch der Ort, mit dem Satz des Servers. Ein Raum zieht über "In ein anderes Geschoss verlegen" um: angeboten
  werden die Geschosse seiner Liegenschaft und, solange Anlagen in ihm stehen, nur die seines Gebäudes, mit
  dem Grund dazu. Was das Gerät nicht wissen kann, eine längst entfernte Anlage, die den Raum noch nennt, sagt
  der Server, und sein Satz steht in der Rückfrage
- Die Karte "Schließzeiten" auf der Seite eines Gebäudes im Büro (#86, vierter Teil). Schließzeiten gab es seit
  dem ersten Teil nur an der Schnittstelle; jetzt stehen sie dort, wo jemand das Gebäude ansieht. Die Karte
  listet, was gerade läuft und was kommt, vom frühesten Tag an und mit dem Anlass; was vorbei ist, steht hinter
  "Frühere anzeigen", und eine Schließzeit, die heute endet, zählt noch. Wer Vorgänge plant und verteilt, also
  auch die Objektleitung, trägt über "Hinzufügen" eine ein und entfernt eine nach einer Rückfrage, beides mit
  Verbindung an den Routen des Gebäudes; die Karte sagt es, wenn keine da ist. Wer nur liest, sieht die Zeiten
  und keinen Knopf. Geändert wird keine: eine falsche wird entfernt und neu eingetragen
- Die Leitung berichtigt Name und E-Mail eines Kontos an der Schnittstelle (#84; Migration
  `0018_account_corrections`). Bisher ließ sich ein Tippfehler im Namen oder eine geänderte Adresse nur von
  der Person selbst oder gar nicht beheben. Die Route `PATCH /staff/:userId/account` kommt mit dem neuen Stand
  des Fundaments, hinter dem Recht, Zugänge zu verwalten. Jede Berichtigung ist eine Zeile des Betreibers in
  der neuen Tabelle `account_corrections` und steht damit in seinem Änderungsprotokoll, mit dem Wert vorher
  und nachher; geändert oder gelöscht wird eine solche Zeile nicht. Arbeitet das Konto auch für einen anderen
  Betreiber der Instanz oder gehört es zu ihrer Verwaltung, lehnt die Route ab und sagt, dass dann nur die
  Person selbst ändert: ein Betreiber soll nicht umschreiben, was auch einem anderen gehört. Der Bildschirm
  dazu folgt mit "Zugänge"
- "Zugänge" im Büro zeigt und ändert die Bereiche eines Zugangs und führt die Vertretungen (#84, siebter
  Teil). Bisher ließen sich Bereiche und Vertretungen nur an der Schnittstelle pflegen, und der Bildschirm
  kannte nur Rollen. Jetzt hat ein Zugang eine Rolle und wird in einem Dialog angelegt und bearbeitet, mit
  dem Bildschirm des Fundaments dafür: Name und E-Mail, die Rolle mit einem Satz, wofür sie da ist, die
  Bereiche ("Alle Bereiche" oder die genannten zum Ankreuzen) und die Geräte. Die Spalte "Bereiche" nennt
  für jeden Zugang und jede offene Einladung "alle", die Namen oder "ohne Bereich"; steht jemand ohne Bereich
  da, sagt der Satz darunter, was das heißt. Leitung und Technische Leitung haben immer alle, die Auswahl
  steht dann still. Ein neuer Zugang beginnt so, wie die Datenbank ihn ohne Wahl anlegen würde: mit dem einen
  Bereich eines Betreibers, der nur einen hat, sonst mit keinem, und dann sagt der Dialog, was das bedeutet.
  Die Karte "Vertretungen" listet, wer wen von wann bis wann vertritt und welche Bereiche dadurch
  dazukommen. "Vertretung anlegen" prüft mit den Regeln des Modells, bevor etwas gesendet wird, und sagt
  vorher, was die Vertretung bedeutet; beendet wird sie nach einer Rückfrage. Die Vorschau hat dafür sechs
  weitere Zugänge, eine offene Einladung und eine Vertretung
- "Bereiche" unter den Einstellungen (#84, achter Teil): der Bildschirm, auf dem ein Betreiber seine
  Bereiche anlegt, umbenennt und entfernt. Bisher ging das nur an der Schnittstelle, und niemand sah an
  einer Stelle, welche Liegenschaften zusammengehören und wer sie sieht. Die Tabelle nennt je Bereich, wie
  viele Liegenschaften und Gebäude in ihm liegen, bis zu fünf Liegenschaften beim Namen und die Zugänge,
  für die er genannt ist. "Entfernen" fragt, wohin die Liegenschaften vorher verlegt werden, und verlegt
  sie im selben Schritt mit allem, was an ihnen hängt; die Rückfrage nennt, wer danach keinen Bereich mehr
  hat. Ein Bereich ohne Liegenschaften geht, wie er ist; kennt der Server dort noch entfernte
  Liegenschaften, zeigt der Dialog dessen Satz und fragt dann ebenfalls, wohin. Der letzte Bereich bleibt
  und hat kein "Entfernen". Ein Name wird mit den Regeln des Modells geprüft, bevor etwas gesendet wird.
  Nach jeder Änderung fragen die Bildschirme die Bereiche neu, und wo Liegenschaften umgezogen sind, holt
  der Abgleich sie mit ihrem neuen Bereich aufs Gerät. Die Kachel "Zugänge" nennt jetzt auch Bereiche und
  Vertretungen. In der Vorschau ist die Leitung für keinen Bereich mehr eigens genannt, so wie die Routen
  es bei jemandem halten, der alle hat: sonst stünde sie in der neuen Liste unter jedem Bereich
- Verfahrensbeschreibung für den Stand von Phase 1, von Hand geschrieben (#140), unter
  `docs/verfahrensbeschreibung/`: damit eine Arbeitnehmervertretung vor dem Parallelbetrieb in der Hand
  hat, welche Daten über Beschäftigte wo stehen, wer sie sieht, welche Auswertungen es gibt und welche
  nicht, was sich einschalten lässt, wie lange aufbewahrt wird und was das Änderungsprotokoll festhält.
  Jede Aussage nennt ihre Stelle im Konzept, jede Zusage einen Test. Was das Konzept zusagt und diese
  Fassung noch nicht hält, steht in einem eigenen Abschnitt: im Änderungsprotokoll wird nichts geschwärzt,
  nichts wird nach einer Frist gelöscht, der Stempel eines Datensatzes reist mit jeder Antwort mit, und die
  Zeile einer Sitzung hält die Netzadresse der Anmeldung. `processing-description.test.ts` im Serverpaket
  hält das Dokument gegen den Quelltext: jeder Beleg in Anhang A muss stimmen, Anhang B nennt jede Spalte,
  die auf eine Person zeigt, Anhang C jede Adresse, die der Server beantwortet. Ein Baustein, der eines von
  beiden bringt, wird rot, bis das Dokument ihn nennt, und so wird es berichtigt, wenn sich an seinen
  Aussagen etwas ändert. Dazu ein Test am Gang über die Routen: eine Route, die eine Person im Pfad nennt,
  verlangt ein Recht der Zugänge
- Der Katalog im Büro und auf dem Gerät (#90): damit ein Betreiber nachlesen kann, worauf sich ein
  Vorschlag stützt, und ein Gerät im Keller mit denselben Einträgen rechnet wie sein Server. Der Server
  liefert den Katalog unter `GET /catalogue` aus und nennt unter `GET /catalogue/checksum` seine
  Prüfsumme, beide mit dem Recht `sync.read`. Ein Gerät holt ihn einmal, hält ihn in der lokalen Ablage,
  auch ohne Netz, und holt ihn erst wieder, wenn der Server eine andere Prüfsumme nennt; die Oberfläche
  bringt den Katalog nicht selbst mit (Nachträge in ADR 0005 und ADR 0006). "Katalog" zeigt die Pakete
  mit ihrer Fassung und wie viele ihrer Einträge abgenommen sind, und je Paket Pflichtarten,
  Anlagenarten, Formulare, Regeln und Vorlagen für Rundgänge. Die Seite einer Pflichtart nennt Herkunft,
  Fundstelle, Verbindlichkeit, Frist, Qualifikation, Nachweis, Aufbewahrung und Geltungsbereich, dazu
  ihre Regeln mit dem Zeitraum, in dem jede gilt. Kein Eintrag steht ohne seine Prüfung und Abnahme da:
  jede Zeile sagt "Abgenommen" oder "Nicht abgenommen" und den Tag der letzten Prüfung gegen die Quelle,
  und wo die mehr als ein Jahr zurückliegt, steht das dabei. Die Kennzeichnungen stehen an einer Stelle
  für beide Einstiege (`app/review-marks.tsx`), damit Vorschläge, Anlagenakte und Protokoll sie in
  denselben Worten bekommen
- "Anlagen" im Büro: das Anlagenverzeichnis über alle Gebäude und die Akte einer Anlage (#87). Das
  Verzeichnis kommt seitenweise vom Server (`GET /assets`) und wird dort eingegrenzt, nach Standort,
  Kostengruppe, Anlagenart, Zustand und Lebenszyklus, damit auch einige tausend Anlagen nie auf einmal
  im Browser liegen; wonach eingegrenzt ist, steht in der Adresse und lässt sich weitergeben. Der
  Zustand einer Anlage (Mangel offen, nie geprüft, überfällig, fällig, in Ordnung, dazu "ruht" und
  "ohne Pflichten") wird bei jedem Lesen aus ihren Pflichten, deren Nachweisen und ihren offenen
  Mängeln abgeleitet und nie gespeichert (`assetStandingOn` in `packages/domain`). Der Server rechnet
  ihn an einer Stelle, aus der auch die Fristen ihre Termine nehmen, damit Frist, Zustand einer Pflicht
  und Zustand einer Anlage nie drei Geschichten erzählen. Die Akte unter `/anlagen/<id>` zeigt
  Stammdaten mit den Angaben der Anlagenart, Standort und Versorgungsbereich, Komponenten, den
  Lebenszyklus ganz und die Pflichten mit letztem Nachweis, nächstem Termin und Zustand
  (`GET /assets/:id/duties`); die Pflichten einer stillgelegten Anlage stehen als ruhend da. Die Seite
  eines Gebäudes zählt seine Anlagen nach Kostengruppe und führt von jeder Zahl ins Verzeichnis dieses
  Gebäudes. Die Vorschau bringt dafür Pflichten, Nachweise und einen offenen Mangel mit
- Eine Anlage im Büro anlegen und ändern, mit Dubletten-Prüfung (#88). Das Formular unter
  `/anlagen/neu` und `/anlagen/<id>/bearbeiten` zeigt die Felder der gewählten Anlagenart in der
  Fassung, die heute gilt, dazu die Pflichtarten, die der Katalog für sie führt, und für einen Zähler
  Nummer und Einheit; eine Komponente entsteht unter `/anlagen/<id>/komponenten/neu` im Gebäude ihrer
  Anlage. Ob es die Anlage schon geben kann, sagt eine Regel in `packages/domain`
  (`asset-duplicate.ts`: gleiche Seriennummer oder gleiches Kennzeichen, ohne Rücksicht auf
  Leerzeichen und Großschreibung) und fragt die Route `GET /assets/duplicates`, damit Büro, Import
  und Gerät dasselbe fragen und dieselbe Anlage nennen. Die Dublette wird genannt und nie abgelehnt:
  zwei Geräte einer Baureihe können dieselbe Nummer tragen, und wer die Anlage eingibt, entscheidet.
  An der Akte stehen "Verlegen", "Versorgung ändern", "Komponente hinzufügen" und am Lebenszyklus
  "Eintragen" und das Zurücknehmen eines Eintrags, im Formular "Anlage entfernen". Lebenszyklus,
  Verlegen und Entfernen bekommt nur angeboten, wer Anlagen pflegt, weil sie über den Datensatz
  hinaus wirken (Abschnitt 7 des Konzepts: aufnehmen und pflegen). Geschrieben wird an den Routen des
  Servers, mit Verbindung, weil Verzeichnis und Akte von dort kommen; eine allgemeine Anlagenart des
  Pakets "Allgemein" (#61) trägt den Hinweis, dass ihr Fachpaket noch fehlt
- Das Paket "Allgemein" unter `pakete/allgemein/` (#61), das erste Paket des Katalogs: je
  Kostengruppe der technischen Anlagen eine allgemeine Anlagenart, 410 bis 490 nach der zweiten Ebene
  der DIN 276 (Ausgabe 2018-12), ohne Merkmale, ohne Felder und ohne Pflichtarten, mit Bezeichnungen
  in eigenen Worten. Es ist der Auffang für jede Anlage, die kein Fachpaket beschreibt, damit Import
  und Bestandsaufnahme den ganzen Bestand erfassen, auch Heizung, Lüftung und Aufzüge, deren Pakete
  später kommen; die zweite Ebene reicht, weil Anlagenverzeichnis und Lagebild auf ihr sortieren. Der
  Bau lehnt jede Pflichtart ab, die eine allgemeine Anlagenart in ihrem Geltungsbereich nennt, damit
  eine Anlage, die noch niemand eingeordnet hat, nie eine Pflicht vorgeschlagen bekommt. Abgenommen
  hat niemand etwas, und der Katalog sagt es an jedem Eintrag
- Mängelklassen im Paketformat (#61, entschieden mit #59): ein Paket nennt seine Klassen in
  `mangelklassen.json`, mit Bezeichnung, der Angabe, ob ein Mangel der Klasse die Anlage unsicher
  macht, und auf Wunsch der Fundstelle, in der Reihenfolge, in der sie zur Wahl stehen. Jede Klasse
  hat wie eine Regel ihren Eintrag in `abnahmen.json`, mit der Prüfsumme ihres Datensatzes. Das Paket
  "Allgemein" bringt die drei allgemeinen Stufen gering, erheblich und gefährlich mit, für jeden
  Mangel, der nicht aus einer Prüfung kommt; nur "gefährlich" macht eine Anlage unsicher. Der Katalog
  beantwortet `defectClass` und `defectClasses`, das Büro zeigt unter "Katalog" je Paket den Teil
  "Mängelklassen", und das Format des Bündels ist 3. Das Format entsteht hier und nicht erst mit den
  Mängeln, weil das Paket, das die allgemeinen Klassen trägt, zuerst gebaut wird
- Dateispeicher und Renderer des Fundaments sind gebunden (#96). Phase 1 braucht beide für Dokumente,
  Etiketten und das PDF eines Nachweises, und gebunden waren sie mit Absicht noch nicht. Der Server nimmt
  den Inhalt einer Datei unter `PUT /files/<prüfsumme>` an, von dem, der Dokumente ablegen darf, legt ihn
  im Volume `files` unter seiner Prüfsumme ab und schreibt die Zeile, die ihn zur Datei des Betreibers
  macht. Eine Datei, die nach ihren ersten Bytes weder Bild noch PDF ist, wird als Download vermerkt, was
  immer sie von sich behauptet. Nach der Prüfsumme ausgegeben wird nichts: gelesen wird über den Datensatz,
  der eine Datei nennt, und der kommt mit den Dokumenten. Der Renderer ist ein Dienst in
  `docker/compose.yaml`, von Haus aus an (`COMPOSE_PROFILES=renderer` in der Vorlage der `.env`, dazu
  `RENDERER_TOKEN`), mit demselben Abbild und derselben Prüfsumme wie im Fundament; der Server reicht ihn
  an alles, was druckt, und sagt ohne ihn in einem Satz, dass kein PDF entsteht. Eine bestehende `.env`
  bekommt die beiden Zeilen beim nächsten `sh docker/start.sh`. Die Vorschau hat einen Dateispeicher in
  einem Ordner je Start und den Renderer, den ihre Umgebung nennt
- Das Recht "Dokumente ablegen" (`document.record`) für alle vier Rollen (#96), wie am 04.10.2026
  entschieden. Es kommt vor "Dokumente ansehen" und "Dokumente entfernen", weil der Dateispeicher eine
  Datei unter ihm annimmt, bevor ein Datensatz sie nennt
- Die Läufe auf einem Stapel halten beides fest (#96). "Betrieb über Docker Compose" prüft, dass der
  Renderer der des Fundaments ist, dass er mit dem Stapel läuft und dass im Container der Anwendung ein
  PDF entsteht (`docker/test-renderer.sh`). "Sicherung und Rückspielen" legt eine Datei als angemeldetes
  Konto über die Route ab und findet sie nach dem Rückspielen mit ihrer Zeile und ihrem Inhalt wieder.
  "Neben OpenGewerk auf einem Server" startet die Haustechnik mit ihrem Renderer und prüft, dass nach dem
  Entfernen kein Container von ihr bleibt
- Das Pflichtenverzeichnis im Büro (#101, Abschnitt 4.3 des Konzepts) unter `/pflichten`: alle Pflichten des
  Betreibers mit Anlage oder Ort, Fundstelle, Frist, verantwortlicher Person, Ausführendem, letztem Nachweis,
  nächstem Termin und Zustand. Die Liste kommt seitenweise vom Server (`GET /duties/register`) und wird dort
  eingegrenzt, nach Zustand, Liegenschaft oder Gebäude, Anlagenart, Pflichtart und verantwortlicher Person;
  der Filter steht in der Adresse. Der Zustand jeder Zeile ist der aus `dutyStateOn`, am Tag der Abfrage
  gerechnet und an derselben Stelle wie der Termin der Fristen-Engine, damit Liste, Akte und Frist nie drei
  Geschichten erzählen. "Nie erfasst" steht vor "überfällig", weil niemand weiß, seit wann eine solche
  Pflicht fällig ist. Eine Pflicht, die geendet hat, steht in einer eigenen Liste "Beendet": sie verlangt
  nichts mehr, und die Akte ihrer Anlage zeigt sie nicht
- Die Seite einer Pflicht (`/pflichten/<id>`, #101): ihr nächster Termin, ihre Nachweise, ihre Herkunft aus dem
  Katalog mit der bestätigten Fassung oder ihre eigene Quelle, ihre Frist mit Art, Höchstfrist und Begründung,
  wer verantwortlich ist und wer ausführt, und woran sie hängt. Die Nachweise liest `GET /duties/:id/evidence`
  mit dem Recht "Nachweise ansehen"; ein ersetzter und ein für ungültig erklärter bleiben in der Liste und
  sagen es, und die Liste nennt keine Person. Der Name einer Pflicht in der Anlagenakte führt jetzt auf diese
  Seite, auch bei einer eigenen Pflicht, die bisher keinen Link hatte
- Wer für eine Pflicht verantwortlich ist, wählt das Büro (#101): wer das Pflichtenverzeichnis führt, benennt
  auf der Seite der Pflicht eine Person, die für den Betreiber arbeitet und nicht gesperrt ist, oder nimmt
  sie wieder weg. Die Namen dafür liefert `GET /duties/colleagues` nur diesen beiden Rollen. Eine Pflicht ohne
  verantwortliche Person steht ohne Filter in der Liste, und eine Zeile über der Liste zählt sie und führt zu
  ihnen: das Konzept verlangt, dass sie angezeigt wird, statt still weiterzulaufen. Die Pflichtenübertragung
  mit Unterschrift kommt mit Phase 2
- Die Karte "Pflichten an diesem Raum" auf der Raumseite (#101) mit den Pflichten, die am Raum selbst hängen
  (`GET /rooms/:id/duties`), und auf der Seite einer Pflichtart im Katalog die Karte "Bei diesem Betreiber" mit
  der Zahl der bestätigten Pflichten und dem Weg zu ihnen im Pflichtenverzeichnis; die Zahl zählt das
  Verzeichnis selbst, damit sie und die Liste nicht auseinanderlaufen
- Dokumente mit Fassungen (#97, Abschnitt 4.10 des Konzepts, Migration `0019_documents`): die Ablage des
  Fundaments (`opengewerk#567`), gebunden an die Datensätze der Haustechnik. Ein Dokument hängt an seiner
  Liegenschaft und dort an höchstens einem Gebäude, Raum, einer Anlage oder einem Vorgang, hat eine
  Bezeichnung und auf Wunsch eine der sechs Arten des Konzepts. Eine neue Fassung legt sich über die alte,
  und jede bleibt abrufbar: eine Fassung wird einmal geschrieben und von niemandem geändert. Entfernt wird
  markiert, nie gelöscht, und ein entfernter Datensatz nimmt seine Dokumente mit. Vertrag und Fremdfirma als
  Ort, die Gültigkeit und die Soll-Dokumente kommen mit Phase 2
- Die Datei einer Fassung gibt der Server über die Fassung aus (`GET /attachments/versions/:id/content` und
  `/preview`), nie über ihre Prüfsumme, und nur an den, der sieht, woran das Dokument hängt: beim eigenen
  Betreiber und in den Bereichen der Person. Eine Datei, die nach ihren ersten Bytes weder Bild noch PDF ist,
  wird als Anhang ausgeliefert und nie in der Seite angezeigt, was auch immer sie zu sein behauptet. Das war
  der offene Rest aus #96
- Die Rechte "Dokumente ansehen" (`document.read`) und "Dokumente entfernen" (`document.remove`) neben
  "Dokumente ablegen": ansehen und ablegen alle vier Rollen, entfernen ab der Objektleitung, wie am 04.10.2026
  entschieden. Wer ablegen darf, legt auch eine neue Fassung ab und berichtigt Bezeichnung und Art. Planungskonzept
  v0.13
- Der Bildschirm "Dokumente" im Büro (`/dokumente`): alle Dokumente mit Art, woran sie hängen, Fassung und Tag
  der letzten Änderung, eingrenzbar nach Art und nach dem, woran ein Dokument hängt, beides in der Adresse;
  daneben die Fassungen des gewählten Dokuments, jede zu öffnen. Dazu die Karte "Dokumente" in der Anlagenakte,
  auf der Raumseite und an der Liegenschaft, und die Dialoge zum Hochladen, Bearbeiten und Entfernen. Die
  Bildschirme nennen den Tag, an dem eine Fassung abgelegt wurde, und weder die Person noch die Uhrzeit; wer
  abgelegt hat, steht im Änderungsprotokoll der Leitung, das zu einem Dokument auch seine Fassungen nennt
- Abgelegt wird im Büro wie vor Ort über den Dateispeicher und den Abgleich: die Datei geht ihrem Datensatz
  voraus, ein Foto wird auf dem Gerät verkleinert und bekommt eine Vorschau, und was ohne Netz abgelegt wurde,
  wartet auf dem Gerät und hängt nach dem Abgleich an seiner Anlage. Ein Gerät hält die Dokumente seiner
  Bereiche mit ihren Fassungen, die Zeilen und nie die Dateien; Unterlagen für unterwegs kommen mit Phase 2.
  Die Seite einer Anlage vor Ort mit dem Knopf für das Foto kommt mit der Bestandsaufnahme (#99)
- Eine Fassung trägt keinen Bereich, sondern fragt ihr Dokument (Nachtrag vom 06.10.2026 in ADR 0003): ein
  Auslöser des Fundaments lehnt jede Änderung an einer Fassung ab, auch die, mit der ein Bereich seiner
  Liegenschaft folgt, und mit einer Bereichsspalte an der Fassung ließe sich eine Liegenschaft mit Dokumenten
  nicht mehr verlegen. Die Katalogprüfung der Bereiche kennt diese eine Ausnahme und verlangt dafür die Policy
  der Fassung
- Die Vorschau hat Dokumente am Schulzentrum: eines an der Liegenschaft, eines am Schulhaus, einen Schaltplan
  mit drei Fassungen im Heizraum und am Aufzug eine Betriebsanleitung mit zwei Fassungen und ein Foto vom
  Typenschild. "Sicherung und Rückspielen" legt ein Dokument an der Anlage an und holt seine Datei nach dem
  Rückspielen über die Fassung
- Etiketten mit QR-Code für Anlagen und Räume (`#98`, Abschnitte 3 und 4.2 des Konzepts). An der Anlagenakte und an der
  Raumseite steht die Karte "Etikett": sie legt ein Etikett an, druckt es für den Etikettendrucker oder als Bogen A4 ab
  einem freien Feld und sperrt es. Am Anlagenverzeichnis und am Gebäude druckt "Etiketten drucken" je gelisteter Anlage
  oder je Raum ein Etikett und legt fehlende an, höchstens 240 auf einmal, oder einen Bogen ohne Anlage für die
  Bestandsaufnahme. Vor Ort liest der Reiter "Scannen" ein Etikett mit der Kamera, auch ohne Netz, und im Browser führt die
  Adresse auf dem Etikett zur Akte oder zur Raumseite; ein Etikett von einer früheren Adresse der Instanz öffnet weiter,
  weil nur der Pfad zählt. Der Code steht einmal in der ganzen Instanz, eine Anlage und ein Raum haben höchstens ein
  gültiges Etikett, und ein gesperrtes öffnet nichts mehr, auch nicht für die Leitung. Ein Etikett außerhalb der eigenen
  Bereiche nennt weder Anlage noch Raum: auf die Frage nach einem Code antwortet der Server mit einem Wort. Gebaut, weil die
  Bestandsaufnahme vor Ort (`#99`) Etiketten klebt und jede Anlage über ihr Etikett gefunden werden soll; der Baustein
  dafür liegt seit `opengewerk#570` im Fundament, das Submodul steht auf diesem Stand. Migration `0020_labels`, kein
  neues Recht (Anlagen und Räume aufnehmen). Das Zuordnen eines Etiketts vom Bogen zu einer Anlage kommt mit `#99`
- Bestandsaufnahme vor Ort (`#99`, Abschnitte 4.1, 4.2 und 2.7 des Konzepts). Vor Ort gibt es den Reiter "Aufnehmen" und
  je eine schlichte Seite für Liegenschaft, Gebäude, Geschoss, Raum und Anlage, jede unter dem Pfad wie im Büro und aus den
  Zeilen des Geräts gelesen, also auch ohne Netz. Ein Raum und eine Anlage werden auf dem Telefon aufgenommen und gehen in
  den Postausgang: die Anlage mit Anlagenart, Raum, Hersteller, Typ, Seriennummer, Baujahr und den Angaben ihrer Art, ohne
  Nummer, bis der Server sie gesehen hat. Die Seriennummer liest die Kamera vom Strichcode des Typenschilds, das Typenschild
  wird fotografiert und wartet ohne Netz auf dem Gerät, und ein Etikett vom Bogen wird der Anlage zugeordnet, einmal und
  endgültig. Trägt eine Anlage des Geräts schon dieselbe Seriennummer, zeigt das Formular sie, bevor etwas angelegt wird. Der
  Server prüft beim Abgleich gegen alle Anlagen des Betreibers, auch über die Grenze der Bereiche, und macht eine mögliche
  Dublette, die die Person nicht gesehen hat, zu einem Konflikt auf dem Gerät: die Karte zeigt die Anlage, die es schon gibt,
  soweit das Gerät sie hält, und fragt "Ist dieselbe Anlage" oder "Trotzdem anlegen"; Foto und Etikett derselben Aufnahme
  gehen mit der Entscheidung. Der Scan eines Etiketts führt vor Ort jetzt auf die Seite der Anlage oder des Raums vor Ort
  statt ins Büro. Gebaut, weil die Bestandserfassung die größte Hürde vor dem ersten Rundgang ist: sie soll im Gebäude
  geschehen, mit einer Hand und ohne Netz. Migration `0021_stock_taking`, kein neues Recht (Räume und Anlagen aufnehmen,
  Dokumente ablegen). Das Fundament nimmt dafür seit `opengewerk#571` die Karte eines Konflikts von der Anwendung, das
  Submodul steht auf diesem Stand. Wie eine Pflicht steht, sagt vor Ort der Server, mit Verbindung; die letzten Nachweise
  kommen mit `#109`, "Mangel melden" mit `#116`

- Der Import aus Tabellen (`#100`, Abschnitte 3 und 11 des Konzepts): Liegenschaften, Gebäude, Geschosse und Räume unter
  "Liegenschaften", Anlagen unter "Anlagen", je hinter dem Knopf "Importieren". Eine Excel-Arbeitsmappe oder CSV-Datei wird
  gewählt, ihre Spalten werden Feldern zugeordnet (vorgeschlagen nach den Namen der Spalten), die Vorschau zeigt, was die
  Zeilen anlegen würden, welche zu klären sind und was es schon gibt, und ein Knopf übernimmt alles oder nichts. Bis dahin
  wird nichts geschrieben und die Datei nicht gespeichert. Für Anlagen kommt ein Schritt dazwischen, "Anlagenarten
  zuordnen": jede Bezeichnung der Liste bekommt einmal eine Anlagenart des Katalogs, der Betreiber behält die Zuordnung für
  den nächsten Import, und was kein Fachpaket kennt, bekommt die allgemeine Anlagenart seiner Kostengruppe. Trägt eine Zeile
  die Seriennummer oder das Kennzeichen einer Anlage, die es gibt, oder einer früheren Zeile, entscheidet, wer importiert,
  für jede: nicht anlegen oder trotzdem anlegen; ohne die Entscheidung wird nichts übernommen. Orte werden am Namen
  wiedererkannt, nie doppelt angelegt und nie geändert. **Ein Import steht als ein Eintrag im Änderungsprotokoll**, mit
  Datei, Zeilenzahl und Ergebnis, statt mit einem Eintrag je Feld jedes Raums: die Migration `0022_imports` bringt dafür die
  Tabelle `imports`, und die Trigger des Protokolls an Liegenschaften, Gebäuden, Geschossen, Räumen und Anlagen schweigen
  genau in der Transaktion, die die Zeile ihres Imports selbst geschrieben hat. Die Nummern der Anlagen zieht die
  Übernahme in einem Schritt, sodass daneben eine Änderung am Nummernkreis steht und nicht eine je Anlage
  (`opengewerk#574`). Die Verfahrensbeschreibung sagte bisher zu, dass jede Änderung Feld für Feld im Protokoll steht;
  sie nennt den Import jetzt in Abschnitt 8 als Ausnahme mit eigener Zusage und in 3.11, was von einem Import bleibt.
  Gebaut, weil der Bestand eines Betreibers
  heute in Listen steht und der Weg von dort Teil des Produkts ist (Abschnitt 11); derselbe Weg dient der Übernahme aus einer
  Vorgängeranwendung (`#130`). Kein neues Recht: den Bestand importiert, wer Liegenschaften pflegt, Anlagen und
  Anlagenarten, wer Anlagen pflegt, und beide nur in die Bereiche, die sie sehen. Das Format steht in
  `docs/import/Tabellen.md`, im ersten Schritt gibt es je eine Vorlage. Tabellen liest das Fundament seit `opengewerk#573`,
  ohne ein weiteres Paket; das Submodul steht auf dem Stand von `opengewerk#574`. Die Hinweise unter "Neue Liegenschaft" und "Neues Gebäude"
  nennen den Import jetzt, wie die Tafeln es zeichnen. Was nur eine Anlagenart hat, liest der Import nicht; Fristen und alte
  Nachweise kommen mit `#130`

- Eine eigene Pflicht im Büro anlegen (#103): das Formular "Eigene Pflicht" unter `/pflichten/neu` mit Bezeichnung,
  Tätigkeit, Grundlage und Quelle, Frist und Zählweise, verantwortlicher Person und wer ausführt. Es öffnet sich aus dem
  Pflichtenverzeichnis und über "Pflicht hinzufügen" aus der Karte "Pflichten" einer Anlagenakte und einer Raumseite und bietet
  den Ort an, von dem es kommt, und jeden darüber: Anlage, Raum, Gebäude oder Liegenschaft. Aus dem Verzeichnis fragt es
  nach Liegenschaft und Gebäude. Ohne Quelle sendet es nichts, und der Server lehnt eine eigene Pflicht ohne Quelle
  ebenso ab. Anlegen kann nur, wer das Pflichtenverzeichnis führt; den anderen Rollen steht der Knopf nicht da. Gebaut,
  weil ein Betreiber Pflichten hat, die kein Paket kennt: die Vorgabe eines Herstellers, eine Auflage, eine Forderung des
  Versicherers, eine eigene Festlegung (Abschnitt 4.3 des Konzepts), und weil eine Anlage mit allgemeiner Anlagenart
  sonst gar keine Pflicht tragen könnte. Eine Aufgabe, die regelmäßig wiederkommt, wird genauso angelegt (4.8)
- Eine eigene Pflicht nennt ihre Tätigkeit (#103): Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle oder
  Probenahme, aus derselben Liste wie eine Pflichtart des Katalogs. Die Migration `0023_own_duty_task` gibt `duties` die
  Spalte `task`. `POST /duties` verlangt sie für eine eigene Pflicht, `PATCH /duties/:id` ändert sie und nimmt sie nicht
  weg; eine Pflicht aus dem Katalog nennt keine und nimmt sie von ihrer Pflichtart. Gebraucht wird sie, sobald aus einem
  fälligen Termin ein Vorgang entsteht (#105): der muss wissen, ob er eine Prüfung oder eine Wartung ist. Eine eigene
  Pflicht aus der Zeit vor der Spalte hat keine Tätigkeit, und ihre Seite nennt dann keine. Das Planungskonzept sagt es
  seit v0.14 (2.3, 4.3), ADR 0002 in einem Nachtrag
- Eine Pflicht beenden (#103): der Knopf "Beenden" auf der Seite einer Pflicht, für wen das Pflichtenverzeichnis führt,
  mit dem Tag, heute oder einem anderen, und auf Wunsch einem Grund. Die Route dafür stand seit #25 ohne Bildschirm. Der
  Dialog sagt vorher, was ein Ende heißt und dass es nicht zurückgenommen wird
- Die Seite eines Nachweises im Büro (#109) unter `/nachweise/<id>`: der eingefrorene Stand mit Herkunft, Pflicht, Frist,
  Ort und Anlage, wer die Arbeit ausgeführt oder geprüft hat, Ergebnis, Belege und Aufbewahrung, dazu die Unterschriften, der
  Fingerabdruck, die Mängel aus dem Stand und was der Nachweis für die Frist heißt. Ein ersetzter oder für ungültig erklärter
  Nachweis bleibt lesbar und sagt es, mit Person, Zeitpunkt und Grund. Die Nummer eines Nachweises ist überall ein Link
  dorthin: auf der Seite einer Pflicht, im Pflichtenverzeichnis und in den Karten "Pflichten" an Akte und Raum. Gebaut,
  weil erst die Seite eines Nachweises zeigt, wer geprüft, unterschrieben und eingetragen hat; die Listen nennen niemanden
- Einen Nachweis berichtigen und für ungültig erklären (#109): `POST /evidence/:id/correction` mit Grund, Tag, Ergebnis
  und bei einem Bericht Prüfer und Organisation, und `POST /evidence/:id/voiding` mit Grund, je mit einem Dialog auf der
  Seite des Nachweises, für Leitung, Technische Leitung und Objektleitung. Eine Berichtigung ist ein neuer Nachweis, der den
  alten nennt, und trägt keine Unterschrift; nach einer Ungültigerklärung ist die Pflicht fällig, als hätte es den Nachweis
  nicht gegeben. Beides wird nicht zurückgenommen, und ein ersetzter oder für ungültig erklärter Nachweis bietet keines
  mehr an. Die Wege standen seit #26 im Server ohne Route; ADR 0004 in einem Nachtrag
- Die Nachweise einer Anlage (#109): `GET /assets/:id/evidence` listet die Nachweise jeder Pflicht an der Anlage, der
  jüngste zuerst, mit Pflicht und dem, was er für die Frist heißt, ohne eine Person. Die Akte zeigt sie in der Karte
  "Nachweise", die Seite der Anlage vor Ort die letzten drei, mit Verbindung
- Die Liste "Fristen" im Büro (#104, #75) unter `/fristen`: was fällig wird, nach Fälligkeit, mit der Pflicht, der Anlage
  oder dem Ort samt Liegenschaft, wer verantwortlich ist und wann erinnert wird. Sie blättert auf dem Server und grenzt
  nach Stand, Art, Liegenschaft, Bereich (für wen mehr als einen sieht), Person und Suche ein. Eingegrenzt auf eine Person
  nennt sie keine Zahl, wie das Pflichtenverzeichnis. Die Navigation zählt neben "Fristen" die überfälligen. Dazu unter
  "Einstellungen", "Fristen" Vorlauf und Person je Art. Beides für Leitung und Technische Leitung. Die Fristen liefen seit
  #25 im Server ohne Bildschirm; ein Betreiber hat vom ersten Tag an ein paar tausend, deshalb blättert das Fundament die
  Liste jetzt auf dem Server (`opengewerk#575`), und das Submodul ist darauf angehoben. Verfahrensbeschreibung Abschnitte
  4 und 5 (B97)
- Prüfungen und Wartungen aus einem fälligen Termin (#105): beginnt der Vorlauf eines Termins, legt die Fristen-Engine
  einmal je Termin eine Prüfung oder Wartung an, bei der Person, die für die Frist verantwortlich ist, an der Stelle der
  Pflicht und fällig am Tag des Termins. Aus einer Wartung wird eine Wartung, aus jeder anderen Tätigkeit eine Prüfung;
  eigene oder fremde Durchführung übernimmt der Vorgang von der Pflicht (Planungskonzept v0.15, Spalte `performer`,
  Migration `0024_activity_performer`). Im Büro die Liste "Prüfungen" unter `/pruefungen`, auf dem Server geblättert und
  nach Stand, Art, Liegenschaft und Suche eingegrenzt, und die Seite eines Vorgangs mit seinen Pflichten, ihrem Zustand und
  Ergebnis. Wer plant und verteilt (Leitung, Technische Leitung, Objektleitung), legt fest, wer verantwortlich ist, wer
  ausführt oder welche Fremdfirma, und den Tag, unter Personen, die den Bereich sehen; wer nur ausführt, sieht, was ihm
  oder niemandem zugeteilt ist. Der Termin rückt dabei nicht weiter, erst mit dem Nachweis. Der Vorgang stand seit #26
  im Datenmodell ohne Route. Verfahrensbeschreibung Abschnitte 3, 4 und 5 (B98 bis B102)
- Den Bericht einer Fremdfirma als Nachweis eintragen (#110): im Büro unter `/nachweise/bericht/<pflicht>`, erreichbar
  über "Bericht eintragen" auf der Seite einer Pflicht und einer offenen Prüfung, die eine Fremdfirma ausführt. Datei,
  Prüfer, Organisation, Tag der Prüfung, Ergebnis und die Mängel daraus; mit dem Festschreiben entsteht der Nachweis
  (`POST /duties/:id/report`), die Datei liegt als Prüfbescheinigung an der Anlage oder dem Ort der Pflicht, die Mängel
  stehen dort, und eine offene Prüfung der Pflicht ist erledigt. Der nächste Termin zählt vom Tag der Prüfung. Für
  Leitung, Technische Leitung und Objektleitung. Gebaut, weil Prüfungen durch Sachverständige und Fachfirmen der größte
  Teil der Nachweise eines Betreibers sind (Planungskonzept v0.16, ADR 0004 in einem Nachtrag)
- Ein Nachweis gibt die Dateien, auf die er sich stützt, selbst aus (#110): `GET /evidence/:id/files/<n>` für jeden, der
  ihn sieht, und die Seite eines Nachweises verlinkt sie unter "Belege". So bleibt der Bericht am Nachweis lesbar, auch
  wenn jemand sein Dokument aus der Ablage nimmt. Verfahrensbeschreibung Abschnitte 3.5, 3.6 und 3.9 (B103 bis B106)
- Mängel im Büro und vor Ort (#116): die Liste "Mängel" unter `/maengel`, auf dem Server geblättert und nach Stand
  (offen, über der Frist, nachgeprüft), Liegenschaft, Bereich und Klasse eingegrenzt, auch "ohne Klasse"; die Seite eines
  Mangels mit seinem Stand von festgestellt bis nachgeprüft, Herkunft, Ort, Klasse, Frist, Fotos und dem Auftrag daraus;
  ein Mangel von Hand unter `/maengel/neu`, auch aus der Akte einer Anlage; "Mangel melden" vor Ort an Anlage und Raum,
  mit Bemerkung und Foto, ohne Netz über den Postausgang. Melden darf jede Rolle; Klasse, Frist und die Nachprüfung
  setzen Leitung, Technische Leitung und Objektleitung (`POST /defects`, `PATCH /defects/:id`,
  `POST /defects/:id/check`). Nachgeprüft wird nur ein behobener Mangel; findet die Nachprüfung ihn nicht behoben, steht
  er wieder auf "festgestellt". Der Abschnitt "Mängel" in der Akte einer Anlage und "Offene Mängel" auf der Seite eines
  Raums im Büro. Gebaut, weil ein Mangel bisher nur als Zeile entstand und niemand ihn sah, einstufte oder abschloss
  (Planungskonzept v0.17, ADR 0002 und 0005 in Nachträgen, Migration `0025_defects_kept`)
- Die Vorgabe der Frist je Mängelklasse unter "Einstellungen", "Mängelklassen" (#116): je Klasse der Pakete die Tage bis
  zur Beseitigung, gezählt ab dem Tag der Feststellung, für die Leitung. Eine Klasse ohne Frist nimmt die Vorgabe, im
  Formular und am Server, auch für einen Mangel aus einem Bericht. Abschnitt 4.6 des Konzepts lässt die Vorgabe den
  Betreiber einstellen
- Die Frist zur Beseitigung eines Mangels ist eine Quelle der Fristen (#116): die Art "Frist zur Beseitigung eines
  Mangels" mit sieben Tagen Vorlauf erinnert die Leitung, solange der Mangel festgestellt oder beauftragt ist, und
  steht in der Liste "Fristen" mit dem Mangel als Verweis. Die Navigation zählt neben "Mängel", wie viele über ihrer
  Frist sind. So verlangt es Abschnitt 2.4 des Konzepts
- Ein Foto hängt an einem Mangel (#116): ein Dokument nennt den Mangel als seinen Ort, im Büro wie vor Ort, auch ohne
  Netz, und wird mit ihm markiert, wenn er entfernt wird
- Der Vergleich der Pakete mit `main` meldet eine gemergte Mängelklasse, die fehlt (#116): Mängel nennen ihre Klasse
  beim Schlüssel, eine entfernte ließe sie ins Leere zeigen (ADR 0005, Nachtrag zu #61)
- Antworten je Punkt (#106): `activity_answers` hält die Antwort auf jeden Punkt des Formulars eines Vorgangs als
  eigene Zeile, damit zwei Leute an verschiedenen Punkten nicht kollidieren und am selben Punkt ein Konflikt entsteht
  (Abschnitt 2.7). Ein Vorgang nennt das Formular, das er ausfüllt, mit seiner Fassung; eine Prüfung aus einem fälligen
  Termin nimmt das ihrer Pflichtart. Unterschrieben wird erst, wenn jeder Punkt seine Antwort hat, und mit der
  Unterschrift wird ein Prüfpunkt "nicht in Ordnung" und ein Messwert außerhalb seines Grenzwerts ein Mangel
  (Abschnitt 4.5). Die Seite, die unterschrieben wird, nennt die Antworten, der Nachweis friert sie in Fassung 3 seines
  Stands ein, und danach ändert keine Rolle eine Antwort (`HT007`). Migration `0026_answers_per_point`, Nachträge in
  ADR 0002, 0004 und 0006, zwei Aussagen in Abschnitt 3.5 der Verfahrensbeschreibung
- Eine Prüfung oder Wartung mit Grund schließen und von Hand anlegen (#183): auf der Seite eines
  Vorgangs "Nicht durchgeführt" mit Grund (`POST /activities/:id/close`), solange er offen oder
  begonnen ist; jede seiner Pflichten nimmt "nicht durchgeführt" mit demselben Grund als Ergebnis,
  ein Nachweis entsteht nicht und der Termin bleibt, wie er ist. Auf der Seite einer Pflicht ohne
  laufenden Vorgang "Prüfung anlegen" oder "Wartung anlegen" (`POST /activities`), angelegt wie aus
  dem Termin und fällig am nächsten Termin; die Seite einer Pflicht nennt den laufenden Vorgang mit
  dem Weg zu ihm. Beides kann, wer Vorgänge plant und verteilt. Wer den Vorgang eines Termins
  schloss, hatte bisher keinen Weg zu einem neuen, und die Pflicht stand überfällig da, ohne dass
  jemand dran war. Planungskonzept v0.18 (4.4), eine Aussage in Abschnitt 3.4 der
  Verfahrensbeschreibung
- Aufträge im Büro (#117, #73): die Liste "Aufträge" mit Nummer, Ort oder Anlage, Dringlichkeit,
  Frist, verantwortlicher Person und Stand, eingegrenzt nach Stand, Art und Bereich und nicht auf
  eine Person; die Seite eines Auftrags mit Ursprung, Beteiligten, Fotos von vor Ort, Unterschrift
  und Abnahme; ein neuer Auftrag aus einem festgestellten Mangel, aus dem Termin einer Pflicht oder
  von Hand, und seine Änderung, bis er unterschrieben ist (`/work-orders`). Ein Auftrag sagt, wie
  dringend er ist (normal, dringend, sofort), und nennt weitere Beteiligte, die ihn auf ihrem Gerät
  haben und nicht abschließen (Migration `0027_work_orders_in_the_office`). Der Mangel folgt
  seinem Auftrag: beauftragt beim Anlegen, behoben mit der Unterschrift, wieder beauftragt mit
  einer Zurückweisung; abgenommen schreibt ein Auftrag für einen Termin den Nachweis seiner
  Pflicht. Anlegen, ändern und vor der Unterschrift mit Grund als nicht durchgeführt schließen
  kann, wer Vorgänge plant und verteilt; der Mangel steht dann wieder auf "festgestellt".
  Abnehmen kann, wer Aufträge abnimmt. Mangel, Anlagenakte und Pflicht führen zum Auftrag. Bisher
  hatten Aufträge nur ihr Datenmodell, und ein Mangel kam über "festgestellt" nicht hinaus.
  Planungskonzept v0.19 (4.6, 4.8, 7), Nachträge in ADR 0002 und 0006, Abschnitte 3.4, 3.12, 4, 5
  und 9 der Verfahrensbeschreibung
- Das Formular eines Vorgangs vor Ort (#107): eine Übersicht mit den Abschnitten, ihren Punkten,
  der Antwort je Punkt und den beantworteten Pflichtpunkten (`/m/vorgaenge/<Vorgang>`), und jeder
  Punkt auf eigener Seite mit der Eingabe seiner Feldart: Prüfpunkt mit Bemerkung oder Grund und
  Foto, Messwert mit Grenzwert, Urteil und Fundstelle, Zahl, Zählerstand, Auswahl, Ja/Nein, Foto
  und Text, dazu was die Unterschrift aus der Antwort macht. Jede Eingabe ist sofort auf dem Gerät
  gesichert, auch ohne Netz und auch, wenn die Seite geschlossen wird; ein Block einer Gruppe wird
  vor Ort geöffnet. Die Bausteine kommen aus dem Fundament (`@opengewerk/platform-web/forms`).
  Seit #106 gab es die Antworten je Punkt im Datenmodell und im Abgleich, aber keinen Bildschirm,
  der sie gibt. In der Vorschau trägt eine Sichtprüfung der Zähleranlage ein Formular mit jeder
  Feldart aus einem Paket nur der Vorschau
- Die Prüfung vor Ort (#108): die Seite einer Anlage nennt unter "Zu erledigen" ihre offenen und
  begonnenen Prüfungen und Wartungen, die die eigenen Leute ausführen; eine mit Formular zeigt ihr
  Protokoll als eine Liste mit jedem Punkt und seiner Eingabe, eine ohne Formular gleich ihr
  Ergebnis. Das Ergebnis nimmt den Tag der Prüfung, eines der vier Ergebnisse, bei "nicht
  durchgeführt" den Grund, eine Bemerkung und die Mängel, auch einen hier gemeldeten, dann die
  Unterschrift für genau die Seite, die das Gerät hält. Alles geht ohne Netz durch den
  Postausgang, und die erste Eingabe setzt die Prüfung auf "begonnen". Unterschrieben wird erst,
  wenn jeder Pflichtpunkt eine Antwort hat, und nie "ohne Mangel", solange das Protokoll einen
  Mangel festhält; beides prüft auch der Server. Eine Unterschrift, die der Server nicht nimmt,
  hat unter den Konflikten eine eigene Karte. Das letzte Protokoll einer Anlage im selben Formular
  ist die Vorlage des nächsten: was die Definition übernehmen lässt, steht beim Anlegen schon
  als Antwort da, und das Protokoll nennt den Tag der Vorlage. Die Bemerkung zum Ergebnis steht
  im Nachweis (Fassung 4 des eingefrorenen Stands). Bisher gab es die Unterschrift nur über den
  Abgleich und keinen Bildschirm, der sie gibt
- Vorlagen der Rundgänge im Büro (#112): unter "Rundgänge" die Liste der Vorlagen des Betreibers
  mit Fassung, Gegenzeichnung und Zahl der Rundgänge, darunter die Vorlagen der Pakete zum
  Übernehmen und Anpassen. Der Editor führt Kapitel und Punkte jeder Art, die Einheit, einen
  Grenzwert aus einer Regel eines Pakets oder einen eigenen Wert mit Quelle, worauf ein Punkt
  zeigt und welche Pflicht er erfüllt. Punkte und Kapitel lassen sich am Griff verschieben, mit
  Maus, Finger oder Tastatur, auch von einem Kapitel in ein anderes. Jede Änderung wird eine neue
  Fassung, keine gespeicherte ändert sich, und ein Rundgang bleibt auf der Fassung, in der er
  begann. Editor und Server prüfen eine Fassung mit derselben Funktion und der Formular-Engine;
  eine abgelehnte nennt den Punkt und den Grund, und ein Punkt an einer Anlage, die es nicht mehr
  gibt, fällt vor dem Speichern auf. Ändern darf eine Vorlage nur, wer jede Anlage, jeden Raum und
  jede Pflicht sieht, auf die sie zeigt, mit dem neuen Recht "Vorlagen der Rundgänge führen" für
  Leitung, Technische Leitung und Objektleitung. Die Vorlagen reisen auf jedes Gerät, damit ein
  Rundgang ohne Netz in seiner Fassung ausgefüllt wird. Erfüllt ein Punkt eine Pflicht, nimmt ihr
  Nachweis das Ergebnis aus der Antwort und hält nur diesen Punkt fest, ohne zweite Erfassung.
  Bisher kannte der Katalog Vorlagen nur als Teil eines Pakets, und ein Betreiber konnte keine
  eigene führen
- Plan eines Rundgangs, Zuteilung und ein Rundgang je Durchgang (#113): ein Plan nennt Vorlage,
  Ort (eine Liegenschaft oder ein Gebäude darin), Rhythmus (täglich an den Wochentagen, die er
  nennt, wöchentlich an einem Wochentag, monatlich oder jährlich an einem Tag), Vorlauf, ersten und
  letzten Tag und die Person, die seine Rundgänge geht, oder alle im Bereich. Die Fristen-Engine
  hat die Quelle "Rundgänge nach Plan" (Art `round.due`): sie legt jeden Durchgang als eigenen
  Rundgang an, einmal, zwei Wochen im Voraus, damit das Büro die nächste Woche vorher zuteilen kann;
  zwei Läufe zugleich legen keinen zweimal an, das hält auch ein eindeutiger Index. In den
  Schließzeiten des Gebäudes entsteht kein Rundgang, und eine neue Schließzeit nimmt die Rundgänge
  ihrer Tage zurück, die noch niemand begonnen hat. Ein Plan ruht und endet, und ändert er sich,
  entfallen die Rundgänge ab heute, die er nicht mehr verlangt; ein begonnener oder vergangener
  bleibt. Ein Rundgang nimmt die neueste Fassung seiner Vorlage, mit ihrer Gegenzeichnung und je
  Punkt, der eine Pflicht erfüllt, diese Pflicht; eine neue Fassung gilt ab dem nächsten Rundgang,
  der noch nicht begonnen ist. Unter "Rundgänge" steht jetzt die Übersicht der Woche nach Gebäude,
  mit einem Durchgang je Tag und seinem Stand, dem Zuteilen je Plan und Woche und "Wie letzte Woche
  zuteilen"; darunter die Pläne. Ein Rundgang, der niemandem zugeteilt ist, liegt auf den Geräten
  aller im Bereich. Bisher gab es Vorlagen, aber nichts, das aus ihnen Rundgänge machte
- Der Rundgang vor Ort, ohne Netz von der ersten Antwort bis zur Unterschrift (#114): der Start
  zeigt der Person, die das Gerät hält, ihre Rundgänge und Aufträge von heute und dieser Woche und
  die, die niemandem zugeteilt sind, den begonnenen oben mit seinem Fortschritt und ohne Netz mit
  der Zahl der Antworten, die noch auf dem Gerät liegen; ein Rundgang einer späteren Woche steht ab
  dem Vorlauf seines Plans unter "Später". Der Kopf eines Rundgangs nennt Tag und Gebäude, ein
  Punkt, der eine Pflicht erfüllt, sagt es unter seiner Frage, und "entfällt" und "nicht möglich"
  sagen, dass die Pflicht dann fällig bleibt. Der letzte Punkt führt zur Abgabe, die nennt, was
  noch fehlt, und erst dann die Unterschrift öffnet, für genau die gezeigte Seite und über den
  Postausgang; danach sagt der Rundgang, ob er auf die Gegenzeichnung wartet und welche Mängel
  aus ihm folgen. Auf dem Tablet quer stehen Liste und Rundgang nebeneinander. Bisher begann das
  Gerät bei den Konflikten, und einen Rundgang abzugeben ging nicht
- Die Rundgänge im Büro (#115): jeder Durchgang der Wochenübersicht führt zu seinem Rundgang, und
  unter der Woche stehen die offenen und begonnenen Rundgänge früherer Wochen, bis sie jemand mit
  Grund als nicht durchgeführt schließt; das kann, wer Vorgänge plant und verteilt, für einen
  Rundgang eines vergangenen Tages, und der Rundgang bleibt danach mit dem Grund lesbar und erfüllt
  keine Pflicht. Die Seite eines Rundgangs zeigt nach der Unterschrift jede Antwort mit dem, was
  dazu gesagt wurde und was daraus folgt, die Unterschrift, die Pflichten mit ihrem Nachweis und
  die Mängel. Wer Rundgänge gegenzeichnet, tut es dort im Feld des Fundaments, für die Seite, wie
  sie gezeigt wurde, über eine eigene Route; erst dann entstehen die Nachweise. Bisher wartete ein
  Rundgang nach der Unterschrift vor Ort ohne Weg auf die Gegenzeichnung, und ein vergangener blieb
  nur als Zahl stehen
- Der Auftrag vor Ort (#118): seine Seite nennt Ort, Anlage, Ursprung, Frist und wer ihn führt,
  dazu Notizen als eigene Einträge mit Person und Uhrzeit, Fotos und die Dauer als Aufwand des
  Auftrags; ist er eine Prüfung oder Wartung, führt er zu seinem Protokoll. Abschließen mit der
  Unterschrift kann nur, wer den Auftrag führt, auf dem Gerät wie auf dem Server; die weiteren
  Beteiligten schreiben Notizen, machen Fotos und tragen die Dauer ein. Eine Notiz ändert und
  löscht danach niemand, auch nicht in der Datenbank. Alles geht ohne Netz durch den Postausgang.
  Notizen und Dauer stehen auch auf der Seite des Auftrags im Büro und auf der Seite, die
  unterschrieben wird. Bisher landete ein Auftrag vor Ort auf der Seite des Ergebnisses, ohne
  Notizen und Dauer, und unterschreiben konnte jeder, der ihn sah
- Zähler im Büro (#119): die Liste "Zähler" nennt je Messstelle den letzten Stand und ob der
  Stand zum Stichtag vorliegt, fehlt, stillgelegt oder gesperrt ist, mit dem Unterzähler unter
  seinem Hauptzähler. Die Seite einer Messstelle zeigt die Stände mit dem Verbrauch bis zum
  Stichtag und den Verlauf über 12 oder 24 Monate neben dem Vorjahr. Ein Stand wird von Hand
  eingetragen und durch einen neuen mit Grund berichtigt; geändert und gelöscht wird er nie, auch
  nicht in der Datenbank. Der Verbrauch wird abgeleitet und nie gespeichert und rechnet über einen
  Zählertausch und eine Stilllegung hinweg. Ablesen dürfen alle Rollen; Zählertausch,
  Stilllegung, Sperre, Notiz, Wandlerfaktor, Hauptzähler und die Kennung in der Leittechnik ändert,
  wer Anlagen pflegt. Eine gesperrte Messstelle nimmt keinen Stand an und sagt warum. Bisher war
  ein Zähler nur eine Anlage mit Nummer und Einheit, ohne Stände
- Ablesung vor Ort (#120): eine eigene Runde liest die Zähler einer Liegenschaft ab, jeder mit
  dem Stand des Vormonats daneben, und hält jeden Stand sofort auf dem Gerät, auch ohne Netz. Ein
  Punkt "Zählerstand" eines Rundgangs, der eine Messstelle nennt, zeigt Vormonat und Zählernummer
  und schreibt den Stand erst mit der Unterschrift an die Messstelle. Ein Stand unter dem letzten
  wird nicht angenommen; einer, der um ein Vielfaches springt, warnt und wird erst nach "So
  übernehmen" genommen, auf dem Gerät, im Büro und auf dem Server gleich. Den Stichtag stellt der
  Betreiber unter "Einstellungen", "Zähler" ein, eine Messstelle kann davon abweichen. Zwei
  Ablesungen für denselben Stichtag sind ein Konflikt. Die Fristen-Engine kennt die Quelle
  "Zählerablesung zum Stichtag", eine Frist je Liegenschaft, und der Start vor Ort nennt die
  Liegenschaften, deren Stände fällig sind. Bisher kam ein Stand nur von Hand im Büro, immer zum
  Monatsersten
- Erinnerung an die Prüfung gegen die Quelle (#95): Der Workflow "Katalog prüfen lassen" läuft
  jeden Montag, fragt dieselbe Auswertung wie die Bildschirme (`reviewMarks`) einen Monat voraus und
  hält ein Issue mit allen Einträgen, deren Prüfung bald ein Jahr zurückliegt oder es schon tut; ein
  späterer Lauf schreibt es fort, statt ein zweites zu öffnen, und ohne fälligen Eintrag tut er
  nichts. Bisher fiel ein alter Eintrag erst auf, wenn jemand seine Kennzeichnung sah
- PDF aus dem eingefrorenen Stand (#111): "PDF öffnen" auf der Seite eines Nachweises und eines
  abgeschlossenen Rundgangs. Das PDF entsteht beim ersten Abruf aus dem Stand, der mit der
  Unterschrift eingefroren wurde, liegt danach im inhaltsadressierten Speicher und ist bei jedem
  Abruf dieselbe Datei, was auch immer sich an Anlage, Vorlage oder Konto ändert. Ein Nachweis,
  der danach für ungültig erklärt wird, wird einmal neu gedruckt, mit der Erklärung; Altbestand
  trägt den Vermerk der Vorgängeranwendung. Ein Rundgang wird dafür mit der Unterschrift im
  Ganzen eingefroren, auch einer, der keine Pflicht erfüllt, und der Stand eines Nachweises hält
  seit Fassung 5 die Zeichnung jeder Unterschrift. Hat die Instanz keinen Dienst, der PDFs
  erzeugt, sagt die Seite das in einem Satz. Bisher gab es kein PDF, und eine spätere Ausgabe
  hätte die laufenden Daten lesen müssen
- Gesetzliche Feiertage im Plan eines Rundgangs (#200): Das neue Paket `feiertage` hält die
  zwölf gesetzlichen Feiertage von Baden-Württemberg als Regeln mit Fundstelle und Gültigkeit, elf
  aus § 1 FTG und den 3. Oktober aus dem Einigungsvertrag, in den Einheiten `month_day` und
  `days_from_easter` des Fundaments (`opengewerk#586`). Ein Plan kann sie mit "Gesetzliche
  Feiertage auslassen" auslassen; ein Durchgang an einem Feiertag fällt dann aus und wird nicht
  verschoben, wie in einer Schließzeit, beim Anlegen, bei einer Änderung und in der Fristen-Engine.
  Für ein Land, für das der Katalog keine Feiertage hält, bietet der Plan die Wahl nicht an, und der
  Server lehnt sie ab. Bisher zählte ein Feiertag wie jeder Tag
- Das Paket "Elektro" unter `pakete/elektro/` (#91), das erste Fachpaket des Katalogs: sieben
  Anlagenarten (elektrische Anlage, ortsfestes und ortsveränderliches Betriebsmittel,
  Fehlerstrom-Schutzeinrichtung, Sicherheitsbeleuchtung, Sicherheitsstromversorgung,
  Blitzschutzanlage), 13 Pflichtarten aus § 5 der DGUV Vorschriften 3 und 4 mit den Richtwerten
  ihrer Durchführungsanweisungen und aus § 4 Abs. 3 ArbStättV, die drei Formulare, die ohne
  Stromkreis auskommen (ortsveränderliche Betriebsmittel, Prüftaste der
  Fehlerstrom-Schutzeinrichtung, Sicherheitsbeleuchtung), und drei eigene Mängelklassen. Weil
  die beiden Vorschriften verschiedene Richtwerte haben, steht jede Prüfung einmal je Vorschrift
  im Paket, und der Betreiber verwirft die, die für ihn nicht gilt. Formulare messen dafür jetzt
  auch in Ω, MΩ und mA. Jeder Eintrag ist am 10.10.2026 gegen seine Quelle geprüft und wartet auf
  die fachkundige Abnahme; Verweise auf private Normen kommen als neue Fassung. Bisher hatte der
  Katalog keine einzige Pflichtart, und die Vorschläge aus #102 hätten nichts vorschlagen können
- Barrierefreiheit in der CI (#132): Die Prüfung "Breiten und Auflösungen" hält jede Art von Seite
  auch an die Regeln der Barrierefreiheit, mit axe-core aus dem Fundament (`opengewerk#587`) nach
  WCAG 2.1 in den Stufen A und AA und den bewährten Regeln: Beschriftungen, Rollen, Reihenfolge
  der Überschriften, Landmarks und Kontrast, hell und dunkel, am Telefon und am Desktop. Ein
  Bedienelement ohne Beschriftung macht sie rot. Was der erste Gang über die 155 Arten von Seiten
  fand, ist behoben: die Wochentage im Plan heißen für den Bildschirmleser "Montag" und zeigen
  "Mo", "Mängel" spricht die Zahl so, wie sie dasteht, und die künftigen Schritte eines Mangels
  haben genug Kontrast. Bisher prüfte nichts davon eine Maschine
- Unterschrift ohne Schriftzug (#209): Neben dem Feld zum Unterschreiben steht "Ohne Schriftzug
  unterschreiben", vor Ort an Rundgang, Prüfung und Auftrag und bei der Gegenzeichnung im Büro.
  Die Person tippt ihren Namen, wie er im Konto steht, und bestätigt damit die Seite, wie sie
  gezeigt wurde; einen anderen Namen nimmt der Server nicht, auch nicht vom Gerät ohne Netz. Der
  Weg geht mit der Tastatur allein. Eine Unterschrift hat genau einen der beiden Wege (Spalte
  `typed_name`, Migration 0036), und der Stand eines Nachweises (Fassung 6), der eingefrorene
  Rundgang, ihre Seiten und das PDF sagen, welcher es war. Bisher ging eine Unterschrift nur mit
  dem Finger oder einem Stift, für manche Menschen eine Hürde, und per Tastatur gar nicht
- Übersicht der Betreiberverantwortung (#122) als Startseite des Büros: über alle Liegenschaften
  oder einen Bereich, wie viele Pflichten überfällig, in 30 und in 90 Tagen fällig und nie
  erfasst sind, wie vielen Prüfungen und Wartungen einer Fremdfirma der Bericht fehlt und wie
  viele Mängel über ihrer Frist sind, dazu die ersten davon. Jede Zahl führt auf ihre Liste und
  zählt mit deren Filter (Route `/overview`). Dafür lässt sich das Pflichtenverzeichnis nach
  "Fällig" (in 30 Tagen, in 90 Tagen, überfällig oder in 30 Tagen) und nach Bereich eingrenzen,
  und die Prüfungen nach "Bericht fehlt" und Bereich. Die Übersicht nennt keine Person. Bisher
  begann das Büro bei den Liegenschaften, und wer wissen wollte, was ansteht, musste mehrere
  Listen durchgehen
- Lagebild je Gebäude und die Zahlen über alle Liegenschaften (#121): Die Seite eines Gebäudes
  zeigt oben, was dort zu tun ist (überfällig, fällig, nie erfasst, offene Mängel, fehlende
  Zählerstände zum Stichtag), und unten die letzten Vorgänge mit ihrem Ergebnis, ohne Person.
  Die Liste der Liegenschaften nennt dieselben Zahlen je Liegenschaft und Gebäude, auf Wunsch
  nach Dringlichkeit geordnet. Jede Zahl führt auf ihre Liste und zählt mit deren Filter
  (Routen `/overview/places` und `/overview/buildings/:id`); Mängel und Zähler lassen sich dafür
  auf ein Gebäude eingrenzen. Bisher musste man für ein Gebäude die Listen einzeln öffnen, um
  zu sehen, was dort ansteht
- Zeitachse je Liegenschaft, Gebäude, Raum und Anlage (#123): was an einem Ort und darunter
  geschah, die neuesten Einträge zuerst, nach Monaten, seitenweise und nach Art eingrenzbar
  (Rundgänge, Prüfungen und Wartungen, Mängel, Aufträge, Nachweise). Gelesen wird aus
  Unterschriften, Entscheidungen über Aufträge, Vorgängen, Mängeln und Nachweisen (Route
  `/overview/timeline`); ein für ungültig erklärter Nachweis steht mit diesem Vermerk darin.
  Die Liegenschaft zeigt die neuesten Einträge in einer Karte, das Lagebild führt von den
  letzten Vorgängen dorthin, Raum und Anlage haben einen Knopf "Zeitachse". Sie nennt keine
  Person und reicht 1.500 Einträge zurück; eine Seite weiter hinten lehnt die Route ab, weil
  der Server sonst die ganze Geschichte eines Orts auf einmal läse und sortierte (Befund von
  Strix). Bisher gab es keinen Ort, an dem man sah, was an einem Gebäude über die Zeit geschah
- Eigene Pflicht im Büro bearbeiten und eine irrtümlich angelegte entfernen (#178): Die Seite
  einer eigenen Pflicht hat "Bearbeiten" für alle, die das Pflichtenverzeichnis führen. Das
  Formular ist das von "Eigene Pflicht" ohne die Wahl des Orts; Bezeichnung, Tätigkeit,
  Grundlage, Quelle, Frist, Verantwortlich und wer ausführt lassen sich ändern, gesendet wird
  nur, was sich geändert hat. Woran die Pflicht hängt und wie sie zählt, bleibt, und eine
  Pflicht ohne Tätigkeit bekommt hier ihre. Hat sie keinen Nachweis und keinen unterschriebenen
  Vorgang, steht dort "Pflicht entfernen" mit einer Rückfrage; die Seite liest das aus derselben
  Prüfung wie die Route (`removable` an `GET /duties/:id`). Eine Pflicht aus dem Katalog hat
  kein "Bearbeiten". Bisher ließ sich ein Tippfehler in der Quelle oder eine längere Frist nur
  beheben, indem man die Pflicht beendete und neu anlegte, und dabei ging der Bezug zu ihren
  Nachweisen verloren
- Vorschläge aus dem Katalog bestätigen oder verwerfen, je Anlage und im Stapel, und die Frist
  festlegen (#102): `GET /duties/proposals` rechnet bei jedem Lesen, welche Pflichtarten für
  eine Anlage in Frage kommen, nach Anlagenart, Merkmalen, Gebäudeart und Bundesland, ohne die
  bestätigten und die verworfenen; gespeichert wird kein Vorschlag, ein Berichtigen der
  Anlagenart wirkt deshalb sofort. Ein fehlendes Merkmal gilt als erfüllt, eine stillgelegte
  oder zurückgebaute Anlage bekommt keine. `POST /duties/batch` und `POST /duty-dismissals/batch`
  bestätigen oder verwerfen eine Pflichtart an vielen Anlagen in einer Transaktion: genau so
  viele Pflichten wie Anlagen oder keine. Im Büro die Liste unter `/pflichten/vorschlaege`
  nach Pflichtart gruppiert, mit "Nicht abgenommen" am Vorschlag und der Karte "Auswahl", die
  verworfenen mit "Zurücknehmen", das Formular "Pflicht bestätigen" mit Höchstfrist,
  Richtwert und Begründung und dasselbe als "Frist festlegen" über einer Pflicht aus dem
  Katalog, dazu die Wege vom Pflichtenverzeichnis, von der Anlagenakte und von der Pflichtart.
  Bisher ließ sich eine Pflicht aus dem Katalog nur über die Route bestätigen, und niemand sah,
  welche Pflichten eine Anlage nach dem Katalog hätte
- Verweis auf das Dokument, das die Frist trägt (#74): "Pflicht bestätigen" und "Frist
  festlegen" bieten unter der Begründung die Dokumente der Anlage, ihres Raums, ihres Gebäudes
  und ihrer Liegenschaft an, empfohlen und nicht verlangt. Die Pflicht merkt sich die neueste
  Fassung vom Tag, an dem der Verweis gesetzt wird (Migration `0037_interval_document`, mit
  Schlüsseln auf ein Dokument derselben Liegenschaft und eine Fassung dieses Dokuments).
  Kommt eine neuere Fassung dazu oder wird das Dokument aus der Ablage entfernt, sagt die
  Pflicht "Frist prüfen", auf ihrer Seite neben dem Zustand und im Pflichtenverzeichnis unter
  der Frist; wer "Frist festlegen" mit demselben Dokument speichert, hat geprüft, und die
  Pflicht zeigt auf die neueste Fassung. Setzen kann den Verweis, wer das Pflichtenverzeichnis
  führt und Dokumente ansieht; das Dokument nennt die Seite nur, wer Dokumente ansieht.
  Bisher stand in der Begründung nur als Text, worauf sich eine Frist stützt, und eine neue
  Gefährdungsbeurteilung änderte nichts an den Pflichten, deren Frist sie trägt
- Suche nach Name, Nummer und Kennzeichen (#125, Submodul `upstream/opengewerk` von `d22fbab` auf
  `98b2bae`, den Merge des Suchfelds aus opengewerk/opengewerk#596 auf `main`; dazwischen liegt
  nur opengewerk/opengewerk#595, `23990c5`, der Schreiber für xlsx und CSV): `GET /search?q=` findet Liegenschaften nach Name, Gebäude nach
  Name und Kürzel, Räume nach Nummer und Bezeichnung, Anlagen nach Anlagennummer, Name,
  Kennzeichen, Seriennummer und Zählernummer, Vorgänge nach Titel und Auftragsnummer und
  Nachweise nach ihrer Nummer, in der Transaktion der fragenden Person und damit nur in ihren
  Bereichen. Wer nur ausführt, findet von den Vorgängen, was ihm oder niemandem gegeben ist.
  Je Art höchstens fünf Treffer, das Genaueste zuerst; ob es mehr gibt, sagt die Antwort ohne
  Zahl, und kein Treffer nennt eine Person. Im Büro steht die Suche in der Kopfleiste (das
  Feld des Fundaments), vor Ort über dem Start: mit Netz fragt das Gerät den Server und findet
  im eigenen Bereich auch, was es nicht hält, das dann im Büro öffnet; ohne Netz sucht es in
  seinem Bestand und sagt es. "Scannen" verweist ohne Kamera auf die Suche am Start statt auf
  das Büro. Gemessen bei 6000 Anlagen, 1200 Räumen und 600 Aufträgen: 19 bis 28 ms je Anfrage
  im Mittel, ohne eigenen Index. Bisher fand man einen Ort, eine Anlage oder einen Auftrag nur
  über die Listen und ihre Filter, vor Ort gar nicht ohne Etikett
- Aufgaben an Ort, Anlage und Vorgang (#124, Submodul `upstream/opengewerk` von `98b2bae` auf
  `26908ae`, die Merges des Bausteins der Aufgaben aus opengewerk/opengewerk#598 und #599): eine
  Aufgabe hält fest, was zu tun ist, bis zu welchem Tag, wer für sie verantwortlich ist und ob
  sie erledigt ist. Sie hängt an einer Liegenschaft und auf Wunsch an einem Gebäude, einem Raum,
  einer Anlage oder einem Vorgang dort, liegt im Bereich ihrer Liegenschaft und reist über den
  Abgleich, im Büro wie vor Ort, auch ohne Netz (Migration `0039_tasks` mit Rücknahme). Drei
  neue Rechte in Abschnitt 7 des Konzepts (v0.22): "Aufgaben ansehen" und "Eigene Aufgaben
  anlegen und erledigen" für alle vier Rollen, "Aufgaben anderen zuteilen" ab der
  Objektleitung. Eine Aufgabe geht nur an jemanden, der Aufgaben erledigen darf, nicht gesperrt
  ist und den Bereich sieht; wen das in jedem Bereich ist, sagt `GET /tasks/candidates` dem,
  der zuteilt. Wer sie anlegte, schreibt die Datenbank, nie das Gerät. Ein Gerät hält die
  Aufgaben seiner Person und die, die sie anlegte; wer alle Bereiche sieht, hält alle. Im Büro
  stehen die Liste "Aufgaben" mit "Ihre Aufgaben" und "Offen bei anderen" und die Karte
  "Aufgaben" an Liegenschaft, Gebäude, Raum, Anlage, Prüfung, Rundgang und Auftrag, vor Ort
  "Meine Aufgaben" im Menü und die Karte an Raum, Anlage und Auftrag, wo eine Aufgabe auch ohne
  Netz notiert und abgehakt wird. Bisher gab es keine Stelle, an der etwas festgehalten werden
  konnte, das zu tun ist und zu keinem Vorgang gehört.
- Listen im Büro als Tabelle (#138, mit dem Schreiber aus opengewerk#595, `23990c5`, den das
  Fundament seit #238 auf `98b2bae` mitbringt): die Liegenschaften
  und das Anlagenverzeichnis haben im Kopf den Knopf "Als Tabelle", ab der Breite eines Tablets,
  mit Excel (.xlsx) und CSV. Ausgegeben wird, was die Liste unter ihrem Filter zeigt, in ihrer
  Reihenfolge und mit ihren Spalten: beim Anlagenverzeichnis jede Anlage, die der Filter
  durchlässt, auch über die erste Seite hinaus, bei den Liegenschaften der gedrückte Bereich,
  die Suche und die Reihenfolge nach Dringlichkeit, jede Liegenschaft mit ihren Gebäuden in
  eigenen Zeilen und mit den Zahlen, die die Person lesen darf. Die Tabelle schreibt der Server
  (`GET /assets/table`, `GET /properties/table`), unter den Rechten und in den Bereichen der
  Person, den Standort einer Anlage nur für wen auch Liegenschaften, Gebäude und Räume sieht;
  ein Wert, der wie eine Formel beginnt, wird nicht ausgeführt, und nichts vom Stempel der
  letzten Änderung steht darin. Spalten und Wörter stehen in `domain` (`office-table.ts`)
  und gelten für Liste und Tabelle zugleich. Die Verfahrensbeschreibung nennt die beiden
  Exporte in Abschnitt 5 (B176 bis B183), die übrigen Listen folgen mit #236. Bisher ließ sich
  keine Liste des Büros in eine Tabellenkalkulation übernehmen
- Die übrigen Listen im Büro als Tabelle (#236, mit den Tabellen der Fristen, der Zugänge und des
  Änderungsprotokolls aus opengewerk/opengewerk#600; das Submodul `upstream/opengewerk` geht von
  `26908ae` auf `e63a09e`, dazwischen liegt genau ein Commit, `e63a09e`, der Merge von #600 auf
  `main` des Fundaments, nachzuprüfen mit
  `git -C upstream/opengewerk log --oneline 26908ae..e63a09e`): den Knopf "Als Tabelle" mit
  Excel (.xlsx) und CSV haben jetzt auch die Zähler,
  die Dokumente, das Pflichtenverzeichnis, die offenen und die verworfenen Vorschläge aus dem
  Katalog, die Fristen, die Prüfungen, die Rundgänge einer Woche, ihre Pläne und die eigenen
  Vorlagen, die Mängel, die Aufträge, die Aufgaben und unter den Einstellungen die Bereiche, die
  Mängelklassen, die Zugänge und das Änderungsprotokoll. Je Liste eine Route `GET …/table`, die
  liest wie die Liste: alle Zeilen unter ihrem Filter und nicht nur eine Seite, unter den
  Rechten und in den Bereichen der Person, höchstens 50.000 Zeilen, sonst lehnt der Server mit
  einem Satz ab. Eine Person nennt eine Tabelle nur der Leitung (`membership.read`): allen
  anderen fehlt die Spalte "Zuständig" oder "Verantwortlich", in den Prüfungen steht unter
  "Ausführend" nur eine Fremdfirma, und in den Rundgängen bleibt die Zelle leer, wo eine Person
  stünde. Auf eine Person eingegrenzt gibt es das Pflichtenverzeichnis und die Fristen als
  Tabelle nur für die Leitung. Auch die Zugänge und das Änderungsprotokoll bekommt als Tabelle
  nur sie, das Protokoll nur mit `audit.read` und `membership.read` zusammen. Namen von
  Liegenschaft, Gebäude und Raum,
  Nummer und Name einer Anlage und der Titel eines Vorgangs stehen nur, wo die Person sie lesen
  darf. Das Pflichtenverzeichnis hat "Frist prüfen" als eigene Spalte (Naht aus #74), die
  Tabelle der Dokumente nennt den Tag der neuesten Fassung als "Abgelegt am". Spalten und Wörter
  stehen in `domain` (`office-table.ts`, `duty-words.ts`) und gelten für Liste und Tabelle. Die
  Verfahrensbeschreibung sagt in Abschnitt 5, was hinausgeht, an wen und was nie (B184 bis
  B219), und nennt die Listen in Abschnitt 9 nicht mehr als offen. Mit #138 hatten nur die
  Liegenschaften und das Anlagenverzeichnis den Knopf; Abschnitt 3 des Konzepts verlangt ihn
  für jede Liste des Büros
- Irrtümlich bestätigte Pflicht aus dem Katalog entfernen (#241): Auf der Seite einer Pflicht
  aus dem Katalog steht für wen das Pflichtenverzeichnis führt "Entfernen" hinter "Beenden",
  solange die Pflicht keinen Nachweis und keinen unterschriebenen oder geschlossenen Vorgang
  hat und nicht beendet ist (`removable` an `GET /duties/:id`, dieselbe Prüfung wie
  `DELETE /duties/:id`). Die Rückfrage sagt, was mitgeht, dass der Katalog die Pflichtart für
  die Anlage wieder vorschlägt und wann stattdessen beendet wird; lehnt der Server ab, bleibt
  sie mit seinem Satz offen. Danach öffnet sich die Akte der Anlage, und was über Pflichten und
  Anlagen gelesen war, wird neu gelesen. Die Route gab es seit #79; neu sind die Tests dafür,
  dass nur entfernt, wer das Pflichtenverzeichnis führt (`duty.write`), dass die Pflichtart
  danach wieder Vorschlag ist und sich neu bestätigen lässt und dass das Änderungsprotokoll
  nennt, wer bestätigt und wer entfernt hat. Das Planungskonzept (v0.23) sagt in 4.3, wann eine
  Pflicht entfernt und wann sie beendet wird. Bisher ließ sich eine Pflicht aus dem Katalog nur
  beenden: wer einen Vorschlag irrtümlich bestätigt hatte, behielt einen beendeten Eintrag, der
  nie hätte entstehen sollen
- Eine fällige Zählerablesung legt eine Aufgabe an (#242): Die Fristen-Engine kennt die Aktion
  "Aufgabe". Beginnt der Vorlauf der Ablesung einer Liegenschaft, bekommt die Person, die für
  die Frist verantwortlich ist, die Aufgabe "Zähler ablesen", eine je Liegenschaft und
  Stichtag, an der Liegenschaft und fällig am Stichtag. Die Frist nennt ihre Aufgabe
  (`deadlines.task_id`, Migration `0040_deadline_task`): sie hat immer nur eine, und rückt ihr
  Tag nach vorn, folgt die offene Aufgabe, statt dass eine zweite entsteht. Erledigt ist die
  Aufgabe mit dem Lauf, in dem die Frist weitergeht, also sobald jede Messstelle dort ihren
  Stand für den Stichtag hat, oder wenn dort nichts mehr abzulesen ist. Die Engine fragt wie
  der Abgleich, ob die Person nicht gesperrt ist, Aufgaben erledigen darf und den Bereich
  sieht; sonst entsteht keine Aufgabe, und der Lauf geht trotzdem durch. Ein fälliger Mangel
  legt keine an. Das Planungskonzept (v0.24) sagt in 2.4, welche Frist welche Aktion auslöst,
  die Verfahrensbeschreibung nennt die Aufgabe aus der Engine in Abschnitt 3.14 (B220 bis
  B224). Bisher erinnerte die fällige Ablesung nur: wer sie machen sollte, hatte nichts in
  seiner Liste, das mit den Ständen von selbst verschwindet
- Eine neue Fassung eines Pakets meldet sich an bestätigten Pflichten (#139): Sagt der Katalog
  nach einem Update etwas anderes als das, womit eine Pflicht bestätigt wurde, eine neuere
  Fassung ihrer Pflichtart oder einen anderen Wert der Regel ihrer Frist, steht die Pflicht
  unter "Neue Fassung im Katalog", mit dem, was sich ändert und ab wann. Wer das
  Pflichtenverzeichnis führt, übernimmt die neue Fassung oder lässt die Pflicht mit
  Begründung, wie sie ist, einzeln oder im Stapel; beides steht im Änderungsprotokoll. Bis
  dahin ändert sich an der Pflicht nichts, und sie sagt "Neue Fassung" im
  Pflichtenverzeichnis und auf ihrer Seite; ein Hinweis steht über den Vorschlägen, dem
  Pflichtenverzeichnis, der Übersicht und am Paket im Katalog. Eine Höchstfrist, die eine
  Vorschrift verkürzt, gilt ab ihrem Stichtag von selbst: der Termin rechnet mit ihr, die
  Pflicht sagt "Durch Vorschrift verkürzt", und so lassen lässt sie sich dann nicht
  (Entscheidung vom 11.10.2026, Planungskonzept v0.25, Abschnitt 2.3, Nachtrag in ADR 0005).
  Eine Pflicht trägt dafür auch den Richtwert vom Tag ihrer Bestätigung und, wogegen sie so
  gelassen wurde (Migration `0041_duty_updates`); die Verfahrensbeschreibung nennt die
  Entscheidung in Abschnitt 3.4 (B225, B226). Bisher blieb eine bestätigte Pflicht bei ihrer
  Fassung, ohne dass jemand erfuhr, dass der Katalog inzwischen etwas anderes sagt
- Dubletten im Büro (#171): "Trotzdem anlegen" hält jetzt auch im Büro fest, welche Anlagen dabei
  gezeigt wurden (`assets.distinct_from`), im Formular einer Anlage und einer Komponente, auf der
  Karte einer Dublette aus dem Abgleich und im Import für die vorhandenen Anlagen, auf die eine
  Zeile zeigt. Die Akte nennt sie unter "Keine Dublette von" mit Nummer und Namen, eine inzwischen
  entfernte bleibt genannt, eine außerhalb der eigenen Bereiche wird gezählt; das
  Änderungsprotokoll schreibt die Namen statt der Kennungen (`opengewerk/opengewerk#603`, Submodul
  angehoben). Das Formular fragt beim Anlegen wie der Abgleich auch über die Grenze der Bereiche
  und sagt dann nur, dass es eine Anlage außerhalb der eigenen Bereiche gibt, ohne sie zu zeigen
  (Entscheidung vom 11.10.2026, Planungskonzept v0.26, Abschnitt 4.2, Nachträge in ADR 0002 und
  0003). `GET /assets/duplicates` antwortet dafür mit `assets` und `elsewhere` statt mit einer
  Liste und sieht über die Grenze nur für wen Anlagen aufnehmen darf. Das Feld heißt im Protokoll
  und im Abgleich jetzt "Keine Dublette von". Bisher schrieb
  nur die Bestandsaufnahme vor Ort die Entscheidung, und wer im Büro den Bestand zweier Bereiche
  erfasste, legte dieselbe Anlage doppelt an, ohne es zu erfahren
- Import von Anlagen (#172): der Import liest jetzt auch, was nur eine Anlagenart hat, etwa das
  Löschmittel eines Feuerlöschers. Nach "Anlagenarten" folgt der Schritt "Felder": die Spalten,
  die der erste Schritt nicht genommen hat, werden den Feldern der gewählten Anlagenarten
  zugeordnet, je Anlagenart einmal, vorgeschlagen am Namen der Spalte. Der Plan liest eine Zelle,
  wie eine Liste sie schreibt (eine Auswahl an ihrer Bezeichnung, eine Zahl mit Komma und auf
  Wunsch mit ihrer Einheit, ja oder nein, ein Tag), und prüft sie gegen ihr Feld wie das Formular;
  was nicht passt, ist eine offene Zeile. Ein Wert in einer Zeile, deren Anlagenart die Spalte
  keinem Feld zugeordnet hat, wird nicht übernommen und steht in der Vorschau unter "Was nicht
  übernommen wird" mit Zeile und Spalte; der Import läuft trotzdem (Entscheidung vom 11.10.2026,
  Planungskonzept v0.27, Abschnitt 11, Nachtrag in ADR 0002). `docs/import/Tabellen.md` sagt, wie
  eine solche Zelle steht, und ein Test hält die Beispiele dort gegen den Import. Hat die Datei
  keine Spalte übrig oder keine der Anlagenarten ein eigenes Feld, entfällt der Schritt. Bisher
  trug, wer eine Liste mit solchen Spalten importierte, sie an jeder Anlage von Hand nach
- Tausch einer Anlage (#89): an der Akte einer Anlage steht für wer Anlagen pflegt "Tauschen". Der
  Dialog fragt nach dem Tag und nach Bezeichnung, Anlagenart, Hersteller und Seriennummer der neuen
  Anlage und zeigt vorher, was mit der alten endet: ihre Pflichten, ein Mangel, den noch niemand
  behoben hat, und ein Vorgang, der offen oder begonnen ist. In einem Schritt wird die alte Anlage
  ab dem Tag zurückgebaut, die neue entsteht am selben Ort mit demselben Versorgungsbereich und
  eigener Nummer, die Pflichten der alten enden und werden für die neue vom Katalog neu
  vorgeschlagen, offene Mängel gelten als behoben und warten auf die Nachprüfung, offene Vorgänge
  werden mit dem Tausch als Grund als nicht durchgeführt geschlossen. Eigene Pflichten und einzelne
  Komponenten gehen mit, wenn sie angekreuzt sind; eine eigene Pflicht übernimmt, wer das
  Pflichtenverzeichnis führt. Die Nachweise der alten Anlage bleiben bei ihr und unverändert, ihre
  Nummer wird nicht neu vergeben, und scheitert ein Teil, bleibt alles, wie es war. Beide Akten
  nennen einander ("Ersetzt", "Ersetzt durch"). Eine Anlage wird einmal getauscht, eine Messstelle
  gar nicht (dafür gibt es den Zählertausch), und der Tag liegt nicht in der Zukunft
  (Planungskonzept v0.29, Abschnitt 4.2, Nachtrag in ADR 0002, Migration `0042_asset_exchange`).
  Bisher musste, wer ein Gerät ersetzte, die alte Anlage von Hand stilllegen, eine neue anlegen,
  jede Pflicht beenden und jeden Vorgang und Mangel einzeln schließen, und nichts hielt fest, welche
  Anlage welche ersetzt hat
- Mailserver der Instanz (#81): im Bereich der Instanz steht unter "Einstellungen" die Karte
  "Mailserver der Instanz". Über ihn gehen die E-Mails an ein Konto, der Link zu einem neuen
  Passwort und der Hinweis auf einen neuen Passkey, und nie über den Mailserver eines Betreibers:
  ein Konto gehört der Instanz, und die Leitung eines Betreibers könnte sonst ein Konto zu sich
  holen und den Link über einen eigenen Mailserver lesen. Eintragen kann ihn nur die Verwaltung
  der Instanz, das Passwort steht versiegelt in der Datenbank, und das Protokoll der Instanz hält
  fest, wann es gesetzt wurde, nie das Passwort. Das Fundament bringt ihn mit (`opengewerk#610`,
  Submodul angehoben); hier kommen die Migration `0043_instance_mail_server`, die Sätze der Karte
  in den Wörtern der Haustechnik und Abschnitt 9 des Konzepts (v0.30). Die Haustechnik verschickt
  noch keine E-Mails, und die Karte sagt das, bis die Benachrichtigungen (#126) den Versand
  binden
- Benachrichtigungen per E-Mail und Push (#126, Abschnitt 3 des Konzepts, v0.31). Eine Frist
  erinnert die verantwortliche Person per E-Mail, sobald der Betreiber unter "Einstellungen",
  "E-Mail-Einstellungen" seinen Mailserver eingetragen hat, und per Push. Als Push kommen
  außerdem: ein Rundgang, eine Prüfung, eine Wartung oder ein Auftrag wird jemandem zugeteilt;
  ein Auftrag wird zurückgewiesen; ein Rundgang wartet auf die Gegenzeichnung, ein Auftrag auf
  die Abnahme; eine Aufgabe wird fällig. Jede Person schaltet Push unter "Konto" und im Menü vor
  Ort auf ihrem Gerät ein und wählt die Anlässe; ein Auftrag der Dringlichkeit "sofort" erreicht
  die Person, die ihn führt, auch wenn sie Zuteilungen abgeschaltet hat. Eine Nachricht nennt,
  was ansteht, und den Tag, keinen Namen, keinen Ort und kein eingetipptes Wort: sie geht durch
  fremde Mailserver und durch den Push-Dienst des Browser-Herstellers, und was dahinter steht,
  zeigt die Anwendung erst nach der Anmeldung. Jede Nachricht fragt vor dem Schreiben, ob es noch
  etwas zu sagen gibt und wem, und geht je Anlass und Person einmal hinaus
- Der Mailserver des Betreibers (#126): die Leitung trägt ihn unter "E-Mail-Einstellungen" ein,
  mit einer Signatur, die `{benutzer}` kennt. Das Passwort steht versiegelt in der Datenbank und
  wird nie wieder angezeigt. Dafür gibt es die Rechte "Den Mailserver ansehen" und "Den Mailserver
  einrichten", beide nur bei der Leitung, weil die Anmeldung an einem Postfach ein Weg ist, im
  Namen des Betreibers an jeden zu schreiben, und das Recht "Push auf den eigenen Geräten
  einrichten" für alle vier Rollen. Ein Betreiber, den es schon gibt, behält seine Rollen, wie
  sie sind, und hat die drei Rechte nach dem Update noch nicht (#270)
- Eine Einladung geht per E-Mail hinaus, wenn der Betreiber einen Mailserver hat (#126). Ihr Link
  entsteht erst, wenn die E-Mail hinausgeht: im Postausgang und im Änderungsprotokoll steht
  keiner, der funktioniert
- Der Link zu einem neuen Passwort und der Hinweis auf einen neuen Passkey gehen über den
  Mailserver der Instanz hinaus (#81, #126), in den Wörtern der Haustechnik
- Migration `0044_mail_outbox_and_push` mit Rücknahme: der Postausgang der E-Mails und die drei
  Tabellen für Push (Geräte, abgeschaltete Anlässe, Nachrichten). Der Postausgang trägt keinen
  Schlüssel auf eine Frist: ein Schlüssel auf eine Zeile mit Ort läuft über die Liegenschaft
  (ADR 0003), und der Postausgang hat keinen Ort
- `docker/.env.example` und `docker/compose.yaml` kennen `VAPID_PRIVATE_KEY`, den Schlüssel, mit
  dem Push-Nachrichten signiert werden. `sh docker/start.sh` legt ihn an; ohne ihn verschickt die
  Instanz kein Push und sagt das unter "Konto"
- Die Verfahrensbeschreibung hat den Abschnitt 3.15 "Benachrichtigungen" mit den Belegen B227 bis
  B255: was eine Nachricht sagt, wer sie bekommt, was ein Gerät für Push hinterlegt und dass seine
  Adresse und seine Schlüssel den Server im Änderungsprotokoll nicht verlassen
- Hilfe an den Bildschirmen, Kurzanleitungen und Handbuch (#131): das Fragezeichen in der
  Kopfleiste des Büros öffnet neben der Seite ihren Hilfetext, unter 1024 Pixeln steht "Hilfe
  zu dieser Seite" im Menü. Jede Seite der Navigation, jede Einstellung, das Konto und die Akte
  einer Anlage haben einen eigenen Text, was darunter liegt, liest den seiner Liste. Unter
  "Hilfe" stehen die Kurzanleitungen zu den fünf Kernabläufen (Rundgang, Bestandsaufnahme,
  Prüfung mit Bericht, vom Mangel zum Auftrag, Ablesung), vor Ort als Zeile im Menü mit einem
  Text je Bildschirm, und im Bereich der Instanz das Handbuch für ihre Verwaltung
  (Installation, Update, Sicherung und Rückspielen, Betreiber anlegen). Die Texte liegen als
  Markdown unter `packages/web/help` und sind in die Anwendung gebaut, damit sie vor Ort ohne
  Netz lesbar sind; geladen werden sie erst, wenn jemand die Hilfe öffnet, das Bündel vor Ort
  bleibt mit 247,6 von 300 kB unter seiner Grenze. Ein Test wird rot, wenn eine Seite der
  Navigation keinen Text hat oder ein Text etwas benutzt, das die Anwendung nicht liest. Knopf,
  Schublade und der Leser für Markdown sind Bausteine des Fundaments (`opengewerk/opengewerk#612`
  und `#613`). Die Seiten der Hilfe stehen in der Prüfung der Breiten, auch die, zu denen nur die
  Schublade oder das Menü führt.
- **Laufende Fristen und alte Nachweise aus Listen oder einer Vorgängeranwendung (`#130`, erster
  Teil).** Unter "Importieren" im Pflichtenverzeichnis steht ein dritter Import, für alle, die
  das Pflichtenverzeichnis führen und Nachweise eintragen. Eine Zeile nennt ihre Anlage
  (Anlagennummer, Kennzeichen oder Seriennummer), die Pflicht, den Tag des letzten Nachweises und
  auf Wunsch die nächste Fälligkeit; die Dateien der alten Nachweise werden daneben gewählt und
  gehen dem Import voraus wie die Datei eines Berichts. Steht die Pflicht an der Anlage noch
  nicht, bestätigt der Import sie, aus dem Katalog oder mit Grundlage, Quelle, Tätigkeit und
  Frist als eigene. Die jüngste Zeile einer Pflicht wird ein Nachweis mit der Herkunft
  "Altbestand": er zählt für die Frist, nennt niemanden, der ihn unterschrieben hat, und sagt
  überall, auch im PDF, dass er nicht in dieser Anwendung unterschrieben wurde. Ältere Zeilen
  und Zeilen ohne Pflicht werden Dokumente an der Anlage mit dem Kennzeichen "Altbestand".
  **Keine Frist beginnt beim Wechsel neu zu laufen:** die nächste Fälligkeit gilt, wie die Liste
  sie nennt, nach § 14 Abs. 5 BetrSichV als Monat, und was danach durchgeführt wird, zählt von
  dort weiter; hinter der Höchstfrist ihrer Pflicht liegt sie nie, eine solche Zeile ist zu
  klären. Dafür hält ein übernommener Nachweis den Tag seiner Liste (Migration
  `0047_taken_over_deadlines`, Fassung 8 des eingefrorenen Stands), und der Termin einer Pflicht
  wird weiter bei jedem Lesen gerechnet. Übernommen wird ganz oder gar nicht, und dieselbe Liste
  lässt sich ein zweites Mal importieren, ohne etwas doppelt anzulegen. Der Import steht im
  Änderungsprotokoll, dazu jede Pflicht, jeder Nachweis und jedes Dokument mit eigenem Eintrag,
  weil ein Nachweis Beweiswert hat. Das Format steht in `docs/import/Tabellen.md`, Nachträge in
  ADR 0002 und 0004, Konzept v0.33. Zählerstände, Vorlagen der Rundgänge und das Dokument zum
  Importpaket folgen mit dem zweiten Teil.
- **Zählerstände und Vorlagen der Rundgänge aus Listen, und das Importpaket (`#130`, zweiter
  Teil).** Unter "Importieren" in der Liste "Zähler" steht ein Import für Stände, Zählertausche
  und Stilllegungen, für alle, die Anlagen pflegen und Zähler ablesen. Eine Zeile nennt ihre
  Messstelle mit Zählernummer, Anlagennummer, Kennzeichen oder Seriennummer und ist ein Stand,
  ein Tausch oder eine Stilllegung. Ein übernommener Stand gilt für den Stichtag seines Tags
  und wird geprüft wie jeder andere, gegen die Stände davor und danach und gegen die Tausche;
  er trägt die Quelle "Übernommen" (Migration `0048_taken_over_readings`), weil ihn hier
  niemand abgelesen hat. Die Tausche einer Liste schließen aneinander an und enden in der
  Zählernummer, die die Anlage trägt; der Import ändert sie nicht. Unter "Importieren" in der
  Liste der Vorlagen steht ein Import für die Vorlagen der Rundgänge, für alle, die sie führen:
  eine Zeile ist ein Punkt mit Vorlage, Kapitel und Art, ein Grenzwert kommt als eigener Wert
  mit Quelle, und worauf ein Punkt zeigt, wird danach im Editor eingetragen. Beide gehen den Weg
  jedes Imports: Vorschau, die nichts schreibt, Übernahme ganz oder gar nicht, und dieselbe
  Liste lässt sich ein zweites Mal importieren. **Wie die Tabellen einer Vorgängeranwendung zu
  einem Paket zusammengehören, steht jetzt in `docs/import/Importpaket.md`**: der Ordner, die
  Reihenfolge, was die Tabellen verbindet, was nicht im Paket steht (Zugänge werden eingeladen,
  ein Paket hält kein Konto und kein Passwort) und was ein Probelauf vergleicht. Daneben liegt
  ein Beispielpaket aus erfundenen Daten, das ein Test bei jedem Lauf in eine leere Datenbank
  importiert und gegen die Seite hält, damit Format, Seite und Beispiel nicht
  auseinanderlaufen. Das Formular einer eigenen Pflicht sagt wieder, dass ein Nachweis aus der
  Zeit davor mit dem Import als Altbestand kommt. Format in `docs/import/Tabellen.md`, Nachtrag
  in ADR 0002, Konzept v0.34. Eine Anlagenart für Messstellen bringt noch kein mitgeliefertes
  Paket; das ist `#287`.
- **Paket Messstellen (`#287`).** Unter `pakete/messstellen/` steht je Medium aus Abschnitt 4.9
  eine Anlagenart, die eine Messstelle ist: Stromzähler, Wasserzähler, Wärmezähler,
  Fernwärmezähler, Gaszähler und Kältezähler, mit Kostengruppe und den Einheiten, in denen ein
  Zähler der Art zählt. Bis dahin hatte kein mitgeliefertes Paket eine solche Anlagenart, und
  in einer Instanz ohne das Probepaket der Tests ließ sich kein Zähler anlegen, ablesen oder
  importieren. Das Paket steht neben dem Paket Allgemein und nicht darin, weil eine allgemeine
  Anlagenart für ein fehlendes Fachpaket steht und keine Pflichtart trägt; die Fachpakete für
  Heizung, Raumluft und Kälte kommen erst in Phase 2. Der Import der Anlagen schlägt die Arten
  über ihren Namen vor. Das Beispielpaket aus `#130` hat einen Stromzähler dazubekommen und wird
  im Test nur noch mit den Paketen des Baus importiert, und die Zähler der Vorschau tragen die
  neuen Anlagenarten. Konzept v0.35.
- **Nummernkreise und Sicherung unter "Einstellungen" (`#127`).** "Nummernkreise" zeigt Muster
  und nächste Nummer für Anlagen, Aufträge und Nachweise, mit der Nummer, die als nächste
  vergeben wird; die Leitung ändert ein Muster und setzt die nächste Nummer hinauf, nie hinab,
  damit keine vergebene Nummer ein zweites Mal vorkommt. "Sicherung" zeigt, wann die Instanz
  zuletzt gesichert wurde, mit Archiv und ob es verschlüsselt ist, und über jedem Bildschirm
  des Büros steht eine rote Leiste, wenn die letzte Sicherung älter als zwei Tage ist. Bisher
  ließen sich die Nummernkreise nur mit SQL ändern, und ob die nächtliche Sicherung lief, sah
  niemand in der Anwendung. Beides sieht nur die Leitung. Routen, Bildschirme und Leiste
  kommen aus dem Fundament (Submodul angehoben); der Lauf "Sicherung und Rückspielen" fragt
  die Route jetzt nach jeder Sicherung mit einem Konto der Leitung (`#80`).
- **Rechtstexte der Instanz (`#129`).** Impressum und Datenschutzhinweise pflegt die
  Verwaltung der Instanz in deren Bereich unter "Rechtstexte", mit Vorschau, und jeder liest
  sie ohne Anmeldung unter `/rechtliches`. Der Fuß der Anmeldung verlinkt nur einen Text, der
  hinterlegt ist, und fehlt das Impressum, sagt es der Bereich der Instanz. Ein Text kennt
  Überschriften, Absätze, Listen, fett und Verweise und wird nie zu HTML. Bisher stand ein
  Impressum nirgends, und im Quelltext hätte es für jede Instanz falsch gestanden. Baustein,
  Route und Bildschirme kommen aus dem Fundament (Submodul angehoben), die Spalten mit der
  Migration `0049_instance_legal_texts`; jede Änderung steht im Protokoll der Instanz. Die
  Zusage K7 der Verfahrensbeschreibung nennt die Rechtstexte unter dem, was ohne Anmeldung
  antwortet, und die Navigation des Bereichs heißt "Verwaltung der Instanz" wie auf der Tafel.
- **Eigene Angaben unter "Konto" (`#128`).** Name und E-Mail-Adresse des eigenen Kontos ändert
  jede Person selbst, nach der Bestätigung mit Passwort und Code aus der App, und die Änderung
  steht im Änderungsprotokoll jedes Betreibers, für den das Konto arbeitet. Ein Konto, das für
  mehrere Betreiber arbeitet oder zur Verwaltung der Instanz gehört, ließ sich bisher gar nicht
  berichtigen. Baustein und Route kommen aus dem Fundament (Submodul angehoben); die
  Verfahrensbeschreibung nennt es als Zusage, mit zwei Tests als Beleg.
- Die Einladung sagt, wofür der Zugang ist (opengewerk/opengewerk#623): "..., Rolle Haustechnik
  im Bereich Süd.", wie die Tafel "Einladung einlösen" es zeigt. Die Rollen mit den Namen des
  Betreibers kommen aus dem Fundament, die Bereiche sagt die Haustechnik selbst (`offered` in
  `areas/additions.ts`). Beides nur, solange der Link gilt; die Verfahrensbeschreibung nennt es
  als Zusage, weil die Route ohne Anmeldung antwortet.
- Eine Vorlage für den Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO liegt auf
  opengewerk.de (https://opengewerk.de/haustechnik/auftragsverarbeitung/, #133), weil ein Betreiber mit echten Daten
  auf einer Instanz, die ein Dienstleister für ihn betreibt, einen solchen Vertrag braucht.
  Anlage 1 beschreibt die technischen und organisatorischen Maßnahmen, die die Anwendung
  mitbringt, und was der Dienstleister beim Betrieb ausfüllt. Die Vorlage ist als nicht
  rechtlich geprüft gekennzeichnet, bis der Fachanwalt sie gesehen hat. README und
  Verfahrensbeschreibung verweisen auf sie.
- Paket Brandschutz (#92), weil der Pilotbetrieb seine Feuerlöscher, Brandmeldeanlagen und
  Brandschutztüren vor dem Parallelbetrieb im Katalog braucht. Neun Anlagenarten von Feuerlöscher
  bis Feststellanlage, sechs Pflichtarten aus § 4 Abs. 3 ArbStättV, ASR A2.2 Nr. 7.4 und ASR A1.7
  Nr. 10.2 Abs. 3, die Fristen als Regeln (Feuerlöscher zwei Jahre, Feststellanlage monatlich und
  jährlich, jeweils Richtwert), ein Formular für die monatliche Prüfung der Feststellanlage, eine
  Vorlage für die Sichtkontrolle der Feuerlöscher auf einem Rundgang und drei Mängelklassen. Jede
  Fundstelle ist am 14.10.2026 am Text geprüft; was private Normen sagen, kommt nach der
  rechtlichen Prüfung als neue Fassung.
- Paket Trinkwasser (#93), weil der Pilotbetrieb die Untersuchung auf Legionellen vor dem
  Parallelbetrieb im Katalog braucht. Vier Anlagenarten (Trinkwasserinstallation,
  Trinkwassererwärmer, Sicherungseinrichtung, Filter), zwei Pflichtarten nach § 31 TrinkwV
  (jährlich bei öffentlicher, alle drei Jahre bei nur gewerblicher Abgabe), die Regeln für beide
  Fristen, die zehn Jahre Aufbewahrung und den technischen Maßnahmenwert, ein Formular für den
  Befund der Untersuchungsstelle, eine Vorlage für die Temperaturen auf einem Rundgang und drei
  Mängelklassen. Gemessen wird gegen den Maßnahmenwert mit dem neuen `below` des Fundaments
  (`opengewerk#630`), weil die Verordnung schon beim Erreichen von 100 je 100 ml Maßnahmen verlangt;
  die Formulare und der Import von Vorlagen kennen dafür die Einheit "je 100 ml". Jede Fundstelle
  ist am 14.10.2026 am Text geprüft.
- Ein Messwert in einer eigenen Vorlage kann "unter" seinem Grenzwert bleiben müssen (#299), aus
  einer Regel eines Pakets wie als eigener Wert mit Quelle; der Dialog des Punkts bietet die dritte
  Grenze an, ein eigener Wert nutzt dafür `under` des Fundaments (`opengewerk#631`). Wer den
  technischen Maßnahmenwert für Legionellen in seine eigene Vorlage nahm, konnte nur "höchstens"
  wählen, und ein Befund von genau 100 je 100 ml stand dann als innerhalb da.
- Paket Landesrecht mit Baden-Württemberg (#94), weil der Pilotbetrieb die Prüfungen nach dem
  Bauordnungsrecht des Landes vor dem Parallelbetrieb im Katalog braucht. Das Land hat keine
  Prüfverordnung; geprüft wird nach § 37 VStättVO, § 30 VkVO und § 16 GaVO. Vier Pflichtarten für
  die Anlagenarten der Pakete Brandschutz und Elektro, je mit `states: ["DE-BW"]` und der
  Gebäudeart ihrer Verordnung: die Anlagen einer Versammlungsstätte und ihr Blitzschutz, die einer
  Verkaufsstätte und die einer Garage, alle drei Jahre durch einen anerkannten Sachverständigen,
  der Blitzschutz durch Sachkundige. Die Fristen und die fünf Jahre Aufbewahrung stehen als Regeln
  mit `scope: "DE-BW"`. Lüftung und CO-Warnanlagen kommen mit dem Paket Raumluft in Phase 2. Jede
  Fundstelle ist am 14.10.2026 an der Gesamtausgabe auf landesrecht-bw.de geprüft.


### Geändert

- Wer genau einem Betreiber angehört, sieht nach der Anmeldung keine Wahl mit einer einzigen
  Kachel mehr; die Anwendung öffnet ihn selbst (opengewerk/opengewerk#624, aus dem Fundament).
  Gefunden beim Durchgang auf einem lokalen Stapel für `#128`, gleich nach der Ersteinrichtung.
- Was das Fundament mitbringt, folgt seinen Tafeln (`#128`): die Bildschirme vor der Anmeldung
  mit "OpenGewerk" und "Haustechnik" in Kupfer darunter, dem Satz der Tafel daneben und dem
  Schlüssel für die Authenticator-App in Vierergruppen; der Bereich der Instanz mit den
  Überschriften der Tabellen und "Sie" am eigenen Konto; "Konto" in der Anordnung der Tafel;
  vor Ort kein Streifen über den Konflikten. Eine Anlage heißt in einem Konflikt mit Nummer und
  Namen, wie auf der Tafel. Gegen die gebaute Oberfläche gehalten hatte die Tafeln seit ihrer
  Freigabe niemand.

- Die Formulare der Ansprechpartner an einer Liegenschaft fragen nach einer Sache je Zeile, und
  "Entfernen" steht in einer eigenen Zeile über "Abbrechen" und "Speichern" (#147, mit dem Fundament
  `opengewerk/opengewerk#605`). In der Spalte von 340 Pixeln standen zwei Felder nebeneinander: von
  einer E-Mail-Adresse war beim Berichtigen nur der Anfang zu lesen, der Hinweis unter "Funktion"
  brach in drei Zeilen um, und "Speichern" rutschte allein in die nächste Zeile, weil drei Knöpfe ein
  paar Pixel breiter sind als die Karte.
- Die Frage vor etwas, das sich nicht zurücknehmen lässt (entfernen, sperren, beenden, abmelden),
  steht in der Mitte des Fensters (#147, mit dem Fundament `opengewerk/opengewerk#605`). Sie stand
  ein Fünftel der Höhe von oben und damit auf einem hohen Bildschirm weit über dem, worauf sie sich
  bezieht; der Dialog mit einem Formular steht seit #115 in der Mitte.
- Der Dialog mit einem Formular steht auch auf dem Telefon in der Mitte des Fensters (#147, mit dem
  Fundament `opengewerk/opengewerk#606`). Unter 640 Pixeln stand er am oberen Rand, dieselbe Karte
  also je nach Breite an zwei Stellen. Ein Dialog, der höher ist als das Fenster, beginnt weiter an
  seinem oberen Rand und lässt sich schieben.
- Ein Gerät, das nicht jeden Bereich sieht, findet beim Abruf seine Vorgänge über zwei Teilindizes,
  und die Aufträge, an denen seine Person mitarbeitet, liest der Server einmal als Liste statt je
  Vorgang (#80, T14-3 aus dem Review der Phase 0, Migration `0038_device_scope_indexes`). Bisher
  las `deviceScope` bei jedem Abruf jeden Vorgang des Betreibers, die abgeschlossenen aller Jahre
  eingeschlossen, und die Frage je Vorgang ließ die Datenbank den Aufwand so hoch schätzen, dass
  sie die Abfrage vor jedem Lauf übersetzte (JIT), was länger dauerte als das Lesen selbst.
  Gemessen bei 5.000 Anlagen, 50.000 Vorgängen und 20.000 Mängeln braucht `deviceScope` 11 statt
  27 bis 31 Millisekunden, bei 200.000 Vorgängen 21 bis 33 statt 167 bis 183. Die Mängel bekommen
  keinen Index: unter der Zeilensicherheit kennt die Datenbank die Verteilung ihres Status nicht
  und nahm einen Index ab 80.000 Mängeln nicht mehr
- Wann ein Datensatz zuletzt geändert wurde, von wem und von welchem Gerät, verlässt den Server
  nicht mehr (#157, Fundament angehoben auf opengewerk#594). Bisher lagen die drei Angaben auf
  jedem Gerät, das den Datensatz lesen darf, und standen in jeder Antwort, die ihn ausgab, obwohl
  kein Gerät und kein Bildschirm sie las; Abschnitt 9 des Planungskonzepts sagt, dass Zeitpunkte
  einzelner Eingaben nicht angezeigt und nicht ausgewertet werden. Der Abruf lässt sie weg, und
  das Modul meldet den `StampInterceptor` des Fundaments für jede Route an. In der Zeile und im
  Änderungsprotokoll der Leitung bleiben sie. `api/stamp.test.ts` hält es für jede Art von
  Datensatz, die reist, und für jede Route, die liest; die Verfahrensbeschreibung führt es als
  Zusage statt unter dem, was diese Fassung noch nicht hält
- Ein Dialog des Büros steht auf breiten Bildschirmen in der Mitte des Fensters, wie die Tafeln ihn
  zeichnen, statt oben unter dem Kopf (#115, Fundament angehoben auf opengewerk#584). Auf dem
  Telefon bleibt er oben, wo die Tastatur ihn sichtbar lässt
- In der CI laufen die Datenbanktests des Fundaments auf einer eigenen PostgreSQL neben denen der
  Haustechnik statt vor ihnen (#192). Nacheinander brauchten beide zwölf der dreizehn Minuten des
  Jobs "Typprüfung, Lint und Tests"; lokal bleibt es bei einer Testdatenbank und der Reihenfolge
- Die Servertests setzen die Datenbank mit `resetToMigrated` auf den frisch migrierten Stand
  zurück (`opengewerk#578`, mit dem Fundament angehoben): als Kopie einer Vorlage, in die die
  Migrationen je Lauf einmal liefen, statt das Schema zu löschen und alle Migrationen neu laufen
  zu lassen. 44 Testdateien sind umgestellt; die Tests der Migrationen bauen weiter selbst. Das
  kostete jede Datei rund zwei Sekunden, zwei Dateien sogar vor jedem einzelnen Test
- Eine Berichtigung nimmt die Mängel aus dem Stand des Nachweises, den sie ersetzt, statt sie beim Vorgang neu zu
  lesen (#110): ein Bericht ohne Vorgang hat sie nirgends sonst
- Die Beispieldaten der Vorschau tragen ihre Nachweise als Berichte über die Route ein, mit Berichtigung und
  Ungültigerklärung über deren Routen, statt sie hinter den Routen zu schreiben (#110, Naht aus #87). Jede Anlage mit
  Nachweis hat damit ihre Prüfbescheinigung unter den Dokumenten
- Die Seite einer Prüfung, die eine Fremdfirma ausführt, sagt unter "So geht es weiter", dass ihr Bericht im Büro
  eingetragen wird, statt vom Gerät und der Unterschrift zu sprechen (#110)
- Die Seite eines Nachweises nennt die Klasse eines Mangels mit ihrem Wort aus dem Katalog statt mit ihrem Schlüssel
  (#110): seit dem Bericht nennen Mängel Klassen aus den Paketen
- Ein Bericht nimmt für seine Mängel nur die Klassen des Pakets seiner Pflichtart, sonst die allgemeinen, statt jede
  Klasse des Katalogs (#116): dieselbe Regel gilt für jeden Mangel (Abschnitt 4.6). Ein Mangel aus einem Bericht nennt
  den Nachweis, aus dem er kommt, auch ohne Vorgang
- Ein Gerät schickt mit einer Meldung keine Klasse mehr (#116): Klasse und Frist sind das Führen eines Mangels, das die
  Haustechnik nicht darf (Abschnitt 7)
- Die Beispieldaten der Vorschau melden ihre Mängel über die Route, mit Klassen, Vorgaben und je einem Mangel in jedem
  Stand der Liste (#116, Naht aus #110). Behoben und nachgeprüft stehen weiter hinter den Routen, bis die Aufträge kommen
- Die Verfahrensbeschreibung nennt die Mängel in einem eigenen Abschnitt 3.12 statt unter dem, was Phase 1 noch bringt
  (#116): was ein Mangel festhält, dass er keine Person nennt, wer meldet und wer führt (B107, B108), und die Liste
  "Mängel" in Abschnitt 5
- Das Pflichtenverzeichnis auf die Pflichten einer Person eingrenzen kann nur, wer es führt, also Leitung und
  Technische Leitung, und es nennt dann keine Zahl, weder im Kopf noch an einem Zustand (#101). Das Konzept
  schließt eine Auswertung je Person aus (Abschnitte 4.16 und 9); eine Liste ist keine, eine Zählung der
  überfälligen Pflichten einer Person wäre eine. Auf die Pflichten, für die niemand benannt ist, grenzt jede
  Rolle ein
- Die Verfahrensbeschreibung nennt das Pflichtenverzeichnis (#101): wer den Namen einer verantwortlichen Person
  sieht, wer nach ihr eingrenzt, wer die Namen zur Auswahl bekommt und dass die Nachweise einer Pflicht keine
  Person nennen, mit sieben neuen Belegen. Drei Sätze sind dafür genauer gefasst: die Kurzfassung nennt statt
  "keine Liste des Verzugs je Person" jetzt "keine Zahl je Person" und sagt, dass sich das Verzeichnis auf eine
  Person eingrenzen lässt; die Zusage zu den Zugängen nennt die Auswahl der verantwortlichen Person als die
  eine Stelle daneben; und die Zusage zu Adressen mit einer Person sagt, was ihr Test prüft, den Pfad
- Die Vorschau zeigt Pflichten in jedem Zustand mit verantwortlichen Personen, eine Pflicht an einem Raum,
  zwei ohne verantwortliche Person und eine beendete (#101), damit sich das Pflichtenverzeichnis ansehen lässt
- Planungskonzept v0.12: das Recht "Dokumente ablegen" steht in der Tabelle in Abschnitt 7, und eine Datei
  wird nie nach ihrer Prüfsumme ausgegeben, sondern über den Datensatz, der sie nennt (#96)
- Die Prüfung "Breiten und Auflösungen" nimmt ihren Browser aus `docker/compose.yaml` statt aus der Datei
  des Fundaments, seit diese Anwendung den Renderer selbst nennt (#96)
- Die Verfahrensbeschreibung nennt die Adresse `files` und sagt, dass eine Datei im Speicher keine Person
  nennt und im Änderungsprotokoll steht, wer sie geschickt hat (#96)
- Die Vorschau zeigt den Katalog dieses Baus und daneben das Probepaket, statt nur das Probepaket
  (#61): der Bau bringt jetzt ein Paket mit, und die Pakete mit Pflichtarten und Messstellen kommen
  erst im Lauf von Phase 1. Ein Lüftungsgerät der Beispieldaten trägt eine allgemeine Anlagenart und
  eine eigene Pflicht des Betreibers
- Im Katalog des Büros stehen die Anlagenarten eines Pakets nach Kostengruppe und dann nach ihrer
  Bezeichnung statt nach ihrem Schlüssel (#61): den Schlüssel sieht kein Leser, und nach
  Kostengruppen sind Anlagen überall geordnet
- Das Büro beginnt bei den Liegenschaften statt bei den Einstellungen, bis die Übersicht gebaut
  ist (#85): die erste Liste, und jede Rolle liest sie. Der Eintrag "Liegenschaften" steht damit
  in der Navigation, wie #83 es vorbereitet hat
- Fehlt der Name einer Liegenschaft, heißt es "Der Name fehlt." statt "Die Bezeichnung fehlt.",
  wie das Feld im Formular heißt (#85)
- Die Vorschau zeigt an einer Liegenschaft zwei Gebäude und eine Notiz, damit Liste und Seite beides
  zeigen (#85)
- Die Vorschau zeigt an einer Liegenschaft zwei Ansprechpartner und an einer weiteren einen, von dem
  nur der Name bekannt ist, damit die Karte beides zeigt (#85)
- Planungskonzept v0.10: wer die Ansprechpartner einer Liegenschaft pflegt und wer sie liest (#85)
- Die Rückfrage vor dem Entfernen einer Liegenschaft nennt auch ihre Ansprechpartner (#85)
- Die Vorschau zeigt am Schulhaus zwei Schließzeiten, die Ferien, die als nächste kommen (#86)
- Planungskonzept v0.11: was eine Schließzeit eines Gebäudes ist und wer sie einträgt (#86)
- Ein Gebäude führt aus der Liste der Liegenschaften und von der Seite seiner Liegenschaft zu seiner eigenen
  Seite (#86)
- Gebäude, Geschoss und Raum haben für die Leitung den Knopf "Änderungen" an ihrer Seite. Das Protokoll eines
  Gebäudes zeigt auch, was mit seinen Schließzeiten geschah, und schreibt die Gebäudearten in den Worten des
  Formulars (#86)
- Die Vorschau gibt jeder Anlage einen Zustand, nimmt einen Unterzähler außer Betrieb und lässt zwei Zähler je
  ein Gebäude versorgen, einen davon eines, in dem er nicht steht, damit die Raumseite beides zeigt (#86)
- Die Seite einer Liegenschaft bietet "Neues Gebäude" an, die eines Gebäudes "Bearbeiten" und "Geschoss
  anlegen", die eines Geschosses "Bearbeiten" und "Neuer Raum" und die eines Raums "Bearbeiten", jeweils nur
  dem, der es darf (#86)
- Die Prüfung "Breiten und Auflösungen" öffnet auch die Formulare für ein neues Gebäude, ein neues Geschoss
  und einen neuen Raum (#86)
- Planungskonzept v0.8: die Entscheidungen vom 04.10.2026 vor dem Bau von Phase 1 stehen an ihrer
  Stelle und in der Tabelle in Abschnitt 15 (#59, #72, #134). Die Issues von Phase 1 hatten unter
  "Zu klären vor dem Bau" offen, was das Konzept nicht sagte oder was die freigegebenen Tafeln als
  Lesart zeichnen. Entschieden ist unter anderem: Mängelklassen stehen als eigene Datei im Paket,
  und das Paket Allgemein bringt drei allgemeine Stufen mit; ein Mangel ist mit der Unterschrift
  unter dem Auftrag behoben, und ein Messwert außerhalb seines Grenzwerts wird ein Mangel; ein
  Auftrag hat drei Stufen der Dringlichkeit, und weitere Beteiligte arbeiten mit, ohne
  abzuschließen; die Zählweise ab dem fälligen Tag hat ein Fenster von einem Zwölftel der Frist;
  der Plan eines Rundgangs nennt seine Wochentage und kann Feiertage auslassen, ein Gebäude hat
  Schließzeiten; eine mögliche Dublette aus der Bestandsaufnahme und zwei Ablesungen desselben
  Zählers am selben Tag sind Konflikte; die Unterschrift hat einen Weg ohne Schriftzug; ein
  Altbestand kommt als Nachweis mit eigener Herkunft herein. Was in keiner Phase stand, hat jetzt
  eine: der Export, die Meldung einer neuen Fassung eines Pakets, Unterlagen für unterwegs, der
  Verlauf der Zähler und die Vorlagen für den Vertrag zur Auftragsverarbeitung und für eine
  Betriebs- oder Dienstvereinbarung
- Das Fundament ist auf den Stand angehoben, mit dem der Fokus nach einem Wechsel der Seite an ihrer
  Überschrift steht (`opengewerk/opengewerk#546` bis `#548`, #83). Für diese Anwendung heißt das:
  Büro, der Einstieg vor Ort und der Bereich der Instanz tauschen die Seite, ohne ein Dokument zu
  laden, und der Fokus blieb auf dem Link der Navigation oder auf nichts. Wer einen Bildschirmleser
  benutzt, hörte von der neuen Seite nichts, und mit der Tastatur ging es noch einmal durch die
  ganze Navigation. Jetzt steht der Fokus an der Überschrift der neuen Seite; ein Formular, das in
  seinem ersten Feld beginnt, behält ihn, ebenso Suche und Filter. Unter "Abgleich" steht "Abgleich
  abgelehnt", wenn der Server geantwortet und den Abgleich abgelehnt hat, und "Keine Verbindung" und
  vor Ort "Offline" nur noch, wenn niemand geantwortet hat. Der Satz über einem Lauf der Fristen,
  der scheitert, kommt mit dem Bildschirm der Fristen (#104)
- Das Fundament ist auf den Stand nach den übrigen Befunden aus dem Review der Phase 0 angehoben
  (`opengewerk/opengewerk#536` bis `#544`, `opengewerk-haustechnik#31`), mit der Migration
  `0013_sync_counter_grant`. Für diese Anwendung heißt das: Den Zähler des Abgleichs ruft nur noch
  die Anwendungsrolle. Der Baustein, aus dem diese Datenbank entstand, ließ ihn jeder Rolle der
  Datenbank offen, und der Vergleich mit den Bausteinen sieht so etwas jetzt, ebenso einen
  abgeschalteten Trigger. Schickt ein Gerät seinen Postausgang zweimal zugleich, wird jeder
  Vorgang einmal angewandt, statt dass die zweite Übertragung über einen angenommenen Vorgang
  abgelehnt wird. Zwei, die einen Betreiber leiten, können sich nicht mehr im selben Moment
  gegenseitig die Rolle nehmen, und ein doppelt angetippter Einmal-Link antwortet beim zweiten Mal
  mit einem Satz statt mit einem Fehler des Servers. "Protokoll prüfen" liest die Kette in einem
  Stand und meldet keinen fehlenden Eintrag mehr, wenn während der Prüfung jemand arbeitet; der
  Hash einer Einladung und die Schlüssel eines Push-Abonnements verlassen den Server im
  Änderungsprotokoll nicht mehr. `restore.sh` und `verify.sh` nehmen ein Archiv, das mit seinem
  Namen genannt wird, nur noch, wenn es eines dieser Anwendung ist: in einem Ziel, das sie mit
  einer Installation von OpenGewerk teilt, hätte deren Archiv die Betreiber dieser Instanz
  ersetzt. Der Lauf "Sicherung und Rückspielen" prüft die Prüfsummen des Manifests jetzt an einem
  Archiv, das nur sie ablehnen können. Die Liste der Fristen fragt die Datenbank für viele Fristen
  so oft wie für eine, eine Liste im Büro misst ihre Seitenlänge auch, wenn ihre Zeilen erst nach
  ihr kommen, und "Keine Verbindung" steht im Stand des Abgleichs auch neben einem Konflikt. Die
  Prüfung "Breiten und Auflösungen" bricht ab, statt Erfolg zu melden, wenn ihr Gang durch die
  Seiten seine Grenze erreicht oder der dunkle Durchgang hell läuft
- Das Fundament ist auf den Stand nach dem Review der Phase 0 angehoben
  (`opengewerk/opengewerk#524` bis `#528`, `opengewerk-haustechnik#31`). Für diese Anwendung heißt
  das: Die Konfliktliste des Abgleichs zeigt jedem Gerät nur noch seine eigenen Konflikte, und nur
  dieses Gerät schließt sie. Bisher bekam jeder mit dem Recht zum Abgleich die Konflikte des ganzen
  Betreibers und mit ihnen Werte aus Bereichen, die er nicht sieht. Ein Konto, das es auf der
  Instanz schon gibt, tritt einer Einladung nur noch angemeldet als dieses Konto bei, und die
  Ersteinrichtung übernimmt das Passwort so, wie es eingegeben wurde. Was jemand auf einem Gerät
  erfasst hat und nicht mehr senden konnte, wartet dort auf diese Person und geht nicht mehr unter
  der nächsten hinaus, die sich anmeldet. "Zugänge" bietet die Schreibaktionen nur dem an, der
  Zugänge ändern darf. Der Server übersteht eine Verbindung, die die Datenbank beendet, etwa beim
  Rückspielen einer Sicherung; eine Erinnerung an eine Frist, die scheitert, hält die übrigen des
  Betreibers nicht mehr auf; und der Migrationslauf lehnt ein Journal ab, dessen Zeitstempel nicht
  steigen, bevor er etwas einspielt. Die Tests des Abgleichs fragen die Konfliktliste seitdem als
  das Gerät, das gesendet hat, und einer hält fest, dass ein zweites Gerät und eine Sitzung ohne
  Gerät den Konflikt eines anderen nicht bekommen
- Das Fundament ist auf den Stand angehoben, mit dem Werte aus JSON und Listen im Abgleich als
  ihr Text reisen (`opengewerk/opengewerk#519`). Die Werte einer Anlage und die Arten eines
  Gebäudes sind die ersten solchen Spalten in einer Tabelle, die reist; ohne das las der
  Server schon die Zeile einer Anlage nicht
- Planungskonzept auf v0.2: die Entscheidungen vom 01.10.2026 stehen an ihren Stellen, und
  Abschnitt 15 nennt sie im Zusammenhang. Das Fundament kommt als Pakete aus dem Repository
  `opengewerk` und wird nicht abgeschrieben; die Zuständigkeitsbereiche erzwingt die
  Datenbank; alle sieben Pflichtenpakete erscheinen vollständig vor Version 1, zuerst mit
  dem, was staatliches Recht hergibt; eigene Rollen kommen in Phase 2. Lager und
  Auswertungen rücken im Fahrplan nach Phase 2, weil der Pilotbetrieb sie braucht, bevor er
  seine bisherige Anwendung abschaltet
- Planungskonzept auf v0.3: die Technik, mit der das Fundament eingebunden wird, ist
  entschieden (Git-Submodul auf einem festen Commit) und steht nicht mehr unter den offenen
  Punkten; die Anlässe der Benachrichtigungen stehen in der Zuordnung bei Phase 0
- Die Prüfungen "Kodierung und Zeilenenden" und "Schreibweise" überspringen den Eintrag
  eines Submoduls. Seine Dateien werden in dem Repository geprüft, zu dem sie gehören
- Planungskonzept auf v0.4: Abschnitt 5 nennt `abnahmen.json`, in der Prüfung und Abnahme
  eines Katalogeintrags neben ihm stehen, und sagt, dass Regeln fortgeschrieben und berichtigt
  statt neu gefasst werden (ADR 0005). Wer eine Instanz betreibt, heißt durchgehend
  "Verwaltung der Instanz", damit "Betreiber" in der Oberfläche nur eines bedeutet
- Das Fundament ist auf den Stand mit der Anmeldung angehoben (`opengewerk/opengewerk#473`,
  `#475` und `#476`). Der Guard vor jeder Route mit Herkunftsprüfung und Sicherheits-Headern,
  Konten mit Passwort, zweitem Faktor und Passkeys, Sitzungen je Gerät, die Ersteinrichtung
  mit Einrichtungscode, der Einmal-Link und die Verwaltung der Zugänge liegen damit in
  `@opengewerk/platform-server` und kommen von dort, statt hier ein zweites Mal zu entstehen.
  Wie ein Mandant und seine Rollen in dieser Anwendung heißen, sagt sie dem Fundament selbst;
  gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen in der CI dieses
  Repositorys mit, 328 statt 154
- Das Fundament ist auf den Stand mit den Rollen als Zeilen angehoben
  (`opengewerk/opengewerk#477` und `#479`). Was jemand bei einem Betreiber darf, steht damit in
  Zeilen des Betreibers (`tenant_roles`): je Rolle der Schlüssel, die Bezeichnung, die Rechte
  und zwei Angaben, ob sie den Betreiber führt und ob sie einen zweiten Faktor verlangt. Die
  Rechte dieser Anwendung werden ihr eigener Katalog, ihre Rollen die Zeilen, mit denen ein
  Betreiber beginnt; eigene Rollen eines Betreibers, wie Phase 2 sie vorsieht, sind dann
  weitere Zeilen und kein neuer Mechanismus. Die Oberfläche bekommt die Rechte je Betreiber vom
  Server und hält keine eigene Liste, was eine Rolle darf. Gebaut ist davon hier noch nichts.
  Die Tests des Fundaments dazu laufen in der CI dieses Repositorys mit, 351 statt 328
- Das Fundament ist auf den Stand mit Zugangsdaten, Nummernkreisen und dem Bereich der Instanz
  angehoben (`opengewerk/opengewerk#480` und `#481`). Versiegelte Zugangsdaten, Einstellungen
  mit Gültigkeitszeitraum und Nummernkreise sind damit Tabellen des Fundaments, die eine
  Anwendung mit ihren eigenen Listen anlegt: welche Zwecke, welche Einstellungen und welche
  Kreise es gibt, nennt diese Anwendung, den Mechanismus dahinter schreibt sie nicht noch
  einmal. Dazu kommt der Bereich der Instanz: wer sie verwaltet, ihre Einstellungen, ihr
  Protokoll, die Liste der Betreiber und der Weg zu einem weiteren Betreiber, samt den Befehlen
  `appoint-operator` und `add-tenant`. Jeden Satz, der dabei einen Betreiber, seine Leitung oder
  die Verwaltung der Instanz nennt, gibt diese Anwendung dem Fundament mit, damit er hier so
  heißt wie im Konzept. Gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen
  in der CI dieses Repositorys mit, 432 statt 351
- Das Fundament ist auf den Stand mit seiner Oberfläche angehoben (`opengewerk/opengewerk#482`
  bis `#497`). `@opengewerk/platform-web` ist damit Mitglied des Arbeitsbereichs: Tokens und
  Bausteine der Bildschirme, der Abgleich auf dem Gerät, die Sitzung, das Tor vor der Anmeldung,
  die Hülle der beiden Einstiege, "Konto", die Zugänge und der Bereich der Instanz, Kamera, Scan
  und Unterschrift, der Konfliktbildschirm, Service Worker und Manifeste und die Prüfungen der CI
  als Werkzeug. Wie diese Anwendung heißt und was sie dazu sagt, gibt sie dem Fundament einmal
  als Wert mit, wenn ihre Oberfläche entsteht (#13); gebaut ist davon hier noch nichts. Dazu
  heißt der Kopf, in dem eine Seite ihren Betreiber nennt, jetzt `x-opengewerk-tenant`, und die
  Pfade, die der Server des Fundaments selbst beantwortet, stehen als `foundationPaths` in
  `platform-domain`. Die Tests des Fundaments laufen in der CI dieses Repositorys mit: 95 in
  `platform-domain`, 437 in `platform-server` und 693 in `platform-web`
- Das Fundament ist auf den Stand mit seinem Betrieb angehoben (`opengewerk/opengewerk#498` bis
  `#500`, #14). Der Einstieg des Servers liegt damit in `@opengewerk/platform-server`: die
  Gesundheitsprüfung unter `/health`, das Ausliefern der Oberfläche, der Server mit allem, was
  vor den Routen steht, das Herunterfahren in fester Reihenfolge und die Zeile beim Start.
  Einrichten, Starten und Sichern sind Skripte des Fundaments, die den Namen einer Anwendung und
  den Anfang ihrer Variablen aus ihrer `application.env` lesen, und die drei CI-Läufe auf einem
  ganzen Stapel sind Schritte, die eine Anwendung mit ihrem Material füllt. Benutzt wird davon
  hier noch nichts, das kommt mit dem eigenen Betrieb (#15). Dem Fundament sagt diese Anwendung
  dafür einen Satz mehr, den das Protokoll beim Start einer leeren Instanz schreibt: dass die
  Ersteinrichtung im Browser den Betreiber und den ersten Zugang anlegt. Die Tests des
  Fundaments laufen in der CI dieses Repositorys mit, in `platform-server` jetzt 479 statt 437
- Das Fundament ist auf den Stand mit dem Abgleich auf dem Server angehoben
  (`opengewerk/opengewerk#501` und `#502`, #21). Das Anwenden der Vorgänge eines Geräts, die
  Konflikte und der Abruf nach der Änderungsnummer liegen damit in
  `@opengewerk/platform-server`, ebenso die Routen unter `/sync`, denen eine Anwendung das Recht
  je Vorgang, ihre Worte für eine Ablehnung der Datenbank und die Auswahl je Gerät mitgibt. Hier
  gebunden werden die Routen mit der Leiste des Abgleichs (#13), die Richtlinien je Entität und
  die Auswahl nach Bereich mit #27. Die Tests des Fundaments laufen in der CI dieses Repositorys
  mit, in `platform-server` jetzt 526 statt 479
- Das Fundament ist auf den Stand mit den neuesten Fassungen seiner Werkzeuge angehoben
  (`opengewerk/opengewerk#503`): `vite` 8.3.2, `vitest` 5.0.3, `@tanstack/react-router`
  1.170.41, `@tanstack/react-query` 5.104.0 und `lucide-react` 1.49.0. Die Oberfläche dieser
  Anwendung beginnt damit auf der neuesten Fassung, und `vitest` steht hier wie dort auf 5.0.3.
  `@opengewerk/haustechnik-domain` sagt jetzt, dass das Laden eines Moduls nichts tut
  (`sideEffects: false`), damit der Service Worker nur die eine Liste mitnimmt, die er braucht
- Das Fundament ist auf den Stand mit dem Änderungsprotokoll angehoben
  (`opengewerk/opengewerk#504` und `#505`, #22). Das Lesen einer Seite von Änderungen, die
  Prüfung der Hashkette und die Liste der Personen unter `/audit` liegen damit in
  `@opengewerk/platform-server`, der Bildschirm "Änderungsprotokoll", der Knopf "Änderungen" an
  einem Datensatz und das Protokoll der Instanz in `@opengewerk/platform-web`. Was eine
  Anwendung dazu sagt, gibt sie als Vokabular mit: wie ihre Tabellen und Spalten heißen, welche
  Teile das Protokoll eines Datensatzes mitnimmt, woran ein Datensatz zu erkennen ist, und die
  Wörter, die das Fundament für seine eigenen Tabellen und Gründe von ihr braucht. Ein
  Baukasten (`auditVocabularyGaps`) hält das Vokabular gegen den Katalog der Datenbank; dass er
  Wörter für die Einstellungen eines Betreibers meldete, eine Tabelle, die diese Anwendung erst
  mit ihrer ersten Einstellung anlegt, ist im Fundament berichtigt (`#505`). Die Tests des
  Fundaments laufen in der CI dieses Repositorys mit: 112 in `platform-domain`, 552 in
  `platform-server` (vorher 526) und 728 in `platform-web`
- Das Fundament ist auf den Stand mit dem Geltungsbereich der Regel-Engine angehoben
  (`opengewerk/opengewerk#506`, #16). Eine Regel gilt bundesweit oder in einem Land, und eine
  Abfrage nennt neben dem Tag auf Wunsch das Land: eine Regel für Baden-Württemberg ist für
  Bayern keine Antwort, eine bundesweite gilt in jedem Land. Gilt ein Schlüssel am selben Tag
  bundesweit und in einem Land, lehnt der Aufbau das Paket ab, weil jede Antwort geraten wäre.
  Dazu kommen die Einheiten, die Pflichten eines Gebäudes brauchen (Monate, Zehntelgrad Celsius,
  Kilowatt, Kilogramm und Tonnen CO₂-Äquivalent, Anzahl je 100 ml), und die Prüfung auf Lücken je
  Schlüssel und Geltungsbereich (`ruleHoles`). Benutzt wird davon hier noch nichts, das kommt mit
  den Pflichtenpaketen. Die Tests des Fundaments laufen in der CI dieses Repositorys mit, in
  `platform-domain` jetzt 130 statt 112
- Das Fundament ist auf den Stand mit Dateispeicher, Renderer, E-Mail und Push angehoben
  (`opengewerk/opengewerk#507` bis `#512`, #23). Die Ablage von Dateien nach ihrem SHA-256, der
  Stand der nächtlichen Sicherung, der Druck über den Renderer, der Mailserver eines Mandanten mit
  Postausgang und Job, Push und der Weg vom Anlass zur Nachricht liegen damit in
  `@opengewerk/platform-server`. Zwei Tabellen davon trägt das Fundament selbst, die Dateien eines
  Betreibers und seinen Mailserver; die Migration `0005_files_and_mail_settings` legt sie an, wie
  die Bausteine des Fundaments sie beschreiben, und die Prüfung von Sicherung und Rückspielen zählt
  beide mit und findet eine Datei im Speicher. Gebunden wird davon hier noch nichts: der
  Dateispeicher kommt mit den Dokumenten, der Renderer mit dem ersten PDF, Mailserver, Postausgang
  und Push mit den Benachrichtigungen, alle in Phase 1 und jeweils mit ihren Rechten und ihren
  Tafeln; bis dahin geht eine Einladung als Link hinaus. Die Tests des Fundaments laufen in der CI
  dieses Repositorys mit, in `platform-domain` jetzt 137 statt 130 und in `platform-server` 740
  statt 552
- Das Fundament ist auf den Stand mit der Fristen-Engine angehoben (`opengewerk/opengewerk#513`
  bis `#516`, #24). Fristart und Frist in Tagen oder Monaten, der Lauf, der die Fristen mit ihren
  Quellen abgleicht und je Fälligkeit genau einmal erinnert, die Routen unter `/deadlines` und die
  Bildschirme "Fristen" liegen damit im Fundament, dazu `GET /deadlines/run`, über das ein Lauf,
  der nicht stattgefunden hat, im Büro sichtbar wird. Zwei Tabellen davon trägt das Fundament
  selbst, was ein Betreiber für eine Fristart einstellt und wann der Lauf ihn zuletzt durchging;
  die Migration `0006_deadlines` legt sie an, wie die Bausteine des Fundaments sie beschreiben, und
  die Prüfung von Sicherung und Rückspielen zählt beide mit einer ersten Zeile. Das
  Änderungsprotokoll sieht die Läufe nicht, die Liste dafür übernimmt `audit.test.ts` jetzt vom
  Fundament, statt sie auszuschreiben. Gebunden wird die Engine hier mit den Pflichten (#25), deren
  Fristen Liegenschaft und Bereich tragen. Die Tests des Fundaments laufen in der CI dieses
  Repositorys mit, in `platform-domain` jetzt 160 statt 137 und in `platform-server` 774 statt 740
- `pnpm run check:toolchain` vergleicht auch die Fassungen der Abhängigkeiten, die ein Paket
  dieser Anwendung und ein Paket des Fundaments beide laden, zuerst `drizzle-orm` und `pg`. Zwei
  Fassungen davon in einem Prozess hießen Tabellen, die mit der einen angelegt und mit der
  anderen abgefragt werden; die Prüfung wird rot, sobald das Fundament eine Fassung hebt und die
  Anwendung nicht folgt
- Planungskonzept auf v0.7: eigene Anlagenarten des Betreibers kommen in Phase 2, zusammen mit
  den eigenen Feldern, mit denen sie in Abschnitt 4.2 stehen; bis dahin hatten sie keine Phase
  (#52). Damit der Pilotbetrieb in Phase 1 trotzdem seinen ganzen Bestand erfassen kann, auch
  Heizung, Lüftung und Aufzüge, deren Pakete erst in Phase 2 erscheinen, kommt in Phase 1 das
  Paket Allgemein mit einer allgemeinen Anlagenart je Kostengruppe nach DIN 276, ohne
  Pflichtarten. Die Mängelklassen stehen in der Zuordnung bei Phase 1, mit den Mängeln; wo sie
  im Paket stehen, ist unter den offenen Punkten in Abschnitt 15 (#59)
- Planungskonzept auf v0.6: Abschnitt 7 nennt die Rechte für den Abgleich, "Daten abgleichen"
  und "Änderungen senden". Alle vier Rollen haben beide, weil der Abgleich ein anderer Weg
  hinein ist und kein eigenes Tun: was ein Gerät sendet, entscheiden die übrigen Rechte Vorgang
  für Vorgang. Katalog und Rollen in `packages/domain` haben sie ebenso
- Planungskonzept auf v0.5: Abschnitt 7 nennt für die vier Rollen aus Phase 1 jedes Recht
  einzeln, in den Worten, die ein Betreiber liest, wenn ihm eines fehlt. Zugänge, Einstellungen
  und Änderungsprotokoll hat nur die Leitung; die Struktur der Liegenschaften, das
  Pflichtenverzeichnis und die Fristen pflegen Leitung und Technische Leitung; die
  Objektleitung plant, verteilt und nimmt ab und pflegt die Anlagen ihrer Bereiche. ADR 0002
  nennt im Nachtrag die Namen für den Ort, die Rechte und die Rollen im Code
- Die Fristen-Engine und das Anlegen von Hand legen einen Vorgang über dieselbe Funktion an und
  halten dabei die Pflicht fest (#183), damit von zweien zur selben Zeit nur einer einen Vorgang
  anlegt und eine Pflicht nie zwei laufende hat
- Die Prüfung "Breiten und Auflösungen" misst auf mehreren Seiten des Browsers zugleich
  (`opengewerk#576`, mit dem Fundament angehoben), hell und dunkel nebeneinander. Nacheinander
  brauchte der Job 30 Minuten und war der längste der CI. Dazu nennt die Haustechnik eine eigene
  Grenze von 160 Arten von Seiten: mit 106 stand sie nahe an den 120, bei denen der Gang durch
  die Seiten abbricht
- Das Security-Review jedes Pull Requests läuft in GitHub Actions, mit dem Workflow der
  Organisation (`opengewerk/.github#27`): für einen Branch dieses Repositorys von einem Mitglied
  mit Tests und PoCs gegen eine eigene Testdatenbank auf Port 5434, für einen PR von außen nur
  lesend. Geprüft wird der neueste Commit, ein neuer Push bricht den Lauf davor ab; das Ergebnis
  steht als Kommentar am PR und als Status `PR-Security-Review`. Der Aufruf heftet einen Commit
  des Workflows an, damit eine Änderung dort erst mit einem PR hier wirkt. Bisher lief das
  Review auf dem Rechner von Moritz mit einem kostenlosen Modell, dessen Kontingent am
  10.10.2026 aufgebraucht war
- Das Security-Review läuft gehärtet (`opengewerk/.github#31`, Aufruf angehoben auf dessen
  Commit): die Shell des Agenten in der Sandbox von Claude Code ohne Zugang zum Identity-Token,
  ohne sudo und ohne Netz außer der npm-Registry, kein Schreiben, keine Einstellungen aus dem
  PR, und vorbestehende Lücken als Code-Scanning-Alerts statt im öffentlichen Bericht. Vorher
  lief Code aus dem PR im selben Job wie das Recht auf ein Identity-Token
- Das Security-Review gibt einen PR frei oder verlangt Änderungen, wie früher der lokale Reviewer,
  und läuft mit einem zweiten Konto weiter, wenn das Guthaben des ersten aufgebraucht ist
  (`opengewerk/.github#32` bis `#34`, Aufruf angehoben). Ein PR von außen bekommt nie eine
  Freigabe, nur einen Kommentar: über ihn urteilt ein Modell, das Text aus dem PR lenken kann.
  Hebt ein PR den Aufruf an, liest das Review den Diff des Workflows aus dessen Repository; bisher
  blieb der neue Commit für das Review ein offener Punkt.
- Das Security-Review stoppt Docker, bevor es sudo abschaltet, und prüft beides; den Checkout, in
  dem der Agent schreiben kann, entfernt es gleich nach ihm, bevor der Post-Schritt von
  `actions/checkout` dort git aufruft. Lässt sich das Review am PR nicht ablegen, steht der Status
  auf `error` statt dauerhaft auf "läuft" (`opengewerk/.github#35` und `#36`, Aufruf angehoben).
  Vorher war Docker ein zweiter Weg zu root, und eine Git-Konfiguration aus der Sandbox hätte nach
  ihr außerhalb laufen können.
- Das Security-Review kann Tests ausführen, auch mit Datenbank: es startet die Testdatenbank dieses
  Repositorys als PostgreSQL 18 in seiner Sandbox, erreicht die Registry über deren Proxy, findet
  `pnpm` im Pfad und installiert in einer Kopie des Checkouts (`opengewerk/.github#38` und `#40`,
  Aufruf angehoben, mit der Eingabe `database`). Vorher ließ sich in der Sandbox nichts
  installieren, und was erst die Datenbank durchsetzt, Policies, Trigger und die Rechte der Rollen,
  blieb nur gelesen.
- Die Prüfung "Breiten und Auflösungen" misst den Katalog als eine Art von Seite je Bildschirm
  (#227): ein Paket, jeder Teil eines Pakets und eine Pflichtart, statt jedes Paket und jeden
  Eintrag für sich (`keys` an `checkWidths`, `opengewerk#592`, Submodul angehoben). Das waren 50 der
  177 Arten, aus ihnen werden 9; die Grenze des Gangs sinkt von 220 auf 150. Mit jedem Paket wuchs
  der Gang bisher um Dutzende Seiten, die denselben Bildschirm zeigen
- Kostengruppen ohne die Überschriften der DIN 276 (#163): im Filter des Anlagenverzeichnisses
  und in der Karte "Anlagen nach Kostengruppe" eines Gebäudes steht eine Kostengruppe jetzt als
  Nummer und dahinter die Bezeichnung der allgemeinen Anlagenart aus dem Paket Allgemein, etwa
  "KG 460 Förderanlage". Die Liste der neun Überschriften in `packages/domain`
  (`costGroupNames`) ist entfernt; `costGroupName` und `costGroupWords` lesen die Bezeichnung
  aus dem Katalog des Geräts, und eine Gruppe ohne allgemeine Anlagenart steht als Nummer
  allein. Die Überschriften standen im Wortlaut der Norm da, und Abschnitt 5 des Konzepts lässt
  von einer privaten Norm nur den Verweis und die Sache in eigenen Worten zu (Konzept v0.28,
  Nachtrag in ADR 0005). Die Zahl je Kostengruppe auf der Seite eines Gebäudes führt jetzt wie
  ihre Bezeichnung in die gefilterte Liste, wie die Tafel sie zeigt
- Im Änderungsprotokoll steht hinter einer Pflicht, woran sie hängt (#258): "Hauptprüfung der
  Aufzugsanlage, AN-00011 Aufzug Schulhaus". Dieselbe Pflichtart steht an vielen Anlagen, und
  ihre Einträge standen gleich untereinander; welche Anlage gemeint war, zeigte erst der
  geöffnete Eintrag. Genannt wird die Anlage, ohne Anlage der Raum, das Gebäude oder die
  Liegenschaft, auch bei einem verworfenen Vorschlag: in der Liste, hinter "Änderungen" auf der
  Seite der Pflicht, wo ein Feld auf die Pflicht zeigt, und im Protokoll als Tabelle. Eine Anlage
  heißt im Protokoll jetzt mit Nummer und Bezeichnung, weil zwei Anlagen dieselbe Bezeichnung
  tragen können. Das Fundament bringt dafür `standsAt` im Vokabular des Protokolls mit
  (`opengewerk#607`, Submodul angehoben)
- Die Bezeichnung einer Frist nennt eine Anlage mit der Nummer zuerst: "Hauptprüfung der
  Aufzugsanlage, AN-00012 Aufzug Schulhaus" (#264). Dort stand "Aufzug Schulhaus (AN-00012)",
  während das Büro eine Anlage überall sonst "AN-00012 Aufzug Schulhaus" schreibt; im
  Änderungsprotokoll standen seit #258 beide Formen untereinander. Die Bezeichnung wird bei jedem
  Lauf der Fristen neu geschrieben, bestehende Fristen ziehen also von selbst nach
- Im Änderungsprotokoll stehen die Spalten, die die Datenbank als JSON hält, nicht mehr roh da
  (#263). Die Angaben der Anlagenart liest es wie die Akte der Anlage, "Feuerwehraufzug: Nein,
  Haltestellen: 5", wo `{"stops": 5, "firefighters_lift": false}` stand; die Bezeichnungen kommen
  aus dem Katalog, auf dem Server aus seinem, im Büro aus dem des Geräts. Vom eingefrorenen Stand
  eines Nachweises und eines Rundgangs und von den Kapiteln und Punkten einer Fassung einer
  Vorlage sagt das Protokoll nur noch, dass sie gesetzt wurden: der Server schickt den Wert nicht
  mehr mit, zu lesen ist er auf der Seite des Nachweises, des Rundgangs und der Vorlage. Das
  Fundament fragt dafür die Anwendung, wie ein Wert zu schreiben ist (`opengewerk#609`, Submodul
  angehoben)
- Der Import von Anlagen fragt bei Dubletten wie das Formular über die Grenze der Bereiche (#255,
  Konzept v0.32). Bisher zählte nur als Dublette, was die Person sieht: zwei Bereiche, die je ihre
  Liste einlasen, legten dieselbe Anlage unbemerkt doppelt an, und auffallen konnte das erst der
  Leitung. Eine Zeile, deren mögliche Dublette außerhalb der eigenen Bereiche liegt, steht jetzt
  in der Vorschau unter "Gibt es vielleicht schon" mit dem Feld, das sie teilt, und wartet auf
  ihre Entscheidung wie jede andere. Von der anderen Anlage verlässt den Server nichts als dieses
  Feld: keine Kennung, keine Nummer, kein Name, kein Ort, keine Zahl. Die Funktion der Datenbank,
  die dafür über die Bereiche hinaussieht, nimmt Listen entgegen (Migration
  `0045_duplicates_of_a_list`), damit eine Tabelle mit bis zu 10.000 Zeilen in einem Durchgang
  gefragt wird; es bleibt die eine Funktion (ADR 0003, Nachtrag vom 13.10.2026)
- Das Änderungsprotokoll nennt in der Spalte "Änderung" die Werte, wenn sich ein oder zwei Felder
  geändert haben: "Frist in Monaten: 6 → 12" statt "Frist in Monaten" (#260). Wer das Protokoll
  las, sah bisher nur, welches Feld sich geändert hatte, und musste jede Zeile öffnen, um zu
  sehen, wie. Ab drei Feldern bleibt es bei den Namen; ein Wert mit mehr als 24 Zeichen wird nicht
  ausgeschrieben, die Zeile sagt dann "Begründung der Frist neu", "geändert" oder "entfernt".
  Dasselbe steht in der Tabelle, die das Protokoll hinausgibt. Die Tafel der Haustechnik zeigte
  den Bildschirm an mehreren Stellen anders als das Fundament ihn baut; entschieden ist, dass der
  Bildschirm bleibt und nur dieser eine Punkt der Tafel gebaut wird. Die Tafel
  `HT-Einst-Protokoll` ist nach dem Bildschirm neu gezeichnet (`opengewerk#616`, Submodul
  angehoben)
- Die Verfahrensbeschreibung ist auf den Stand von Phase 1 gebracht (#140): der Tausch einer Anlage
  mit einer eigenen Pflicht (wer als bestätigend und als verantwortlich an der neuen steht) und die
  Importe aus einer Vorgängeranwendung (Altbestand ohne Person, übernommene Zählerstände, ein
  Eintrag im Änderungsprotokoll je Datensatz, keine übernommenen Konten) sind Zusagen mit Tests.
  Abschnitt 9 nennt nicht mehr, was gebaut ist, sondern was Phase 1 noch bringt. Eine
  Arbeitnehmervertretung soll vor dem Parallelbetrieb lesen, was die Fassung tut, die sie bekommt.

### Behoben

- Ein Test der Vorschau wurde an einem Donnerstag rot (die Liste der Mängel in den Beispieldaten):
  der Mangel aus dem Rundgang hat den letzten Mittwoch, der Mangel "Kratzgeräusch" war zwei Tage
  alt, und ab Donnerstag stand der eine vor dem anderen. Das Kratzgeräusch ist jetzt von heute, und
  die Reihenfolge hängt nicht mehr am Wochentag.
- Die Befunde im Fundament vor der ersten Fassung, mit dem Anheben des Submoduls
  (`opengewerk/opengewerk`, Meilenstein "Phase 0: Fundament (schlank)", entschieden am 14.10.2026):
  eine Aufgabe, die auf zwei Wegen erledigt wird, im Büro und danach auf einem Gerät, das sie noch
  offen hielt, ist kein Konflikt mehr (`opengewerk/opengewerk#601`; ein Test hält es an der Aufgabe "Zähler ablesen");
  eine Runde des Abgleichs, die das Netz während eines scheiternden Austauschs anstößt, findet
  statt (`opengewerk/opengewerk#572`); ein Knopf, der nach dem Drücken gesperrt wird, behält den Fokus der Tastatur
  (`opengewerk/opengewerk#629`); die Anmeldung startet ohne die Warnung von better-auth, und die Tests laufen mit
  derselben Prüfung der Herkunft wie eine Instanz (`opengewerk/opengewerk#551`); in „Zugänge“ stehen die Knöpfe einer
  Zeile bei 1280 Pixeln auch neben „Alle Liegenschaften“ nebeneinander (`opengewerk/opengewerk#562`); ein Hinweiskasten
  mit zwei Knöpfen lässt dem Satz auf dem Telefon seine Breite (`opengewerk/opengewerk#564`), und der Kasten "Mögliche
  Dublette" im Formular einer Anlage gibt seine Knöpfe wieder in die Aktion des Bausteins.
- Zählweise ab dem fälligen Tag (#77): Eine Durchführung erfüllt den offenen Termin, wenn sie
  höchstens ein Zwölftel der Frist vor ihm liegt (bei einer jährlichen Pflicht ein Monat), und der
  Rhythmus bleibt; liegt sie früher, zählt die Frist neu ab ihrem Tag, wie Abschnitt 4.4 des
  Konzepts es nach § 14 Abs. 5 BetrSichV festlegt. Bisher erfüllte jede Durchführung nach der
  ersten schon den nächsten Termin, wenn sie nur nach dem letzten lag, und ein ganzes Intervall
  fiel aus
- Die Rücknahme von Migration 0025 schreibt den Grund "migration" an jede Zeile, die sie ändert oder
  löscht (#188): Fotos an Mängeln, Fristen von Mängeln, Tag und Bemerkung einer Nachprüfung und die
  Vorgaben der Mängelklassen. Bisher setzte sie den Grund in einem eigenen Stück zwischen zwei
  Trennern, und er galt nur bis zum Ende von dessen Transaktion; im Protokoll des Betreibers standen
  die Zeilen ohne Grund
- Was beim Unterschreiben erst am Nachweis auffiel, lehnt der Server jetzt an der Unterschrift ab
  (#79): einen Tag der Durchführung in der Zukunft und eine Pflicht, deren Art ihren Nachweis
  anders nimmt. Bisher fiel beides erst mit der letzten Unterschrift auf, beim Schreiben des
  Nachweises, und dann für die ganze Übertragung eines Geräts statt für die eine Unterschrift
- Den Zeitpunkt einer Unterschrift nimmt der Server vom Gerät nur noch, wenn er höchstens fünf
  Minuten nach seiner eigenen Uhr liegt und nicht vor dem Tag der Durchführung (#79), und der Stand
  eines Nachweises (Fassung 7) hält daneben, wann der Server die Unterschrift bekam. Die Seite eines
  Nachweises und die PDFs nennen beide Zeitpunkte. Bisher stand die Uhr des Geräts ungeprüft und
  für immer im Nachweis
- Die Karte eines Konflikts an einem Zählerstand, einer Notiz zu einem Auftrag oder einer Fassung
  eines Dokuments sagt, was geschehen ist und was zu tun ist, und schließt nur noch (#79). Bisher
  bot sie "Fassung vom Gerät übernehmen" an, was bei einem Datensatz, den niemand ändert, nie
  gelingen konnte. Ein Zählerstand heißt dort nach dem Tag, an dem er abgelesen wurde
- Eine Pflicht, zu der es einen Nachweis oder einen unterschriebenen oder geschlossenen Vorgang
  gibt, lässt sich nicht mehr entfernen, nur beenden (#79). Bisher nahm `DELETE /duties/:id` sie
  weg, und mit ihr ihre Zeile an einem festgeschriebenen Vorgang. Gefunden hat das der Test über
  alle Routen, der jetzt jede Route auch mit einem Rumpf aufruft, der zurücksetzen will, und
  Löschung, Fassung und Änderungsfolge des festgeschriebenen Vorgangs mit vergleicht
- Der Kopf einer Seite im Büro bleibt auf dem Desktop eine Zeile, wie auf den Tafeln
  (`opengewerk#585`, mit dem Fundament angehoben): Der Titel gibt nach und seine Abzeichen brechen
  um, die Knöpfe bleiben rechts. Bisher rutschten die Knöpfe unter den Titel, sobald nicht alles
  nebeneinander passte, am Nachweis mit "PDF öffnen" (#111) zum ersten Mal sichtbar
- Ein Gerät ohne Katalog sagt, wenn der Katalog seines Servers in einem Format kommt, das seine
  Fassung der Anwendung nicht lesen kann (#160): "Er kommt, sobald die neue Fassung übernommen
  ist", auf dem Bildschirm "Katalog" und bei den Vorlagen aus den Paketen. Bisher hieß es dort, er
  komme mit der nächsten Verbindung zum Server, und das stimmte in diesem Fall nicht
- Eine Antwort oder ein Ergebnis, das im selben Augenblick wie eine Unterschrift über den Abgleich kommt,
  wartet auf sie (opengewerk#582). Bisher las das Tor des Fundaments den Vorgang ohne Sperre: Die Antwort sah
  ihn noch als begonnen, landete, nachdem die Unterschrift die Seite gelesen hatte, und der Nachweis hielt eine
  andere Antwort als die Zeile. Jetzt findet sie den Vorgang unterschrieben und wird abgelehnt. Ein Mangel in
  einem Vorgang nimmt dieselbe Sperre statt der geteilten aus #108, damit zwei Geräte, die einen Vorgang
  zugleich unterschreiben, am Vorgang warten und das zweite einen Konflikt bekommt statt eines Fehlers.
- Ein Mangel, der in einem Vorgang gemeldet wird, kommt über den Abgleich nur noch an, solange der Vorgang
  offen oder begonnen ist (#108). Bisher nahm der Server ihn für jeden Stand an; in einem unterschriebenen
  Vorgang änderte er die Seite, für die unterschrieben war, und die Unterschrift zählte danach nicht mehr. Jetzt
  ist er ein Konflikt "festgeschrieben", und vor Ort ist "Mangel melden" in einem solchen Vorgang gesperrt.
  Ein Mangel, der im selben Augenblick wie eine Unterschrift ankommt, wartet auf sie, statt zwischen der
  geprüften Seite und der Unterschrift zu landen
- Drei Prüfungen im Server, die ein gleichzeitiger Zugriff oder ein Umzug umging (#78): Zwei Anlagen,
  die im selben Augenblick untereinander gehängt werden, warten jetzt an ihrem Gebäude aufeinander,
  und die zweite sieht, dass sie unter ihrer eigenen Komponente hinge; bisher prüfte jede die Kette,
  wie sie vorher war, und beide gingen durch. Ein Ort, auf den ein Datensatz vom Gerät zeigt, wird
  geteilt gesperrt gelesen, sodass ein Löschen im selben Augenblick abgewartet wird und die
  Übertragung "fehlt" bekommt statt eines Raums auf einem gelöschten Geschoss. Ein Raum, an dem
  Pflichten, Vorgänge, Mängel, Dokumente oder Etiketten hängen, zieht mit einem Satz, der sie nennt,
  nur innerhalb seiner Liegenschaft um; bisher scheiterte der Umzug an der Datenbank ohne Satz
- Eine Berichtigung und eine Ungültigerklärung desselben Nachweises, im selben Moment geschickt, gehen nicht mehr beide
  durch (#78, Befund T13-2 aus dem Review der Phase 0). Beide prüften, was aus dem Nachweis geworden war, ohne einander zu
  sehen; so konnte ein für ungültig erklärter Nachweis zugleich berichtigt sein, und eine zweite Berichtigung scheiterte
  erst am Schlüssel der Datenbank, ohne Satz. Jetzt halten beide zuerst die Zeile der Pflicht, und die zweite findet,
  was die erste schrieb
- Wer an einer Pflicht aus dem Katalog nur die verantwortliche Person oder den Ausführenden ändert, wird nicht
  mehr nach einer Begründung der Frist gefragt (#101). `PATCH /duties/:id` prüfte bei jeder Änderung, ob die
  Frist vom Richtwert von heute abweicht; eine Pflicht, die vor einer Änderung des Richtwerts bestätigt wurde,
  ließ sich dadurch niemandem mehr zuordnen, bis jemand eine Begründung nachtrug. Gefragt wird jetzt, wenn die
  Frist oder ihre Begründung sich ändert
- Das Formular einer Liegenschaft beginnt neu, wenn nur seine Adresse auf eine andere Liegenschaft wechselt
  (#86). Über den Verlauf des Browsers führt ein Schritt von einem Formular in ein anderes, und bisher standen
  dann unter der Überschrift der einen Liegenschaft die Eingaben der anderen; "Speichern" hätte sie dorthin
  geschrieben. Die Formulare für Gebäude, Geschoss und Raum sind von Anfang an so gebaut
- "Liegenschaft entfernen" bleibt links stehen, wenn der Server das Entfernen ablehnt (#86). Sein Satz stand
  zwischen den Knöpfen des Formulars und brach ihre Zeile um, und der Knopf, den jemand eben gedrückt hatte,
  sprang an den rechten Rand. Jetzt steht der Satz unter allen Knöpfen, und keiner bewegt sich. Die Formulare
  für Gebäude, Geschoss und Raum sind von Anfang an so gebaut
- Der Test der Karte "Ansprechpartner", der einen neuen Ansprechpartner anlegt, wartet darauf,
  dass sich das Formular schließt (#85). Die Zeile kommt mit dem Abgleich an, das Formular
  schließt erst, wenn die Route geantwortet hat, also einen Augenblick später; der Test fragte
  sofort und war auf `main` rot, sobald die Maschine die Zeile zuerst zeichnete. An der Karte
  selbst ändert sich nichts
- Kleinere Befunde an Werkzeugen, Tests und Dokumentation aus dem Review der Phase 0 (#80): Die
  Nummer einer Fassung im Katalog hat höchstens drei Stellen, und eine Lücke in den Fassungen nennt
  die erste fehlende Nummer, statt eine Liste bis zur höchsten zu bauen. Produktionscode des Servers
  bindet weder die Vorschau noch einen Testhelfer ein; das hält jetzt eine Lint-Regel statt nur der
  Ausschluss aus dem Abbild. Das Änderungsprotokoll schreibt jeden Wert einer Liste in den Wörtern
  der übrigen Seiten ("Mit Mängeln" statt `with_defects`), und ein Test hält jede überwachte Spalte
  mit einem Aufzählungstyp dagegen. Die Prüfung der Breiten öffnet "Betreiber anlegen", das
  Webpaket hat seinen Test der `package.json`, der Schritt der CI zur Sicherung sagt, was er prüft,
  und die README sagt, dass eine Rücknahme als Superuser und nach einer Sicherung läuft
- Zwei Unterschriften derselben Seite, die zugleich ankommen, schreiben einen Vorgang nur noch
  einmal fest, und zwei Abnahmen desselben Auftrags nehmen ihn nur einmal ab
  (`opengewerk-haustechnik#31`). Zwei Geräte, die ohne Netz unterschrieben hatten und zugleich
  sendeten, wurden je gegen Unterschriften geprüft, die das andere noch nicht geschrieben hatte,
  und beide schrieben je Pflicht einen Nachweis, den niemand mehr ändern oder löschen kann. Die
  Prüfung hält die Zeile des Vorgangs jetzt bis zum Ende ihrer Transaktion; die zweite wartet und
  findet den Vorgang abgeschlossen.
- Der Nummernkreis für Aufträge fehlte in der Ausgangsmigration. Das Konzept nennt für das
  Fundament drei Kreise, für Anlagen, Nachweise und Aufträge (Abschnitt 12, Phase 0; Abschnitt
  4.8; ADR 0002, Punkt 13); angelegt waren zwei. Die Migration `0001_work_order_numbers` trägt
  den dritten nach, an seiner Stelle zwischen Anlage und Nachweis, mit Rücknahme. Eine gemergte
  Migration wird nicht geändert, deshalb eine zweite. Dazu die ersten Tests für ein Update: eine
  Datenbank auf dem Stand der ersten Migration, mit Zählern eines Betreibers, bekommt den Kreis
  und behält ihre Zähler; die Rücknahme entfernt nur den Zähler der Aufträge und schreibt den
  Grund in das Protokoll des Betreibers
- Die README nannte für die Tests eines einzelnen Pakets den Aufruf
  `pnpm run test -- --filter=<paket>`. pnpm reicht das `--` mit weiter, der Filter landet dann
  beim Testläufer jedes Pakets, und der kennt ihn nicht. Richtig ist
  `pnpm run test --filter=<paket>`
- "Bericht eintragen" nennt die Fremdfirma, die an der Prüfung geplant ist, von der man kommt
  (#186), auch wenn die Pflicht eigene Durchführung sagt; von der Seite der Pflicht aus bleibt es
  die Fremdfirma der Pflicht. Das Feld "Organisation" blieb sonst leer, obwohl die Firma am Vorgang
  stand
- Im Änderungsprotokoll heißt ein Nummernkreis nach dem, was er zählt: "Anlagen", "Aufträge",
  "Nachweise" (#176), als Name des Datensatzes, in seinen Feldern und unter "Nur dieser Datensatz".
  Bisher stand dort sein Schlüssel, etwa "asset", und jede neue Anlage schrieb einen solchen
  Eintrag
- Die Prüfung "Breiten und Auflösungen" wartet nach dem Laden, bis ein Bildschirm gezeichnet ist,
  und auf einen Knopf, bevor sie ihn "nicht zu sehen" nennt; zu einem solchen Befund legt sie ein
  Foto der Seite in den Bericht und nennt die Anfragen, die beim Laden scheiterten (#231,
  `opengewerk#591` und `#593`, Submodul angehoben). Bisher fragte sie sofort und meldete nur "nicht
  zu sehen": Sie wurde an Seiten rot, die niemand geändert hatte, jedes Mal an einer anderen, auch
  auf `main`, und warum, stand nirgends
- Ein Befund der Prüfung "Breiten und Auflösungen" zählt erst, wenn eine zweite Messung derselben
  Seite ihn wieder findet, und eine Seite, die nach zehn Sekunden nichts gezeichnet hat, ist ein
  eigener Befund mit dem, was sie dabei meldete (#231, `opengewerk#614`, Submodul angehoben). Trotz
  des Wartens oben war die Prüfung am 13.10.2026 in drei von vier Läufen an einer Seite rot, die
  der Pull Request nicht anfasste: die Seite hatte gar nicht gezeichnet und stand beim nächsten
  Lauf. Was nur eine der beiden Messungen fand, steht im Bericht, zählt nicht, und der Lauf zeigt
  dazu eine Warnung; der Job lädt die Fotos dann auch hoch, wenn er grün ist. Warum eine Seite
  manchmal nicht startet, klärt das nicht; dafür nennt der Befund jetzt, ob ihr Skript lief und
  was es meldete
- Der Test zum Katalog, den diese Fassung nicht lesen kann (`sync/catalogue.test.tsx`, #160), wartet
  auf beide Schreibungen des Geräts (#272). Kommt ein lesbarer Katalog, schreibt das Gerät erst ihn
  und danach, dass der Vermerk über den unlesbaren geht. Der Test wartete auf das Erste und prüfte
  das Zweite sofort; unter Last war er deshalb in einem von drei ganzen Läufen rot
- Die Tests der Oberfläche geben einem Warten zehn Sekunden und einem Test dreißig (#277), wo die
  Werkzeuge nach einer und nach fünf aufgeben. Auf einer Maschine, deren Kerne alle belegt sind,
  waren acht von acht ganzen Läufen rot: ein Test, der ein Formular ausfüllt, wartet für jede Taste
  eine Runde der Ereignisschleife ab, und ein abgebrochener tippte in das Formular des nächsten
  weiter. Ein Warten kehrt zurück, sobald da ist, worauf es wartet; ein grüner Test wird davon
  nicht langsamer
- Der Test der Wochenübersicht der Rundgänge (`round-plans.test.ts`) nimmt die Woche von morgen
  statt der von heute (gefunden bei #74). An einem Sonntag hält die laufende Woche nur einen
  Rundgang des Plans, der heute beginnt, und der Test brauchte zwei; er schlug jeden Sonntag fehl
- Die Auswahlkästchen in den Vorschlägen aus dem Katalog, in den Plänen der Rundgänge und in den
  Vorlagen sind kupferfarben wie auf den Tafeln (gefunden bei #139). Ihre Klasse nannte eine Farbe,
  die es nicht gibt, und der Browser zeichnete sie in seinem Blau
- Die Seite einer entfernten Pflicht sagt "Nicht gefunden", auch in einem Reiter im Hintergrund
  (#246). Dort stand "Gerade ist keine Verbindung da", obwohl der Server mit 404 geantwortet
  hatte: der Abfrage-Client des Fundaments stellte eine abgelehnte Anfrage ein zweites Mal, und
  dieser Versuch wartet auf ein Fenster, das jemand ansieht. Das Fundament wiederholt jetzt nur,
  was sich durch erneutes Fragen ändern kann (`opengewerk#604`, Submodul angehoben). Dasselbe
  galt für die Akte einer Anlage, die Seite eines Nachweises, den Bericht, die Seite eines Raums
  und das Anlagenverzeichnis; Mangel, Auftrag und Zeitachse legten ihr Wiederholen schon selbst
  fest. Ein Test stellt den Reiter im Hintergrund an der Seite der Pflicht nach
- Im Änderungsprotokoll heißt eine Pflicht aus dem Katalog wie auf ihrer Seite: mit der
  Bezeichnung ihrer Pflichtart (#245). Dort stand der Schlüssel, etwa
  `elektro.installation_test_dguv_v3`, weil eine solche Pflicht keine eigene Bezeichnung hat und
  das Protokoll nur den Schlüssel festhält. Das gilt in der Liste, hinter "Änderungen" auf der
  Seite der Pflicht, für einen verworfenen Vorschlag und im Protokoll als Tabelle. Auch die
  übrigen Schlüssel des Katalogs stehen jetzt mit ihrer Bezeichnung da: die Anlagenart, das
  Formular eines Vorgangs, die Klasse eines Mangels und die Vorlage, aus der ein Rundgang
  übernommen wurde. Die Bezeichnung kommt aus dem Katalog, auf dem Server aus seinem, im Büro
  aus dem des Geräts. Kennt der Katalog einen Schlüssel nicht mehr, bleibt der Schlüssel stehen
- Im Änderungsprotokoll stehen Namen, wo Kennungen standen (#259): an einer Pflicht das Dokument,
  das die Frist trägt, und seine Fassung; am Mangel die Antwort, aus der er kommt; an einer Frist
  die Aufgabe und die Liegenschaft, deren Zähler abzulesen sind; an einer Aufgabe die Person, die
  sie erledigt; am Vorgang eines Rundgangs die Vorlage, wo `template-` mit ihrer Kennung stand;
  am Plan eines Rundgangs die Wochentage, wo `{1,3}` stand. Dem Vokabular fehlte bei diesen
  Spalten, dass sie auf einen Datensatz oder eine Person zeigen. Die "Quelle" einer Frist, eine
  bloße Kennung, zeigt das Protokoll nicht mehr: dieselbe Frist nennt in einer eigenen Spalte die
  Pflicht, den Mangel, den Plan, die Aufgabe oder die Liegenschaft beim Namen. Ein Test hält jetzt
  jede Spalte einer überwachten Tabelle, die auf einen Datensatz zeigt oder eine Person nennt,
  gegen das Vokabular. Das Fundament liest dafür einen Wert als Datensatz, wo er hinter einer
  Vorsilbe auf einen zeigt (`opengewerk#608`, Submodul angehoben)
- Startet das Skript eines Einstiegs nicht, lädt sich die Seite einmal von selbst neu und sagt es
  danach, statt leer zu bleiben (#279). Kam das Skript oder einer seiner Teile nicht an, weil die
  Verbindung riss, weil eine Seite aus einem Zwischenspeicher Teile nannte, die es nach einem Update
  nicht mehr gibt, oder weil der Browser die Anfrage selbst abbrach (#275), blieb die Seite in ihrer
  Grundfarbe stehen und sagte nichts; erst ein neues Laden half, und das wusste niemand. Jetzt steht
  vor dem Skript beider Einstiege, `/` und `/m/`, eine kleine eigene Datei des Fundaments
  (`entryGuard`). Sie hört den Fehlschlag, lädt die Seite einmal neu, und zeigt beim nächsten
  Fehlschlag: "OpenGewerk Haustechnik ist nicht gestartet, ein Teil der Anwendung ist nicht
  angekommen", mit dem Knopf "Neu laden". Verloren geht beim Neuladen nichts, die Anwendung lief
  noch nicht. Ein Teil, der auf Dauer fehlt, lädt die Seite nicht ohne Ende neu: dass schon neu
  geladen wurde, hält der Reiter fest. Der Service Worker hält die Datei wie jedes andere Skript
  vor. Die CI fragt im Lauf "Breiten und Auflösungen" einen echten Browser danach, an beiden
  Einstiegen (`pnpm --filter @opengewerk/haustechnik-web run entries`). Die Zeilen
  `<link rel="modulepreload">` bleiben in der gebauten Seite: der Browser brach auch die Anfrage
  nach dem Skript des Einstiegs selbst ab, sie zu streichen hätte also nicht gereicht
  (`opengewerk#615`, Submodul angehoben)
- Die Prüfung "Breiten und Auflösungen" fotografiert einen Befund bei der Breite, bei der er stand,
  und misst nach einem Wechsel der Breite erst, wenn die Seite ihm gefolgt ist (#280). Jedes Foto
  war 1280 mal 720 Pixel groß und zeigte damit nicht, was bei 320 Pixeln zu breit war. Und die
  Prüfung maß 150 ms nach dem Wechsel der Breite: eine Seite, die bis dahin kein Bild gezeichnet
  hatte, stand noch im Zuschnitt der Breite davor und galt als "bei 320 px 150 px zu breit". Seit
  #231 zählte ein solcher Befund nicht mehr, er kostete aber eine zweite Messung und eine Warnung
  am Lauf, die niemand mehr ernst nimmt, wenn sie oft ohne Grund kommt (`opengewerk#615`)
- Ein Recht, das eine der vier mitgelieferten Rollen nach dem Anlegen eines Betreibers bekommen
  hat, erreicht jetzt auch diesen Betreiber (#270). Die Rollen eines Betreibers sind Zeilen,
  geschrieben an dem Tag, an dem er angelegt wird, und was jemand darf, wird aus ihnen gelesen:
  die Rechte an Dokumenten, Aufgaben und Vorlagen, an Push und am Mailserver hatte deshalb nur,
  wer nach ihnen angelegt wurde. Die Migration `0046_rights_of_shipped_roles` gibt den Zeilen der
  vier Rollen, was ihnen fehlt, nimmt nichts weg, lässt eigene Rollen eines Betreibers, wie sie
  sind, und steht im Änderungsprotokoll mit dem Grund `migration`. Sie gibt nichts zurück, was ein
  Betreiber einer Rolle genommen hätte: die Anwendung darf Rollen bisher nur lesen und anlegen,
  nicht ändern, und ein Test hält das. Von hier an gehört zu jedem
  Recht, das eine der vier Rollen bekommt oder verliert, eine solche Migration: ein Test mit
  einem Betreiber von vor `0046` wird ohne sie rot und nennt Rolle und Recht. Er ersetzt
  `roles-of-a-version.test.ts`, der damit bis zur ersten Fassung warten wollte; der Pilotbetrieb
  soll sein erstes Update nicht ohne diese Regel bekommen
- Raum im Büro: "Anlagen in diesem Raum" zeigt die Anlagenart (#284), wie die Tafel sie zeichnet:
  die Bezeichnung aus dem Katalog des Geräts, bei der allgemeinen Anlagenart einer Kostengruppe
  mit der Kostengruppe dahinter ("Anlage der Wärmeversorgung (KG 420)"), wie der Import sie nennt.
  Auf dem Telefon steht sie in der Karte der Anlage. Bisher sah, wer einen Raum öffnete, nur am
  Namen einer Anlage, was dort steht. Zwei weitere Unterschiede zur Tafel sind mit behoben: der
  Name einer Anlage führt in beiden Tabellen des Raums in ihre Akte, und im Kopf steht "Neue
  Anlage" für alle, die Anlagen aufnehmen. Das Formular beginnt dann im Gebäude und im Raum
  (`/anlagen/neu?gebaeude=…&raum=…`); einen Raum, den das Gebäude der Adresse nicht hat, zeigt
  und sendet es nicht
- Nach dem Lesen der Seriennummer mit der Kamera, auch nach "Von Hand", steht der Fokus wieder
  im Feld "Seriennummer" (`#132`). Der Leser steht an der Stelle des Formulars, und als er
  schloss, stand die Tastatur auf der Seite: was danach getippt wurde, ging verloren. Gefunden
  beim Durchspielen der Kernabläufe nur mit der Tastatur.
- Ein Fehler beim Festschreiben eines Berichts oder einer Unterschrift wird gesagt (#294), statt
  dass der Knopf nichts tut: unter einer Verbindung ohne Verschlüsselung, dass Dateien und
  Unterschriften https brauchen, sonst, dass es auf diesem Gerät nicht ging. Die Eingaben
  bleiben stehen.
- Ein Punkt einer Vorlage, dessen Grenzwert aus einer Regel kommt, behält beim erneuten Öffnen
  seine Grenze (#299). Der Dialog begann dort immer bei "mindestens", und wer ihn nur mit
  "Übernehmen" schloss, machte aus einem Punkt "höchstens" einen zum Erreichen. Gefunden beim
  Einbau von "unter".
