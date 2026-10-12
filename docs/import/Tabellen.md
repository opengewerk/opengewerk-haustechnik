# Import aus Tabellen: das Format

OpenGewerk Haustechnik übernimmt Liegenschaften, Gebäude, Geschosse, Räume und Anlagen aus
Tabellen, wie sie in einer Tabellenkalkulation geführt werden (Abschnitte 3 und 11 des
Planungskonzepts). Diese Seite beschreibt, wie eine solche Tabelle aussieht und was der Import
aus ihr liest. Sie gilt für die Listen eines Betreibers genauso wie für den Weg aus einer
Vorgängeranwendung.

Zwei Importe gibt es, jeder unter der Liste, die er füllt: "Importieren" unter Liegenschaften
für den Bestand vom Standort bis zum Raum, "Importieren" unter Anlagen für die Anlagen in
Gebäuden und Räumen, die es schon gibt. Wer beides aus Listen übernimmt, importiert zuerst den
Bestand.

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
| Liegenschaft | ja | Objekt, Standort, Liegenschaftsname, Name der Liegenschaft | Name der Liegenschaft |
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
- Flächen kommen mit Phase 3 an Gebäude und Räume; bis dahin bleibt eine solche Spalte draußen.

## Anlagen

Eine Zeile ist eine Anlage. Sie steht in einem Gebäude, das es gibt, und auf Wunsch in einem
seiner Räume. Der Import der Anlagen legt keinen Ort an.

| Feld | Pflicht | Wird auch erkannt als | Was darin steht |
|---|---|---|---|
| Liegenschaft | ja | Objekt, Standort, Liegenschaftsname | Name der Liegenschaft, wie sie hier heißt |
| Gebäude | ja | Gebäudename, Haus, Bauteil | Bezeichnung des Gebäudes, wie es hier heißt |
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

## Vorschau und Übernahme

Vor der Übernahme zeigt die Vorschau, was die Tabelle anlegen würde, welche Zeilen zu klären sind,
was es schon gibt und, bei Anlagen, welche Werte nicht übernommen werden. Dabei wird nichts
geschrieben und die Datei nicht gespeichert.

**Übernommen wird ganz oder gar nicht.** Solange eine Zeile zu klären ist, bleibt der Knopf aus:
die Datei wird berichtigt und im ersten Schritt neu gewählt. Scheitert die Übernahme, ist nichts
angelegt.

Ein Import steht als **ein Eintrag im Änderungsprotokoll**, mit dem Namen der Datei, der Zahl
ihrer Zeilen und dem, was angelegt wurde, und nicht als ein Eintrag je Raum oder Anlage.

Den Bestand importiert, wer Liegenschaften, Gebäude und Geschosse pflegt (Leitung und Technische
Leitung). Anlagen importiert und Anlagenarten ordnet zu, wer Anlagen pflegt (ab der
Objektleitung).
