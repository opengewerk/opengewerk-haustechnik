# Import aus Tabellen: das Format

OpenGewerk Haustechnik übernimmt Liegenschaften, Gebäude, Geschosse, Räume, Anlagen,
laufende Fristen mit ihren alten Nachweisen, den Verlauf der Zähler und die Vorlagen der
Rundgänge aus Tabellen, wie sie in einer Tabellenkalkulation geführt werden (Abschnitte 3 und 11
des Planungskonzepts). Diese Seite beschreibt, wie eine solche Tabelle aussieht und was der
Import aus ihr liest. Sie gilt für die Listen eines Betreibers genauso wie für den Weg aus einer
Vorgängeranwendung. Wie die Tabellen einer Vorgängeranwendung zu einem Paket zusammengehören,
steht in [Importpaket.md](Importpaket.md), mit einem Beispielpaket aus erfundenen Daten.

Fünf Importe gibt es, jeder unter der Liste, die er füllt: "Importieren" unter Liegenschaften
für den Bestand vom Standort bis zum Raum, "Importieren" unter Anlagen für die Anlagen in
Gebäuden und Räumen, die es schon gibt, "Importieren" im Pflichtenverzeichnis für die laufenden
Fristen dieser Anlagen, "Importieren" unter Zähler für Stände, Tausche und Stilllegungen der
Messstellen und "Importieren" unter den Vorlagen der Rundgänge. Wer alles aus Listen übernimmt,
importiert in dieser Reihenfolge; die Vorlagen brauchen nichts davon und gehen jederzeit.

## Die Datei

- **Excel-Arbeitsmappe (.xlsx)** oder **CSV (.csv)**. Eine Arbeitsmappe darf mehrere Blätter
  haben; importiert wird eines, das im ersten Schritt gewählt wird. Ausgeblendete Blätter werden
  nicht angeboten.
- CSV mit Semikolon, Komma oder Tabulator als Trennzeichen; welches es ist, erkennt der Import an
  den ersten Zeilen. Gelesen wird UTF-8, UTF-16 und die westeuropäische Kodierung von Windows, die
  eine deutsche Tabellenkalkulation bei "CSV" schreibt.
- Nicht gelesen wird das alte Format `.xls` und eine Arbeitsmappe mit Kennwort. Beides lässt sich
  als `.xlsx` ohne Kennwort oder als CSV speichern.
- Höchstens 10 MB, 10.000 Zeilen und 100 Spalten je Datei, und 2.000 Zeichen je Zelle. Wer mehr
  hat, teilt die Liste in mehrere Dateien.
- Die erste Zeile, in der etwas steht, ist die Kopfzeile mit den Namen der Spalten. Leere Zeilen
  werden übergangen. Wo die Vorschau eine Zeile nennt, meint sie die Zeilennummer der Datei, wie
  die Tabellenkalkulation sie zeigt.
- Aus einer Arbeitsmappe wird gelesen, was in der Zelle zu sehen ist: ein Datum als Tag, eine
  Zahl mit Komma, das Ergebnis einer Formel und nicht die Formel.

Im ersten Schritt gibt es zu jedem Import eine **Vorlage**: eine CSV-Datei mit den Namen aller
Felder als Kopfzeile.

## Spalten und Felder

Welche Spalte welches Feld ist, wird im ersten Schritt zugeordnet. Der Import schlägt die
Zuordnung vor, wo eine Spalte heißt wie das Feld oder wie einer der Namen in den Tabellen unten;
Großschreibung, Leerzeichen und Satzzeichen spielen dabei keine Rolle, "Raum-Nr." ist "raum nr".
Eine Spalte, die keinem Feld zugeordnet ist, bleibt draußen. Die Reihenfolge der Spalten ist
gleichgültig.

## Bestand: Liegenschaften, Gebäude, Geschosse, Räume

Eine Zeile ist ein Weg: "Schulzentrum, Schulhaus, EG, E.14" ist der Raum E.14 und nennt unterwegs
seine Liegenschaft, sein Gebäude und sein Geschoss. Eine Zeile, die beim Gebäude endet, legt nur
das Gebäude an. Liegenschaft, Gebäude und Geschoss stehen deshalb in jeder Zeile ihrer Räume.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Liegenschaft | ja | Objekt, Standort, Liegenschaftsname, Name der Liegenschaft | Name der Liegenschaft; leer gilt die Liegenschaft für alle Zeilen |
| Straße und Hausnummer | | Straße, Adresse, Anschrift | für eine neue Liegenschaft nötig |
| Postleitzahl | | PLZ | fünf Ziffern, für eine neue Liegenschaft nötig |
| Ort | | Stadt, Gemeinde | für eine neue Liegenschaft nötig |
| Bundesland | | Land | Name, Kürzel (BW) oder Code (DE-BW); sonst gilt die Wahl im ersten Schritt |
| Gebäude | | Gebäudename, Gebäudebezeichnung, Haus, Bauteil | Bezeichnung des Gebäudes |
| Kürzel des Gebäudes | | Kürzel, Gebäudekürzel, Gebäude-Nr., Gebäudenummer | höchstens 20 Zeichen |
| Gebäudeart | | Gebäudearten, Art des Gebäudes | eine Gebäudeart, mehrere durch Semikolon getrennt; sonst gilt die Wahl im ersten Schritt |
| Baujahr des Gebäudes | | Baujahr | Jahr, vierstellig |
| Geschoss | | Etage, Stockwerk | Bezeichnung des Geschosses |
| Ebene | | Geschossnummer, Ebene als Zahl | ganze Zahl, 0 ist das Erdgeschoss |
| Raumnummer | | Raum-Nr., Raumnr, Raum Nr, Raum | höchstens 30 Zeichen |
| Raumbezeichnung | | Raumname, Bezeichnung des Raums | höchstens 120 Zeichen |
| Nutzung | | Raumnutzung, Nutzungsart | höchstens 120 Zeichen |

Was dabei gilt:

- **Wiedererkannt wird am Namen**, innerhalb dessen, was darüber liegt: eine Liegenschaft an
  ihrem Namen, ein Gebäude an seiner Bezeichnung in der Liegenschaft, ein Geschoss an seiner
  Bezeichnung im Gebäude, ein Raum an seiner Nummer im Geschoss. Nennt eine Zeile keine
  Raumnummer, wird der Raum an seiner Bezeichnung wiedererkannt, auch wenn er eine Nummer hat;
  tragen mehrere Räume des Geschosses diese Bezeichnung, ist das eine offene Zeile.
  Großschreibung und Leerzeichen zählen nicht.
- **Was es gibt, wird nicht doppelt angelegt und nicht geändert.** Eine Zeile, die nur Vorhandenes
  nennt, steht in der Vorschau unter "Gibt es schon" und legt nichts an. Auch eine andere Adresse
  in der Datei ändert eine vorhandene Liegenschaft nicht.
- **Ein Raum hat eine Nummer oder eine Bezeichnung.** Steht derselbe Raum zweimal in der Datei,
  ist das eine offene Zeile.
- **Die Ebene eines neuen Geschosses** liest der Import aus der Bezeichnung, wenn keine Spalte
  "Ebene" zugeordnet ist: EG, Erdgeschoss, 1. OG, OG 2, 3. Stock, 2. Stockwerk, UG, 2. UG, U1,
  Keller, E-1, Ebene 2 oder eine bloße Zahl. Dachgeschoss, Zwischengeschoss, Tiefgarage und eine
  Zahl mit Punkt oder Komma (1.5) sagen keine Ebene; dafür braucht es die Spalte.
- **Bereich, Bundesland und Gebäudeart** neuer Liegenschaften und Gebäude werden im ersten Schritt
  gewählt, wenn die Datei sie nicht nennt. Wer nur einen Bereich sieht, importiert nur in diesen.
- **Eine Liegenschaft für alle Zeilen** lässt sich dort ebenfalls wählen, für eine Liste, die nur
  ein Haus betrifft und es nirgends nennt. Sie gilt für jede Zeile ohne Liegenschaft, und die
  Spalte ist dann keine Pflicht; nennt eine Zeile eine, gilt die Zeile. Zur Wahl steht, was man
  sieht.
- Flächen kommen mit Phase 3 an Gebäude und Räume; bis dahin bleibt eine solche Spalte draußen.

## Anlagen

Eine Zeile ist eine Anlage. Sie steht in einem Gebäude, das es gibt, und auf Wunsch in einem
seiner Räume. Der Import der Anlagen legt keinen Ort an. Nennt die Liste Liegenschaft und Gebäude
nicht, weil sie für ein Haus gilt, werden beide im ersten Schritt für alle Zeilen gewählt, das
Gebäude unter denen der gewählten Liegenschaft. Eine Zeile, die eines davon nennt, geht vor; nennt
sie eine andere Liegenschaft und kein Gebäude, ist das eine offene Zeile.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Liegenschaft | ja | Objekt, Standort, Liegenschaftsname | Name der Liegenschaft, wie sie hier heißt; leer gilt die gewählte |
| Gebäude | ja | Gebäudename, Haus, Bauteil | Bezeichnung des Gebäudes, wie es hier heißt; leer gilt das gewählte |
| Geschoss | | Etage, Stockwerk | hilft, den Raum zu finden, wenn es seine Nummer im Gebäude mehrfach gibt; eine Anlage steht im Gebäude oder in einem Raum, ohne Raum bleibt das Geschoss unbeachtet |
| Raum | | Raumnummer, Raum-Nr., Raumnr, Raumbezeichnung, Raumname | Nummer des Raums, sonst seine Bezeichnung |
| Anlagenart | ja | Art, Anlagentyp, Anlagenkategorie, Kategorie, Art der Anlage | die Bezeichnung der Liste, etwa "Feuerlöscher" |
| Bezeichnung | ja | Name, Anlage, Anlagenbezeichnung, Benennung | höchstens 120 Zeichen |
| Kennzeichen | | Inventar-Nr., Inventarnummer, Anlagenkennzeichen, Kennzeichnung, AKS | höchstens 60 Zeichen |
| Hersteller | | Fabrikat | höchstens 120 Zeichen |
| Typ | | Modell, Typbezeichnung | höchstens 120 Zeichen |
| Seriennummer | | Serien-Nr., Seriennr, Fabriknummer, Fabrik-Nr., SN | höchstens 80 Zeichen |
| Baujahr | | Herstelljahr, Bj. | Jahr, vierstellig |
| Inbetriebnahme | | Inbetriebnahmedatum, In Betrieb seit, Datum der Inbetriebnahme | Tag, 02.10.2026 oder 2026-10-02 |
| Gewährleistung bis | | Gewährleistungsende, Ende der Gewährleistung, Garantie bis | Tag, 02.10.2026 oder 2026-10-02 |
| Zählernummer | | Zähler-Nr., Zählernr | nur für eine Messstelle, dort Pflicht |
| Einheit des Zählers | | Einheit | kWh, MWh oder m³, nur für eine Messstelle |
| Kostengruppe | | KG, Kostengruppe DIN 276, DIN 276 | dreistellig nach DIN 276, etwa 461; dient nur dem Vorschlag der Anlagenart |

Was dabei gilt:

- **Anlagenarten zuordnen.** Die Spalte "Anlagenart" hält die Bezeichnung, die die Liste benutzt.
  Im zweiten Schritt bekommt jede dieser Bezeichnungen einmal eine Anlagenart des Katalogs; die
  Zuordnung bleibt beim Betreiber und gilt für jeden weiteren Import. Vorgeschlagen wird die
  Anlagenart, die genauso heißt, und sonst die allgemeine Anlagenart der Kostengruppe, wenn die
  Zeilen eine nennen. Was kein Fachpaket beschreibt, bekommt die allgemeine Anlagenart seiner
  Kostengruppe; sie trägt keine Pflichten, bis das Fachpaket erscheint.
- **Dubletten.** Trägt eine Zeile die Seriennummer oder das Kennzeichen einer Anlage, die es gibt,
  oder einer früheren Zeile, nennt die Vorschau sie unter "Gibt es vielleicht schon". Wer
  importiert, entscheidet für jede: nicht anlegen oder trotzdem anlegen. Ohne diese Entscheidung
  wird nichts übernommen. Verglichen wird ohne Rücksicht auf Leerzeichen und Großschreibung.
  Eine Anlage, die trotzdem angelegt wird, hält fest, von welchen vorhandenen Anlagen sie dabei
  für verschieden befunden wurde; ihre Akte nennt sie unter "Keine Dublette von".
  Gefragt wird auch über die Grenze der eigenen Bereiche: liegt die mögliche Dublette in einem
  Bereich, den Sie nicht sehen, steht bei der Zeile "Eine Anlage außerhalb Ihrer Bereiche" mit dem
  Feld, das sie teilt. Die Anlage selbst wird nicht gezeigt; ob es dieselbe ist, kann die Leitung
  prüfen. Entschieden wird über eine solche Zeile wie über jede andere, und eine trotzdem
  angelegte Anlage nennt die nicht gezeigte nicht unter "Keine Dublette von".
- **Was nur eine Anlagenart hat**, etwa das Löschmittel eines Feuerlöschers oder eine
  Nennleistung, steht nicht unter diesen Feldern. Seine Spalte bleibt im ersten Schritt auf
  "Nicht übernehmen" und wird im dritten Schritt zugeordnet, siehe "Felder der Anlagenart".
- **Die Nummer der Anlage** (AN-00031) vergibt die Anwendung aus dem Nummernkreis des Betreibers,
  in der Reihenfolge der Zeilen.
- Nach dem Import schlägt der Katalog für jede Anlage die Pflichten ihrer Anlagenart vor. Der
  Import bestätigt keine.

## Felder der Anlagenart

Eine Anlagenart bringt Felder mit, die nur sie hat: das Löschmittel eines Feuerlöschers, die
Nennleistung eines Wärmeerzeugers. Welche Anlagenart eine Zeile meint, steht erst nach dem
Schritt "Anlagenarten" fest. Deshalb folgt darauf der Schritt **"Felder"**: die Spalten, die im
ersten Schritt kein Feld bekommen haben, werden den Feldern der gewählten Anlagenarten
zugeordnet, je Anlagenart einmal.

- Der Import schlägt die Spalte vor, die heißt wie das Feld, bei einer Zahl auch mit der Einheit
  dahinter: "Füllmenge", "Füllmenge kg" und "Füllmenge in kg".
- Eine Spalte kann mehreren Anlagenarten dienen, wenn jede von ihnen ein solches Feld hat. Je
  Anlagenart ist eine Spalte ein Feld.
- Ein Feld ohne Spalte und eine leere Zelle bleiben leer; das Feld wird danach an der Anlage
  eingetragen.
- Hat keine der gewählten Anlagenarten ein eigenes Feld, oder ist keine Spalte übrig, entfällt
  der Schritt.

Was in der Zelle steht, hängt von der Art des Felds ab. Der Schritt nennt sie bei jedem Feld.

| Art des Felds | So steht es in der Zelle | Beispiele | Wird nicht gelesen |
|---|---|---|---|
| Auswahl | die Bezeichnung einer der Möglichkeiten, wie die Anlagenart sie nennt; Großschreibung und Leerzeichen zählen nicht, Satzzeichen zählen | ABC-Pulver; abc-pulver | Pulver |
| Zahl | Ziffern, mit Komma und ohne Tausenderpunkt; dahinter darf die Einheit des Felds stehen | 1200; 7,5; 6 kg | 7.5; 1.200; 6000 g |
| Ja oder Nein | ja oder nein | ja; Nein | x; vorhanden |
| Tag | wie bei der Inbetriebnahme | 02.10.2026; 2026-10-02 | 2.10.26; Oktober 2026 |
| Text | höchstens 500 Zeichen | Im Keller links | |

Was dabei gilt:

- **Ein Wert wird gegen sein Feld geprüft wie im Formular.** Passt er nicht, ist die Zeile offen
  und steht in der Vorschau unter "Was vor der Übernahme zu klären ist".
- **Eine Zahl wird nicht umgerechnet und nicht gedeutet.** "1.200" kann tausendzweihundert oder
  eins Komma zwei heißen, "6000 g" ist keine Zahl in kg: beides ist eine offene Zeile. Eine Zahl
  mit mehr Nachkommastellen, als ihre Einheit hat, ebenso.
- **Eine Spalte gilt oft nur für einen Teil der Zeilen.** Steht in einer Zeile ein Wert, für deren
  Anlagenart die Spalte keinem Feld zugeordnet ist, wird er nicht übernommen. Die Vorschau nennt
  ihn unter "Was nicht übernommen wird" mit Zeile und Spalte; die Zeile wird trotzdem angelegt,
  und der Import läuft.

## Laufende Fristen und alte Nachweise

Wer von Listen oder aus einer Vorgängeranwendung kommt, hat für jede Anlage Prüfungen und
Wartungen, die laufen: zuletzt durchgeführt an einem Tag, fällig wieder an einem anderen. Dieser
Import übernimmt beides, damit keine Frist beim Wechsel neu zu laufen beginnt (Abschnitt 11 des
Planungskonzepts). Er steht unter "Importieren" im Pflichtenverzeichnis und kommt nach dem Import
der Anlagen: eine Zeile nennt eine Anlage, die es hier gibt.

Eine Zeile ist ein Nachweis: an einer Anlage wurde eine Pflicht an einem Tag erfüllt. Neben der
Tabelle werden die Dateien der alten Nachweise gewählt, meist PDF; eine Zeile nennt ihre Datei
beim Namen.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Anlagennummer | | Anlagen-Nr., Anlagennr, Nummer der Anlage | die Nummer der Anlage in dieser Anwendung, etwa AN-00031 |
| Kennzeichen | | Inventar-Nr., Inventarnummer, Anlagenkennzeichen, Kennzeichnung, AKS | das Kennzeichen der Anlage, wie es beim Import der Anlagen kam |
| Seriennummer | | Serien-Nr., Seriennr, Fabriknummer, Fabrik-Nr., SN | die Seriennummer der Anlage |
| Pflicht | | Pflichtart, Prüfung, Prüfart, Art der Prüfung, Prüfpflicht | die Bezeichnung einer Pflicht aus dem Katalog oder einer eigenen; leer für ein Dokument |
| Letzter Nachweis | | Letzte Prüfung, Letzte Durchführung, Geprüft am, Durchgeführt am | Tag, 02.10.2026 oder 2026-10-02; nicht in der Zukunft |
| Nächste Fälligkeit | | Nächste Prüfung, Fällig am, Fälligkeit, Nächster Termin | Tag nach dem letzten Nachweis; leer heißt, die Anwendung rechnet |
| Ergebnis | | Prüfergebnis, Befund | Ohne Mangel oder Mit Mängeln; leer heißt ohne Mangel |
| Vermerk | | Bemerkung, Anmerkung, Hinweis | höchstens 500 Zeichen, etwa "ohne prüfbare Unterschrift" |
| Datei | | Dateiname, PDF, Prüfbericht, Bericht | der Name einer der gewählten Dateien |
| Bezeichnung des Dokuments | | Dokumentname, Titel | höchstens 120 Zeichen; sonst der Name der Datei |
| Grundlage | | Grundlage der Pflicht | nur für eine eigene Pflicht: Hersteller, Auflage, Versicherer oder Eigene Festlegung |
| Quelle | | Fundstelle, Rechtsgrundlage | nur für eine eigene Pflicht, dort nötig: worauf sie sich stützt, höchstens 300 Zeichen |
| Tätigkeit | | Art der Tätigkeit | nur für eine eigene Pflicht, dort nötig: Prüfung, Wartung, Inspektion, Funktionskontrolle, Sichtkontrolle oder Probenahme |
| Frist | | Intervall, Turnus, Prüffrist, Prüfintervall | eine Zahl mit Monaten, Jahren, Wochen oder Tagen, etwa "24 Monate"; eine bloße Zahl sind Monate |
| Zählweise | | Zählung | nur für eine eigene Pflicht: Ab dem Tag der Durchführung, Ab dem fälligen Tag oder Nach § 14 Abs. 5 BetrSichV; leer heißt ab dem Tag der Durchführung |
| Begründung der Frist | | Begründung | höchstens 500 Zeichen; nötig, wo eine Frist vom Richtwert abweicht oder der Betreiber sie festlegt |

Was dabei gilt:

- **Die Anlage** nennt eine Zeile mit ihrer Anlagennummer, ihrem Kennzeichen oder ihrer
  Seriennummer. Was davon dasteht, muss dieselbe Anlage meinen. Tragen mehrere Anlagen dasselbe
  Kennzeichen, braucht die Zeile die Anlagennummer. Eine Anlage außerhalb der eigenen Bereiche
  findet der Import nicht.
- **Eine Pflicht aus dem Katalog** steht mit ihrer Bezeichnung in der Zeile, wie der Katalog sie
  für die Anlagenart nennt, oder mit ihrem Schlüssel. Kennt der Katalog sie für diese Anlage
  nicht, nennt die Vorschau die Pflichten, die er kennt. Ihre Frist ist die ihrer Pflichtart;
  eine Spalte "Frist" kann sie verkürzen. Länger als die Höchstfrist wird sie nicht.
- **Eine eigene Pflicht** ist eine Zeile, die eine Grundlage nennt. Sie braucht dazu Quelle,
  Tätigkeit und Frist. Was kein Fachpaket des Katalogs beschreibt, kommt so.
- **Steht die Pflicht an der Anlage noch nicht, bestätigt der Import sie.** Steht sie schon,
  bleibt sie, wie sie ist, und bekommt den Nachweis dazu. Wer für eine Pflicht verantwortlich
  ist und wer sie ausführt, wird danach im Pflichtenverzeichnis eingetragen.
- **Die jüngste Zeile einer Pflicht wird ihr Nachweis**, mit der Herkunft "Altbestand". Er zählt
  für die Frist wie jeder Nachweis. Er nennt niemanden, der ihn unterschrieben hat, und trägt
  überall den Vermerk, dass er nicht in dieser Anwendung unterschrieben wurde, auch im PDF. Was
  eine Vorgängeranwendung nicht belegen kann, steht in der Spalte "Vermerk" und damit am
  Nachweis.
- **Die nächste Fälligkeit gilt, wie die Liste sie nennt.** Nach § 14 Abs. 5 BetrSichV ist ein
  Termin ein Monat; dort gilt der Monat des genannten Tags. Liegt der Tag hinter der Höchstfrist
  der Pflicht, gerechnet vom letzten Nachweis, ist die Zeile offen: eine Höchstfrist verlängert
  kein Import. Ohne diese Spalte rechnet die Anwendung vom letzten Nachweis mit der Frist der
  Pflicht. Was nach der Übernahme durchgeführt wird, zählt von dort weiter.
- **Ältere Zeilen derselben Pflicht** werden Dokumente an der Anlage, mit ihrer Datei und dem
  Kennzeichen "Altbestand". Eine ältere Zeile ohne Datei wird nicht übernommen; die Vorschau
  nennt sie. Dasselbe gilt für eine Zeile, deren Pflicht hier schon einen jüngeren Nachweis hat.
- **Eine Zeile ohne Pflicht** ist ein Dokument an ihrer Anlage und nennt ihre Datei.
- **Die Dateien** werden im ersten Schritt neben der Tabelle gewählt, höchstens 2.000 je Liste.
  Zwei Dateien desselben Namens gehen nicht, weil eine Zeile ihre Datei beim Namen nennt. Eine
  Datei kann zu mehreren Zeilen gehören, etwa ein Prüfbericht über alle Feuerlöscher eines
  Gebäudes. Hochgeladen werden nur die Dateien, die eine Zeile nennt. Eine Datei wird nicht
  umgeschrieben und nicht verkleinert.
- **Was es schon gibt, wird nicht doppelt übernommen:** ein Nachweis derselben Pflicht vom
  selben Tag und ein übernommenes Dokument mit demselben Dateinamen an derselben Anlage. Dieselbe
  Liste lässt sich also ein zweites Mal importieren.
- **Offene Aufträge und Mängel** übernimmt der Import nicht. Offene Aufträge werden in der
  Vorgängeranwendung zu Ende geführt; was am Stichtag offen ist, wird hier neu angelegt.
- Eine Pflicht an einem Raum, einem Gebäude oder der Liegenschaft wird im Büro angelegt; ihren
  letzten Nachweis trägt dort der Bericht einer Fremdfirma oder Prüforganisation ein.

## Zählerstände, Zählertausche und Stilllegungen

Die Messstellen selbst sind Anlagen und kommen mit dem Import der Anlagen, mit Zählernummer und
Einheit. Dieser Import übernimmt, was an ihnen hängt (Abschnitt 11 des Planungskonzepts:
"Messstellen und Stände mit Tauschen und Stilllegungen"). Er steht unter "Importieren" in der
Liste "Zähler".

Eine Zeile ist ein Eintrag an einer Messstelle: ein Stand mit dem Tag der Ablesung, der Tausch
des Zählers oder eine Zeit, in der die Messstelle ruhte.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Zählernummer | | Zähler-Nr., Zählernr, Zähler, Nummer des Zählers | die Nummer, die der Zähler der Messstelle heute trägt |
| Anlagennummer | | Anlagen-Nr., Anlagennr, Nummer der Anlage | die Nummer der Messstelle in dieser Anwendung, etwa AN-00101 |
| Kennzeichen | | Inventar-Nr., Inventarnummer, Anlagenkennzeichen, Kennzeichnung, AKS | das Kennzeichen der Messstelle, wie es beim Import der Anlagen kam |
| Seriennummer | | Serien-Nr., Seriennr, Fabriknummer, Fabrik-Nr., SN | die Seriennummer der Messstelle |
| Eintrag | | Art, Art des Eintrags, Vorgang | Stand, Tausch oder Stilllegung; leer heißt Stand |
| Tag | | Datum, Abgelesen am, Ablesedatum, Ablesetag, Tag der Ablesung | Tag der Ablesung, des Tauschs oder erster Tag der Stilllegung, 02.10.2026 oder 2026-10-02 |
| Stand | | Zählerstand, Ablesewert, Wert | nur für einen Stand: die Zahl in der Einheit des Zählers, etwa 4812,5 |
| Alte Zählernummer | | Alter Zähler, Zählernummer alt, Ausgebauter Zähler | nur für einen Tausch: die Nummer des ausgebauten Zählers |
| Endstand alt | | Endstand, Endstand des alten Zählers | nur für einen Tausch: der letzte Stand des ausgebauten Zählers |
| Neue Zählernummer | | Neuer Zähler, Zählernummer neu, Eingebauter Zähler | nur für einen Tausch: die Nummer des eingebauten Zählers |
| Anfangsstand neu | | Anfangsstand, Anfangsstand des neuen Zählers | nur für einen Tausch: der erste Stand des eingebauten Zählers |
| Bis | | Letzter Tag, Stillgelegt bis, Ende | nur für eine Stilllegung: ihr letzter Tag; leer heißt, sie dauert an |
| Grund | | Begründung, Grund der Stilllegung | nur für eine Stilllegung, dort nötig, höchstens 500 Zeichen |

Was dabei gilt:

- **Die Messstelle** nennt eine Zeile mit der Zählernummer, die sie heute trägt, ihrer
  Anlagennummer, ihrem Kennzeichen oder ihrer Seriennummer. Was davon dasteht, muss dieselbe
  Anlage meinen, und die Anlage muss eine Messstelle sein. Eine Messstelle außerhalb der eigenen
  Bereiche findet der Import nicht.
- **Was eine Zeile ist**, sagt die Spalte "Eintrag". Ohne sie ist eine Zeile mit einer neuen
  Zählernummer ein Tausch, eine mit einem Grund eine Stilllegung und jede andere ein Stand: eine
  reine Liste von Ständen braucht die Spalte nicht. Was in einer Zeile für eine andere Art von
  Eintrag steht, wird nicht übernommen; die Vorschau nennt es.
- **Eine Zahl** steht in der Einheit des Zählers, mit Komma und ohne Tausenderpunkt, mit
  höchstens drei Stellen hinter dem Komma: 4812 oder 4812,5. Die Einheit darf dahinter stehen,
  wenn es die des Zählers ist.
- **Ein Stand gilt für den Stichtag seines Tags**, wie eine Ablesung im Büro: für den Stichtag
  am oder vor dem Tag der Ablesung, wenn er höchstens 14 Tage zurückliegt, sonst für den
  nächsten. Den Stichtag stellt der Betreiber unter "Einstellungen" ein, eine Messstelle kann
  einen eigenen haben; beides steht vor dem Import. Ein Stichtag hat einen Stand: nennt die
  Liste für einen Stichtag zwei, ist das zu klären.
- **Ein Stand wird geprüft wie jeder andere.** Kleiner als der Stand davor oder größer als der
  danach ist zu klären, es sei denn, ein Tausch liegt dazwischen. Ein Stand weit über dem davor
  wird übernommen: die Vorschau nennt ihn, und wer die Liste übernimmt, bestätigt ihn damit.
- **Ein übernommener Stand sagt das.** Seine Quelle heißt "Übernommen", daneben steht, wer die
  Liste übernommen hat: abgelesen hat ihn hier niemand. Berichtigt wird er wie jeder Stand,
  durch einen neuen Eintrag mit Grund.
- **Ein Tausch** nennt beide Zählernummern und beide Stände. Die Tausche einer Messstelle
  schließen aneinander an: ausgebaut wird der Zähler, den der Tausch davor eingebaut hat, und
  der jüngste Tausch baut den Zähler ein, den die Anlage heute trägt. Die Zählernummer der
  Anlage ändert der Import nicht. Der Endstand liegt nicht unter dem letzten Stand des alten
  Zählers.
- **Eine Stilllegung** hat einen ersten Tag, einen Grund und auf Wunsch einen letzten Tag. Zwei
  Stilllegungen einer Messstelle überschneiden sich nicht.
- **Was es schon gibt, wird nicht doppelt übernommen:** ein Stand mit derselben Zahl für
  denselben Stichtag, ein Tausch am selben Tag mit denselben Angaben und eine Stilllegung mit
  denselben Tagen. Dieselbe Liste lässt sich also ein zweites Mal importieren. Steht für einen
  Stichtag schon ein anderer Stand, ist die Zeile zu klären: berichtigt wird an der Messstelle.
- Wandlerfaktor, Hauptzähler, Kennung in der Leittechnik, Notiz und Sperre einer Messstelle
  stehen in keiner Liste; sie werden an der Messstelle eingetragen. Eine Sperre hält den Import
  nicht auf: übernommen wird, was früher abgelesen wurde.

## Vorlagen der Rundgänge

Die eigenen Vorlagen eines Betreibers kommen als Formulare in seine Instanz (Abschnitt 11 des
Planungskonzepts). Sie gehören ihm und bleiben dort. Der Import steht unter "Importieren" in der
Liste der Vorlagen und braucht keinen der anderen.

Eine Zeile ist ein Punkt: sie nennt ihre Vorlage, ihr Kapitel und was geprüft, gemessen oder
gefragt wird.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Vorlage | ja | Rundgang, Checkliste, Formular, Name der Vorlage | die Bezeichnung der Vorlage, höchstens 120 Zeichen |
| Kapitel | | Abschnitt, Gruppe, Bereich | höchstens 120 Zeichen; leer heißt das Kapitel der Zeile darüber, sonst "Kapitel 1" |
| Punkt | ja | Prüfpunkt, Kontrollpunkt, Frage, Aufgabe | was geprüft, gemessen oder gefragt wird, höchstens 200 Zeichen |
| Art | | Art des Punkts, Feldart, Typ | Prüfpunkt, Messwert, Zählerstand, Foto, Bemerkung, Text, Zahl, Auswahl oder Ja oder nein; leer heißt Prüfpunkt |
| Hinweis | | Erläuterung, Beschreibung, Hilfetext | höchstens 300 Zeichen |
| Pflichtfeld | | Pflicht, Erforderlich | ja oder nein; leer heißt ja bei Messwert und Zählerstand, sonst nein |
| Einheit | | | für Messwert, Zählerstand und Zahl: °C, je 100 ml, kWh, MWh, m³, Ω, MΩ, mA oder kg |
| Nachkommastellen | | Stellen, Kommastellen | 0 bis 3; leer heißt 1 beim Messwert, 0 bei der Zahl, beim Zählerstand nach seiner Einheit |
| Möglichkeiten | | Auswahl, Optionen, Antworten | für eine Auswahl: mindestens zwei, durch Semikolon getrennt |
| Mindestens | | Mindestwert, Untergrenze, Min | für einen Messwert: der Wert, den er erreichen muss |
| Höchstens | | Höchstwert, Obergrenze, Max | für einen Messwert: der Wert, den er nicht überschreiten darf |
| Quelle des Grenzwerts | | Quelle | zu einem Grenzwert nötig: worauf er sich stützt, höchstens 200 Zeichen |
| Gegenzeichnung | | Gegenzeichnen | ja oder nein, für die ganze Vorlage |

Was dabei gilt:

- **Die Zeilen einer Vorlage werden eine Vorlage** mit ihrer ersten Fassung, Kapitel und Punkte
  in der Reihenfolge der Liste. Eine Vorlage hat höchstens 30 Kapitel und 200 Punkte.
- **Die Arten** heißen wie im Editor der Vorlagen. Was eine Zeile nennt und ihre Art nicht
  braucht, etwa eine Einheit an einem Prüfpunkt, wird nicht übernommen; die Vorschau nennt es.
- **Ein Grenzwert** kommt als eigener Wert des Betreibers mit seiner Quelle: eine Zahl in der
  Einheit des Punkts, mit Komma und ohne Tausenderpunkt, als Mindestens oder als Höchstens. Ein
  Grenzwert aus einer Regel eines Pakets wird nach der Übernahme im Editor gewählt und folgt
  dann den Fassungen der Regel.
- **Worauf ein Punkt zeigt**, eine Anlage oder ein Raum, und welche Pflicht er erfüllt, sagt
  keine Liste. Beides wird nach der Übernahme im Editor eingetragen, als nächste Fassung der
  Vorlage.
- **Die Gegenzeichnung** gilt für die ganze Vorlage: nennt eine ihrer Zeilen "ja", verlangt die
  Vorlage sie. "ja" in einer Zeile und "nein" in einer anderen ist zu klären.
- **Eine Vorlage, die es unter ihrer Bezeichnung schon gibt, bleibt, wie sie ist.** Ihre Zeilen
  werden nicht übernommen. Geändert wird eine Vorlage im Editor, als neue Fassung.
- Pläne übernimmt der Import nicht: wo, wie oft und von wem ein Rundgang gegangen wird, wird im
  Büro angelegt.

## Vorschau und Übernahme

Vor der Übernahme zeigt die Vorschau, was die Tabelle anlegen würde, welche Zeilen zu klären sind,
was es schon gibt und was nicht übernommen wird: bei Anlagen einzelne Werte, bei den Fristen
ältere Zeilen ohne Datei, bei Zählern und Vorlagen, was eine Zeile nennt und nicht braucht. Dabei
wird nichts geschrieben und die Datei nicht gespeichert.

**Übernommen wird ganz oder gar nicht.** Solange eine Zeile zu klären ist, bleibt der Knopf aus:
die Datei wird berichtigt und im ersten Schritt neu gewählt. Scheitert die Übernahme, ist nichts
angelegt.

Ein Import steht als **ein Eintrag im Änderungsprotokoll**, mit dem Namen der Datei, der Zahl
ihrer Zeilen und dem, was angelegt wurde, und nicht als ein Eintrag je Raum oder Anlage. Beim
Import der Fristen kommt zu diesem Eintrag je einer für jede bestätigte Pflicht, jeden Nachweis
und jedes Dokument: ein Nachweis hat Beweiswert, und sein Eintrag bleibt. Ebenso beim Import der
Zähler und der Vorlagen: jeder Stand, jeder Tausch, jede Stilllegung und jede Vorlage hat dort
ihren eigenen Eintrag.

Den Bestand importiert, wer Liegenschaften, Gebäude und Geschosse pflegt (Leitung und Technische
Leitung). Anlagen importiert und Anlagenarten ordnet zu, wer Anlagen pflegt (ab der
Objektleitung). Laufende Fristen und alte Nachweise importiert, wer das Pflichtenverzeichnis
führt und Nachweise einträgt (Leitung und Technische Leitung). Zählerstände, Tausche und
Stilllegungen importiert, wer Anlagen pflegt und Zähler abliest, Vorlagen der Rundgänge, wer sie
führt (beides ab der Objektleitung).
