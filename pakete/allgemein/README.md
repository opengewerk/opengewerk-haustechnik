# Paket Allgemein

Der Auffang für jede Anlage, die kein Fachpaket beschreibt (Abschnitt 4.2 und 5 des
Planungskonzepts): je Kostengruppe der technischen Anlagen eine allgemeine Anlagenart, ohne
Merkmale, ohne Felder und ohne Pflichtarten. Damit lässt sich der Bestand eines Betreibers
vollständig erfassen, auch bevor das Paket für seine Anlagen erscheint. Kommt das Fachpaket, wird
die Anlagenart der Anlage berichtigt, und der Katalog schlägt ihre Pflichten vor. Eigene Pflichten
kann eine Anlage mit allgemeiner Art von Anfang an tragen.

Dazu bringt das Paket die drei allgemeinen Mängelklassen mit, für jeden Mangel, der nicht aus
einer Prüfung kommt (Abschnitt 4.6).

## Anlagenarten

Die Gliederung folgt der DIN 276, Ausgabe 2018-12, zweite Ebene der Kostengruppe 400 (Bauwerk,
technische Anlagen). Auf dieser Ebene sortieren das Anlagenverzeichnis und das Lagebild eines
Gebäudes, feiner muss eine allgemeine Anlagenart deshalb nicht sein; die dritte Ebene nennt erst
die Anlagenart eines Fachpakets.

Das Paket verweist auf Norm, Ausgabe und Nummer der Gruppe. Die Bezeichnungen sind eigene Worte
für eine einzelne Anlage und nicht die Überschriften der Norm, und das Paket gibt keine Tabelle
der Norm wieder (Abschnitt 5 des Planungskonzepts, § 5 Abs. 3 UrhG).

| Schlüssel | Kostengruppe |
| --- | --- |
| `water_wastewater_gas` | 410 |
| `heat_supply` | 420 |
| `ventilation_and_air_conditioning` | 430 |
| `electrical_installation` | 440 |
| `communication_and_security` | 450 |
| `conveying_system` | 460 |
| `use_specific_installation` | 470 |
| `building_automation` | 480 |
| `other_technical_installation` | 490 |

Jede Anlagenart gilt ab dem 01.12.2018, dem Monat der Ausgabe, auf deren Gliederung sie verweist.
Keine Pflichtart irgendeines Pakets darf eine dieser Anlagenarten in ihrem Geltungsbereich nennen;
der Bau lehnt das ab.

Für Anlagen außerhalb der Kostengruppe 400, etwa ein kraftbetätigtes Tor oder ein Regal, hat das
Paket keine Anlagenart.

## Mängelklassen

`gering`, `erheblich` und `gefährlich`, in dieser Reihenfolge. Sie sind eine eigene Einteilung des
Projekts und stammen aus keinem Regelwerk, deshalb nennen sie keine Fundstelle. Nur ein Mangel der
Klasse `gefährlich` macht eine Anlage unsicher.

## Geprüft und abgenommen

- Die Nummern der Gruppen und ihr Gegenstand sind am 05.10.2026 gegen eine frei zugängliche
  Übersicht der Gliederung gehalten worden (Wikipedia, Artikel "DIN 276", Stand desselben Tages).
  Gegen den Text der Norm sind sie nicht geprüft, er liegt nicht frei vor.
- Die drei Mängelklassen sind am 05.10.2026 gegen Abschnitt 4.6 des Planungskonzepts gehalten
  worden, in dem sie festgelegt sind.
- Abgenommen hat niemand etwas. Deshalb steht in `abnahmen.json` bei keinem Eintrag eine Abnahme,
  und die Oberfläche kennzeichnet jeden als nicht abgenommen.
