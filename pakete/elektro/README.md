# Paket Elektro

Elektrische Anlagen und ortsfeste Betriebsmittel, ortsveränderliche Betriebsmittel,
Fehlerstrom-Schutzeinrichtungen, Sicherheitsbeleuchtung, Sicherheitsstromversorgung und Blitzschutz
(Abschnitt 5 des Planungskonzepts). Die erste Fassung bringt die Einträge aus staatlichem Recht und
aus den Unfallverhütungsvorschriften. Aus privaten Normen kommen seit der Fassung 1.3.0 die Grenzwerte
der Messungen je Stromkreis, als Regeln mit Norm, Ausgabe und Abschnitt; weitere Verweise auf private
Normen kommen als neue Fassung, sobald sie am Text der Norm geprüft sind.

Fachkundig abgenommen hat das Paket der Maintainer am 16.10.2026 (Abschnitt 15), jeder Eintrag
mit der Prüfsumme dessen, was abgenommen wurde. Wird ein Eintrag geändert, fällt seine Abnahme
weg, und die Oberfläche kennzeichnet ihn wieder, bis er erneut abgenommen ist. Die Einträge, die mit
der Fassung 1.3.0 dazukamen, sind noch nicht abgenommen und bis dahin gekennzeichnet.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe | Merkmal für den Geltungsbereich |
| --- | --- | --- | --- |
| `low_voltage_installation` | Elektrische Anlage (Niederspannung) | 444 | in einem Raum besonderer Art |
| `fixed_equipment` | Ortsfestes elektrisches Betriebsmittel | 449 | in einem Raum besonderer Art |
| `portable_equipment` | Ortsveränderliches elektrisches Betriebsmittel | 610 | Arbeitsbereich |
| `residual_current_device` | Fehlerstrom-Schutzeinrichtung | 444 | |
| `safety_lighting` | Sicherheitsbeleuchtung | 445 | |
| `safety_power_supply` | Sicherheitsstromversorgung | 442 | |
| `lightning_protection` | Blitzschutzanlage | 446 | |

Die Kostengruppen folgen der DIN 276, Ausgabe 2018-12, auf der dritten Ebene. Ein ortsveränderliches
Betriebsmittel ist Ausstattung und keine technische Anlage des Bauwerks; es steht deshalb in der
Kostengruppe 610 und nicht unter 400.

Ein Merkmal, das niemand eingetragen hat, erfüllt keine Bedingung: Für ein ortsveränderliches
Betriebsmittel ohne Arbeitsbereich und eine Anlage ohne Angabe zum Raum besonderer Art schlägt das
Paket nichts vor, was von diesem Merkmal abhängt.

## Pflichtarten

### DGUV Vorschrift 3 und Vorschrift 4

Die Prüfung nach § 5 Abs. 1 Nr. 2 der Unfallverhütungsvorschrift "Elektrische Anlagen und
Betriebsmittel". Vorschrift 3 gilt für Unternehmen, die bei einer Berufsgenossenschaft versichert sind,
Vorschrift 4 für die bei einer Unfallkasse. Die Fristen ihrer Durchführungsanweisungen sind Richtwerte
und in beiden verschieden; deshalb steht jede Prüfung zweimal im Paket, einmal je Vorschrift. Der
Betreiber verwirft die Vorschläge der Vorschrift, die für ihn nicht gilt.

| Prüfung | Vorschrift 3 | Vorschrift 4 |
| --- | --- | --- |
| Elektrische Anlage und ortsfeste Betriebsmittel | 4 Jahre, in Räumen besonderer Art 1 Jahr | 4 Jahre |
| Prüftaste der Fehlerstrom-Schutzeinrichtung in ortsfesten Anlagen | 6 Monate | 6 Monate |
| Ortsveränderliche Betriebsmittel | 6 Monate, auf Baustellen 3 Monate | nach Arbeitsbereich 6, 12 oder 24 Monate |

Die Richtwerte stehen als Regeln in `regeln/dguv.json` und gelten dort ab dem 01.01.2005, der Ausgabe
der Durchführungsanweisungen, deren Text geprüft ist. Für einen Arbeitsbereich, den die Tabelle von
Vorschrift 4 nicht nennt, gibt sie keinen Richtwert; dort legt der Betreiber die Frist fest.

Die Prüfung der elektrischen Anlage wird seit der zweiten Fassung ihrer drei Pflichtarten mit dem
Formular `installation_test` als Protokoll nachgewiesen oder wie bisher als Bericht eingetragen.

### Arbeitsstättenverordnung

Sicherheitsbeleuchtung und Notaggregate hält der Arbeitgeber instand und lässt sie in regelmäßigen
Abständen auf ihre Funktionsfähigkeit prüfen (§ 4 Abs. 3 ArbStättV). Eine Frist nennt die Verordnung
nicht; der Betreiber legt sie fest.

## Formulare

Die Formulare, die ohne Stromkreis auskommen (Entscheidung vom 04.10.2026):

- `portable_equipment_test`: Prüfung eines ortsveränderlichen Betriebsmittels mit Besichtigen, den
  Messwerten in Ω, MΩ und mA und der Funktion
- `rcd_test_button`: Prüftaste der Fehlerstrom-Schutzeinrichtung
- `safety_lighting_function_test`: Funktionsprüfung und Prüfung der Betriebsdauer der
  Sicherheitsbeleuchtung, mit den Leuchten, an denen etwas auffiel

Die Messwerte des ortsveränderlichen Betriebsmittels haben keinen Grenzwert im Formular. Die
Grenzwerte stehen in privaten Normen; ob und wie das Paket sie nennen darf, klärt die rechtliche
Prüfung (Abschnitt 15). Bis dahin beurteilt die prüfende Person sie mit dem Prüfpunkt "Grenzwerte
eingehalten".

Die Formulare mit den Messungen je Stromkreis, seit der Fassung 1.3.0:

- `installation_initial_test`: Erstprüfung der elektrischen Anlage nach DIN VDE 0100-600 mit
  Besichtigen, Erproben und Messen
- `installation_test`: wiederkehrende Prüfung der elektrischen Anlage nach DGUV Vorschrift 3 oder 4
  mit DIN VDE 0105-100, mit denselben Messungen

Ihre Gruppe "Messen je Stromkreis" hat einen Block für jeden Stromkreis der Anlage aus dem
Stromkreisverzeichnis und keinen weiteren: Schutzleiter RPE, Isolationswiderstand Riso,
Schleifenimpedanz Zs, Auslösestrom IΔ und Auslösezeit tΔ, dazu der Prüfpunkt "Stromkreis in
Ordnung" und eine Bemerkung. Vor der Unterschrift braucht jeder Stromkreis seinen Prüfpunkt. Die
Grenzwerte stehen in `regeln/vde.json`, mit denselben Werten und Fundstellen wie im Paket Elektro
der Handwerkersoftware OpenGewerk: der Isolationswiderstand mindestens 1 MΩ, die Auslösezeit höchstens
300 ms. Die Schleifenimpedanz und der Auslösestrom werden aus dem Stromkreis berechnet, die
Schleifenimpedanz aus der Nennspannung und dem Auslösestrom der Charakteristik B, C oder D bei
seinem Nennstrom, der Auslösestrom aus seinem Bemessungsdifferenzstrom. Ein Messwert außerhalb seines
Grenzwerts wird ein Mangel an der Anlage, mit dem Stromkreis, an dem er gemessen wurde. Alle
Grenzwerte gelten ab dem 01.06.2017, der Ausgabe der DIN VDE 0100-600, nach der die Messungen
aufgebaut sind.

## Mängelklassen

Eine eigene Einteilung des Pakets, ohne Fundstelle: ohne unmittelbare Gefahr, mit Gefahr und umgehend
zu beheben, Gefahr im Verzug. Die letzte macht eine Anlage unsicher.

## Was das Paket nicht abdeckt

- Verweise auf private Normen, etwa zur Prüfung des Blitzschutzes, zur Sicherheitsbeleuchtung und zur
  Prüfung ortsveränderlicher Geräte. Die Blitzschutzanlage hat deshalb in dieser Fassung keine
  Pflichtart; die Prüfung in Sonderbauten bringt das Paket für das Landesrecht.
- Nichtstationäre Anlagen, etwa auf Bau- und Montagestellen: die monatliche Prüfung der Schutzmaßnahmen
  mit Fehlerstrom-Schutzeinrichtungen und die arbeitstägliche Prüftaste.
- Die Schutz- und Hilfsmittel für das Arbeiten an elektrischen Anlagen (Tabelle 1C der
  Durchführungsanweisungen) und die Fristen der Eisenbahn-Unfallkasse.
- Messwerte je Verteiler und je Betriebsmittel einer Anlage.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Welche Pflicht für eine Anlage gilt,
entscheidet der Betreiber.
