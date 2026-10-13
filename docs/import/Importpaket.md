# Das Importpaket: von einer Vorgängeranwendung nach OpenGewerk Haustechnik

Wer von einer Vorgängeranwendung oder von Listen kommt, bringt mit, was er hat: Liegenschaften
und Räume, Anlagen, laufende Fristen mit ihren alten Nachweisen, den Verlauf seiner Zähler und
die Vorlagen seiner Rundgänge. Der Weg dafür ist Teil des Produkts (Abschnitt 11 des
Planungskonzepts) und für jeden Betreiber derselbe.

Ein **Importpaket** ist ein Ordner aus Tabellen und Dateien, in den eine Vorgängeranwendung
exportiert. Die Anwendung liest ihn nicht als Ganzes: jede Tabelle wird unter der Liste
importiert, die sie füllt, in der Reihenfolge dieser Seite, jede mit Vorschau und jede ganz oder
gar nicht. So bleibt jeder Schritt klein genug, um ihn anzusehen, und ein Fehler in den Zählern
hält die Anlagen nicht auf.

Welche Spalten eine Tabelle hat und was in ihnen steht, beschreibt [Tabellen.md](Tabellen.md).
Diese Seite beschreibt, wie die Tabellen zusammengehören. Das Skript, das aus einer bestimmten
Vorgängeranwendung exportiert, gehört nicht in dieses Repository; es schreibt diesen Ordner.

## Der Ordner

```
importpaket/
  01-bestand.csv     Liegenschaften, Gebäude, Geschosse, Räume
  02-anlagen.csv     Anlagen, darunter die Messstellen
  03-fristen.csv     laufende Fristen und alte Nachweise
  04-zaehler.csv     Stände, Tausche und Stilllegungen der Messstellen
  05-vorlagen.csv    Vorlagen der Rundgänge
  nachweise/         die Dateien, die 03-fristen.csv beim Namen nennt
```

- Die Namen sind eine Vereinbarung und sagen die Reihenfolge. Die Anwendung liest sie nicht:
  welche Datei wohin gehört, wählt, wer importiert.
- Jede Tabelle ist eine CSV-Datei oder eine Excel-Arbeitsmappe, wie Tabellen.md sie unter "Die
  Datei" beschreibt: höchstens 10.000 Zeilen, die erste Zeile mit den Namen der Spalten. Eine
  längere Liste wird geteilt (`04-zaehler-1.csv`, `04-zaehler-2.csv`) und Teil für Teil
  importiert.
- Heißen die Spalten wie die Felder in Tabellen.md, ordnet der Import sie von selbst zu.
- Der Ordner `nachweise` ist flach: keine zwei Dateien desselben Namens, höchstens 2.000 je
  Liste der Fristen. Eine Datei wird nicht umgeschrieben und nicht verkleinert.
- Eine Tabelle, die es nicht braucht, fehlt einfach. Wer keine Zähler hat, hat keine
  `04-zaehler.csv`.

## Die Reihenfolge

| Schritt | Datei | Wo im Büro | Was vorher stehen muss |
|---|---|---|---|
| 1 | `01-bestand.csv` | Liegenschaften, "Importieren" | die Bereiche des Betreibers |
| 2 | `02-anlagen.csv` | Anlagen, "Importieren" | Schritt 1: eine Anlage steht in einem Gebäude, das es gibt |
| 3 | `03-fristen.csv` mit `nachweise/` | Pflichtenverzeichnis, "Importieren" | Schritt 2: eine Zeile nennt eine Anlage, die es gibt |
| 4 | `04-zaehler.csv` | Zähler, "Importieren" | Schritt 2, und der Stichtag der Zähler unter "Einstellungen" |
| 5 | `05-vorlagen.csv` | Rundgänge, Vorlagen, "Importieren" | nichts; geht jederzeit |

Danach, im Büro und nicht aus einer Tabelle:

- an jeder Pflicht eintragen, wer verantwortlich ist und wer sie ausführt,
- in jeder Vorlage sagen, auf welche Anlage oder welchen Raum ein Punkt zeigt und welche Pflicht
  er erfüllt, als nächste Fassung der Vorlage,
- die Pläne der Rundgänge anlegen: Vorlage, Ort, Rhythmus und Zuständige,
- die Personen einladen (siehe unten).

## Was die Tabellen verbindet

- **Orte am Namen.** Die Anlagen nennen ihre Liegenschaft und ihr Gebäude, wie `01-bestand.csv`
  sie nennt, und ihren Raum mit seiner Nummer.
- **Anlagen am Kennzeichen.** Fristen und Zähler nennen ihre Anlage mit dem Kennzeichen, das
  `02-anlagen.csv` ihr gibt. Dafür trägt jede Anlage ein Kennzeichen, das es nur einmal gibt;
  der Schlüssel der Vorgängeranwendung eignet sich. Die Anlagennummer (AN-00031) vergibt diese
  Anwendung erst beim Import, ein Paket kennt sie nicht. Seriennummer und Zählernummer gehen
  auch, wo sie eindeutig sind.
- **Anlagenarten an den Wörtern der Liste.** `02-anlagen.csv` nennt die Anlagenart, wie die
  Vorgängeranwendung sie nennt. Welche Anlagenart des Katalogs gemeint ist, wird beim Import
  einmal zugeordnet und gilt für jeden weiteren.
- **Messstellen sind Anlagen.** Ein Zähler steht in `02-anlagen.csv` mit Zählernummer und
  Einheit, und zwar mit der Nummer, die er heute trägt. Was früher an der Messstelle hing, sagt
  der Tausch in `04-zaehler.csv`.
- **Dateien am Namen.** Eine Zeile in `03-fristen.csv` nennt ihre Datei aus `nachweise/` beim
  Namen.

## Was nicht im Paket steht

- **Zugänge.** Ein Paket hält kein Konto und kein Passwort. Jede Person wird im Büro unter
  "Zugänge" eingeladen, mit ihren Rollen und Bereichen, und setzt ihr Passwort selbst: niemand
  bekommt ein übernommenes (Abschnitt 11).
- **Offene Aufträge und offene Mängel.** Sie werden im Parallelbetrieb in der
  Vorgängeranwendung zu Ende geführt; was am Stichtag noch offen ist, wird hier neu angelegt.
- **Unterschriften.** Ein alter Nachweis wird nicht neu unterschrieben und nicht umgeschrieben.
  Er kommt als Altbestand mit seinem ursprünglichen Dokument und sagt das überall. Was die
  Vorgängeranwendung nicht belegen kann, steht in der Spalte "Vermerk".
- **Laufende Rundgänge und ihre Protokolle.** Übernommen wird die Vorlage, nicht der Rundgang
  von letzter Woche. Ein Protokoll, das als Nachweis einer Pflicht zählt, steht als Zeile in
  `03-fristen.csv`.
- **Was nur eine Messstelle trägt:** Wandlerfaktor, Hauptzähler, Kennung in der Leittechnik,
  Notiz und Sperre werden an der Messstelle eingetragen.

## Probelauf und Abgleich der Zahlen

Vor der Umstellung läuft das Paket einmal zur Probe, in einer eigenen Instanz oder bei einem
eigenen Betreiber, mit einer Kopie der Daten:

1. Die Tabellen in der Reihenfolge oben importieren. Jede Vorschau nennt, was die Tabelle
   anlegen würde und welche Zeilen zu klären sind; dabei wird nichts geschrieben. Eine Zeile,
   die zu klären ist, wird im Export berichtigt, nicht in der Anwendung.
2. Die Zahlen jeder Vorschau neben die der Vorgängeranwendung halten: Liegenschaften, Gebäude,
   Räume, Anlagen, Nachweise je Pflicht, Stände je Messstelle, Vorlagen und ihre Punkte.
3. Nach der Übernahme steht jeder Import im Änderungsprotokoll, mit dem Namen der Datei, der
   Zahl ihrer Zeilen und dem, was angelegt wurde.
4. Die Listen des Büros als Tabelle herunterladen (jede Liste hat "Als Tabelle") und neben die
   Listen der Vorgängeranwendung legen. Für die Fristen ist es das Pflichtenverzeichnis: keine
   Frist ist früher oder später fällig als in der übernommenen Liste.

Übernommen wird jede Tabelle ganz oder gar nicht; eine abgebrochene Übernahme hinterlässt
nichts. Dieselbe Tabelle lässt sich ein zweites Mal importieren, etwa nach einer Berichtigung im
Export: was es schon gibt, wird nicht doppelt angelegt.

## Das Beispielpaket

Unter [`beispielpaket/`](beispielpaket/) liegt ein Paket aus erfundenen Daten: eine Grundschule
mit Schulhaus und Sporthalle, fünf Anlagen, darunter zwei Wasserzähler, ihre Wartungen mit vier
Dateien, der Verlauf der beiden Zähler über ein halbes Jahr mit einem Tausch und einer
Stilllegung, und zwei Vorlagen für Rundgänge. Es lässt sich in eine leere Instanz importieren,
Schritt für Schritt wie oben.

| Datei | Was der Import daraus macht |
|---|---|
| `01-bestand.csv` | 1 Liegenschaft, 2 Gebäude, 3 Geschosse und 6 Räume angelegt |
| `02-anlagen.csv` | 5 Anlagen angelegt |
| `03-fristen.csv` | 3 Nachweise als Altbestand übernommen, 3 Pflichten bestätigt, 2 Dokumente als Altbestand abgelegt |
| `04-zaehler.csv` | 8 Zählerstände, 1 Zählertausch und 1 Stilllegung übernommen |
| `05-vorlagen.csv` | 2 Vorlagen mit 10 Punkten übernommen |

Was dabei zu sehen ist:

- Die Anlagenarten der Liste ("Heizkessel", "Aufzug", "Lüftungsgerät", "Wasserzähler") werden im
  zweiten Schritt des Imports der Anlagen einer Anlagenart des Katalogs zugeordnet; die beiden
  Wasserzähler brauchen eine Anlagenart, die eine Messstelle ist.
- Die Pflichten in `03-fristen.csv` sind eigene Pflichten des Betreibers, mit Grundlage, Quelle,
  Tätigkeit und Frist. Die Wartung des Aufzugs steht zweimal darin: die jüngere Zeile wird der
  Nachweis, die ältere ein Dokument an der Anlage. Die letzte Zeile nennt keine Pflicht und wird
  ebenfalls ein Dokument.
- Der Hauptwasserzähler wurde im Januar 2026 getauscht: die Stände davor zählen auf dem alten
  Zähler, die danach auf dem neuen, und der Verbrauch des Tauschmonats rechnet über beide.
- Die Vorlage "Technikrundgang Schulhaus" verlangt die Gegenzeichnung und misst die
  Vorlauftemperatur gegen einen eigenen Grenzwert mit Quelle.

Ein Test (`packages/server/src/api/import-package.test.ts`) importiert das Beispielpaket bei
jedem Lauf der CI in eine leere Datenbank und hält die Tabelle oben gegen das, was die Importe
antworten. Ändert sich das Format, werden Seite und Beispiel mit geändert.
