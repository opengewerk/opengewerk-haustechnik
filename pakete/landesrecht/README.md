# Paket Landesrecht

Je Land die Prüfung technischer Anlagen in Sonderbauten (Abschnitt 5 des Planungskonzepts).
Bauordnungsrecht ist Landesrecht: eine Prüfung, die ein Land vorschreibt, gibt es im nächsten
nicht, und die Fristen weichen je Land und Anlagenart ab (Abschnitt 2.9). Jede Pflichtart nennt
deshalb ihr Land in `states` und die Gebäudeart, für die ihre Verordnung gilt, in `buildingKinds`;
jede Regel nennt ihr Land in `scope`. Für ein Gebäude in einem anderen Land oder einer anderen
Gebäudeart schlägt das Paket nichts vor.

Das Paket bringt Baden-Württemberg, das Land des Pilotbetriebs. Es nennt die Anlagenarten der
Pakete [`brandschutz`](../brandschutz/README.md), [`elektro`](../elektro/README.md) und seit der
Fassung 1.1.0 (#354) [`raumluft`](../raumluft/README.md); eine eigene Anlagenart hat es nicht. Für die
Anlagenarten der Pakete [`heizung`](../heizung/README.md) und [`arbeitsmittel`](../arbeitsmittel/README.md)
verlangen die drei Verordnungen keine Prüfung.

Fachkundig abgenommen hat die Fassung 1.0.0 der Pilotbetrieb am 16.10.2026 (Abschnitt 15), jeder
Eintrag mit der Prüfsumme dessen, was abgenommen wurde. Die zweiten Fassungen der Prüfungen in
Versammlungsstätten und Garagen aus 1.1.0 sind noch nicht abgenommen. Wird ein Eintrag geändert, fällt seine Abnahme
weg, und die Oberfläche kennzeichnet ihn wieder, bis er erneut abgenommen ist.

## Baden-Württemberg

Das Land hat keine eigene Prüfverordnung. Die Prüfungen stehen in drei Sonderbauverordnungen, und
nur dort: Versammlungsstättenverordnung (VStättVO), Verkaufsstättenverordnung (VkVO) und
Garagenverordnung (GaVO). Wer prüft, sagt die Bausachverständigenverordnung (BauSVO): ein von der
obersten Baurechtsbehörde anerkannter Sachverständiger, ein in einem anderen Land anerkannter oder
ein sachkundiger Bediensteter einer Verwaltung für deren eigene Anlagen (§ 1 BauSVO).

| Pflichtart | Gebäudeart | Anlagenarten | Fundstelle | Frist | Wer prüft |
| --- | --- | --- | --- | --- | --- |
| Anlagen einer Versammlungsstätte prüfen lassen | Versammlungs- oder Sportstätte | Lüftungsanlage, Klimaanlage, Rauch- und Wärmeabzug, Feuerlöschanlage, Wandhydrant, Brandmeldeanlage, Alarmierungsanlage, Sicherheitsstromversorgung, Sicherheitsbeleuchtung | § 37 Abs. 1 Nr. 1 bis 6 VStättVO BW | 3 Jahre | anerkannter Sachverständiger |
| Blitzschutz einer Versammlungsstätte prüfen lassen | Versammlungs- oder Sportstätte | Blitzschutzanlage | § 37 Abs. 4 VStättVO BW | 3 Jahre | Sachkundige |
| Anlagen einer Verkaufsstätte prüfen lassen | Verkaufsstätte | Feuerlöschanlage, Rauch- und Wärmeabzug, Sicherheitsbeleuchtung, Brandmeldeanlage, Sicherheitsstromversorgung | § 30 Abs. 1 VkVO BW | 3 Jahre | anerkannter Sachverständiger |
| Anlagen einer Garage prüfen lassen | Garage | Rauch- und Wärmeabzug, Feuerlöschanlage, Wandhydrant, Sicherheitsbeleuchtung, Sicherheitsstromversorgung, Lüftungsanlage, CO-Warnanlage | § 16 Abs. 1 GaVO BW | 3 Jahre | anerkannter Sachverständiger |

Jede Prüfung kommt vor der ersten Inbetriebnahme, nach einer wesentlichen Änderung und dann
wiederkehrend. Die Frist ist eine Höchstfrist und zählt ab dem Tag der letzten Prüfung; die Berichte
werden mindestens fünf Jahre aufbewahrt. Die Fristen und die Aufbewahrung stehen als Regeln in
`regeln/baden-wuerttemberg.json`, jede mit `"scope": "DE-BW"` und vom Tag an, seit dem ihr
Paragraf so gilt: 1. Juli 2004 (VStättVO), 1. April 1997 (VkVO) und 1. Februar 2021 (GaVO). Bis
Januar 2021 verlangte die GaVO kürzere Fristen; diese Fassung steht nicht im Paket. Geprüft ist
jede Fundstelle am 14.10.2026 an der aktuellen Gesamtausgabe auf landesrecht-bw.de, Stand der
Änderung vom 12. Juni 2025.

Was eine Verordnung an Größe verlangt, ist keine Gebäudeart und steht im Text der Pflichtart: die
VStättVO gilt für Versammlungsräume ab mehr als 200 Besuchern, Versammlungsstätten im Freien ab
mehr als 1000 und Sportstadien ab mehr als 5000, die VkVO für Verkaufsstätten mit mehr als
2000 m² Verkaufsfläche samt Ladenstraßen, die GaVO für geschlossene Mittel- und Großgaragen ab
100 m² Nutzfläche. Ein kleineres Gebäude bekommt den Vorschlag trotzdem, und der Betreiber verwirft
ihn: ein Vorschlag zu viel wird verworfen, einer zu wenig fällt niemandem auf (ADR 0002, Nachtrag
vom 03.10.2026).

Ebenso steht im Text, was eine Anlagenart weiter fasst als die Verordnung: die VkVO nennt von den
Feuerlöschanlagen nur die Sprinkleranlagen, die GaVO vom Rauchabzug nur den maschinellen und von der
Lüftung nur die maschinelle Zu- und Abluft, die VStättVO vom Wandhydranten nur den an einer nassen
Steigleitung und von den Lüftungsanlagen keine, die einzelne Räume im selben Geschoss unmittelbar ins
Freie be- oder entlüftet. Eine Klimaanlage ist eine Lüftungsanlage.

Die Lüftungs- und CO-Warnanlagen kamen mit der Fassung 1.1.0 als zweite Fassung der Prüfungen in
Versammlungsstätten und Garagen dazu, vom selben Tag an wie die erste, denn ihre Paragrafen nennen sie
seit dem 1. Juli 2004 und dem 1. Februar 2021. Eine bestätigte Pflicht meldet die neue Fassung
(Abschnitt 2.3 des Konzepts); eine Lüftungs- oder CO-Warnanlage bekommt sie als Vorschlag. Wer die Prüfung
bisher als eigene Pflicht geführt hat, nennt sie beim Bestätigen des Vorschlags; sie endet dann, und ihr
letzter Nachweis zählt für den Termin der neuen.

## Was das Paket nicht abdeckt

- Prüfungen, die eine Baugenehmigung oder ein Brandschutzkonzept im Einzelfall auferlegt (§ 38
  Abs. 3 LBO), etwa in einem Hochhaus, einem Krankenhaus oder einer Schule: dafür gibt es in
  Baden-Württemberg keine Verordnung, und das Paket kennt die Genehmigung nicht. Auch sie legt der Betreiber als eigene
  Pflichten an.
- Rauchwarnmelder in Schlafräumen und ihren Rettungswegen nach § 15 Abs. 9 LBO; für sie hat noch
  kein Paket eine Anlagenart, und ihre Betriebsbereitschaft ist Sache der Bewohner.
- Die Prüfung, die die Baurechtsbehörde selbst in Versammlungsstätten vornimmt, und die
  Mitteilungen des Sachverständigen an sie: sie sind keine Pflicht des Betreibers.
- Die übrigen Länder.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Die Verantwortung des Betreibers bleibt beim
Betreiber.
