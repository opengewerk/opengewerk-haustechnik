# Paket Trinkwasser

Trinkwassererwärmung und Legionellen, Temperaturen, Probenahme, Sicherungseinrichtungen und Filter
(Abschnitt 5 des Planungskonzepts). Diese erste Fassung bringt die Einträge aus der
Trinkwasserverordnung vom 20. Juni 2023, die seit dem 24. Juni 2023 gilt. Was Temperaturen, Spülen,
Sicherungseinrichtungen und Filter angeht, verweist die Verordnung auf die allgemein anerkannten
Regeln der Technik, und die stehen in privaten Normen und Richtlinien; deren Verweise kommen als neue
Fassung, sobald die rechtliche Prüfung sie trägt und sie am Text der Norm geprüft sind.

Fachkundig abgenommen hat das Paket der Pilotbetrieb am 16.10.2026 (Abschnitt 15), jeder Eintrag
mit der Prüfsumme dessen, was abgenommen wurde. Wird ein Eintrag geändert, fällt seine Abnahme
weg, und die Oberfläche kennzeichnet ihn wieder, bis er erneut abgenommen ist.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe |
| --- | --- | --- |
| `drinking_water_installation` | Trinkwasserinstallation | 412 |
| `water_heater` | Trinkwassererwärmer | 412 |
| `backflow_preventer` | Sicherungseinrichtung gegen Rückfließen | 412 |
| `drinking_water_filter` | Trinkwasserfilter | 412 |

Die Kostengruppe ist eine eigene Zuordnung auf der dritten Ebene der DIN 276, Ausgabe 2018-12, wie im
Paket `messstellen`, und nicht am Text der Norm geprüft. Ein Trinkwassererwärmer, den die Heizung
mit Wärme versorgt, kann in einer Kostenplanung auch bei der Wärmeversorgung stehen.

Die Pflicht zur Untersuchung hängt an der Trinkwasserinstallation als Ganzes, nicht am einzelnen
Trinkwassererwärmer. Deshalb trägt die Installation die Merkmale, nach denen die Verordnung fragt:
eine Trinkwassererwärmung mit mehr als 400 Litern oder mit mehr als 3 Litern in einer Leitung,
Duschen oder andere Vernebelung, ob die Anlage in einem Ein- oder Zweifamilienhaus steht, und ob das
Wasser öffentlich, nur gewerblich oder weder noch abgegeben wird. Trinkwassererwärmer,
Sicherungseinrichtung und Filter tragen in dieser Fassung keine Pflichtart; sie sind da, damit der
Bestand vollständig erfasst werden kann.

## Pflichtarten

| Pflichtart | Bedingung | Fundstelle | Frist |
| --- | --- | --- | --- |
| Auf Legionellen untersuchen lassen (öffentliche Abgabe) | öffentlich, auch neben einer gewerblichen Abgabe | § 31 Abs. 1 und Abs. 2 Nr. 2 Buchst. b TrinkwV | 1 Jahr, Höchstfrist |
| Auf Legionellen untersuchen lassen (nur gewerbliche Abgabe) | nur gewerblich, etwa an Mieter | § 31 Abs. 1 und Abs. 2 Nr. 2 Buchst. a TrinkwV | 3 Jahre, Höchstfrist |
| Neue Anlage erstmals auf Legionellen untersuchen lassen | neu in Betrieb, gewerblich oder öffentlich | § 31 Abs. 4 TrinkwV | einmalig, 12 Monate nach der Inbetriebnahme, frühestens nach drei (#439) |

Alle drei gelten nur, wenn die drei übrigen Merkmale zutreffen: große Trinkwassererwärmung, Duschen oder
Vernebelung, nicht im Ein- oder Zweifamilienhaus. Probennahme und Untersuchung übernimmt eine dafür
zugelassene Untersuchungsstelle (§ 39 Abs. 1 und 3 TrinkwV). Der Nachweis ist ihr Bericht oder das
Formular mit dem Befund, aufbewahrt zehn Jahre (§ 44 Abs. 3 TrinkwV).

Das Gesundheitsamt kann den jährlichen Abstand auf bis zu drei Jahre verlängern (§ 31 Abs. 3 TrinkwV).
Dann trägt der Betreiber die längere Frist an seiner Pflicht ein, mit dem Bescheid als Begründung.

## Formulare und Vorlagen

- `legionella_findings`: der Befund der Untersuchungsstelle, je Probennahmestelle mit der Zahl der
  Legionellen in 100 ml. Gemessen wird gegen den technischen Maßnahmenwert, 100 je 100 ml (§ 51
  Abs. 1 TrinkwV mit Anlage 3 Teil II), und zwar mit `below`: die Verordnung verlangt Maßnahmen,
  sobald ein Befund den Wert **erreicht**. Ein Befund von 100 steht deshalb am Protokoll als außerhalb
  des Grenzwerts, mit der Fundstelle, und wird mit der Unterschrift ein Mangel an der Installation.
- Vorlage `hot_water_temperatures`: Temperaturen am Austritt des Trinkwassererwärmers, im Rücklauf der
  Zirkulation und am Kaltwasser, dazu eine Sichtkontrolle, für einen Rundgang, den ein Betreiber
  übernimmt und anpasst. Die Grenzwerte dafür stehen in privaten Regeln der Technik; bis die
  rechtliche Prüfung sie trägt, trägt der Betreiber in seiner Vorlage einen eigenen Grenzwert mit
  Quelle ein.

## Mängelklassen

Eine eigene Einteilung des Pakets, ohne Fundstelle: ohne Einfluss auf die Güte des Trinkwassers, Güte
gefährdet, Gefahr für die Gesundheit. Die letzte macht eine Anlage unsicher.

## Was das Paket nicht abdeckt

- Temperaturen der Trinkwassererwärmung und der Zirkulation, das Spülen selten genutzter
  Entnahmestellen, Inspektion und Wartung von Sicherungseinrichtungen und Filtern: sie stehen in den
  allgemein anerkannten Regeln der Technik (etwa DIN EN 806-5, DIN 1988-200, DVGW W 551,
  VDI/DVGW 6023). Sie kommen nach der rechtlichen Prüfung; das Spülen dann als eigene Pflichtart mit
  eigenem Nachweis, weil es in kürzerem Abstand zu belegen ist als ein Rundgang (Abschnitt 4.5).
- Was nach einem Befund am Maßnahmenwert folgt (§ 51 TrinkwV): Meldung an das Gesundheitsamt,
  Ursachenklärung vor Ort, Risikoabschätzung und Maßnahmen. Der Befund wird ein Mangel, und die
  Risikoabschätzung liegt als Dokument an der Installation; eine eigene Pflichtart dafür gibt es nicht,
  weil sie nicht wiederkehrt.
- Mobile und zeitweilige Wasserversorgungsanlagen, für die das Gesundheitsamt die Häufigkeit festlegt,
  und die Untersuchungen, die die Verordnung von Wasserversorgern verlangt.
- Die Trinkwasserverordnung von 2001, die die von 2023 ersetzt hat.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Die Verantwortung des Betreibers bleibt beim
Betreiber.
