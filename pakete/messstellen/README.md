# Paket Messstellen

Je Medium aus Abschnitt 4.9 des Planungskonzepts eine Anlagenart, die eine Messstelle ist: Strom,
Wasser, Wärme, Fernwärme, Gas und Kälte. Mit ihnen lassen sich in jeder Instanz Zähler anlegen,
ablesen und aus einer Liste übernehmen, auch bevor die Fachpakete für Heizung, Raumluft und Kälte
erscheinen.

Ein eigenes Paket und nicht das Paket Allgemein: eine allgemeine Anlagenart steht für eine Anlage,
deren Fachpaket noch fehlt, und trägt keine Pflichtart. Eine Messstelle ist keine solche Anlage,
ihr Zähler wird abgelesen, und eine Pflichtart an ihr bleibt möglich.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe | Medium | Einheiten |
| --- | --- | --- | --- | --- |
| `electricity_meter` | Stromzähler | 444 | Strom | kWh, MWh |
| `water_meter` | Wasserzähler | 412 | Wasser | m³ |
| `heat_meter` | Wärmezähler | 422 | Wärme | kWh, MWh |
| `district_heating_meter` | Fernwärmezähler | 421 | Fernwärme | kWh, MWh |
| `gas_meter` | Gaszähler | 413 | Gas | m³ |
| `cooling_meter` | Kältezähler | 434 | Kälte | kWh, MWh |

Zählernummer und Einheit stehen an der einzelnen Anlage, das Medium an der Anlagenart. Ein
Gaszähler zählt in m³: Umgerechnet in kWh wird erst mit Brennwert und Zustandszahl, und die stehen
nicht am Zähler.

Die Kostengruppen nennen die dritte Ebene der DIN 276, Ausgabe 2018-12, dort, wo der Zähler
eingebaut ist: im Netz, das er misst. Jede Anlagenart gilt ab dem 01.12.2018, dem Monat dieser
Ausgabe. Die Anlagenarten haben keine Merkmale und keine Felder; Wandlerfaktor, Hauptzähler und
Kennung in der Leittechnik trägt jede Messstelle selbst.

## Geprüft und abgenommen

- Medien und Einheiten sind am 14.10.2026 gegen Abschnitt 4.9 des Planungskonzepts und die
  Einheiten der Anwendung gehalten worden.
- Die Zuordnung zu den Kostengruppen der dritten Ebene ist eine eigene. Gegen den Text der Norm ist
  sie nicht geprüft, er liegt nicht frei vor.
- Abgenommen hat niemand etwas. Deshalb steht in `abnahmen.json` bei keinem Eintrag eine Abnahme,
  und die Oberfläche kennzeichnet jeden als nicht abgenommen.

## Was das Paket nicht abdeckt

- Pflichtarten. Das Paket hat keine, auch keine Eichfrist.
- Heizkostenverteiler: sie zählen keine Menge in einer Einheit, die sich mit einem Stand davor
  verrechnen lässt.
