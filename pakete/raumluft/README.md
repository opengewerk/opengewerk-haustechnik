# Paket Raumluft und Kälte

Lüftungs- und Klimaanlagen mit Wartung, Hygiene und energetischer Inspektion, Kälteanlagen mit der
Dichtheitskontrolle nach der F-Gas-Verordnung und Verdunstungskühlanlagen nach der 42. BImSchV (Abschnitt 5
des Planungskonzepts). Jeder Eintrag ist am 18.10.2026 gegen den amtlichen Text geprüft:

- die Arbeitsstättenverordnung auf gesetze-im-internet.de, zuletzt geändert am 27.03.2024;
- das Gebäudeenergiegesetz, das seit dem 29.07.2026 Gebäudemodernisierungsgesetz heißt, auf
  gesetze-im-internet.de und im Bundesgesetzblatt (BGBl. 2026 I Nr. 226);
- die Verordnung (EU) 2024/573 auf EUR-Lex;
- die Chemikalien-Klimaschutzverordnung vom 14.04.2026 (BGBl. 2026 I Nr. 100);
- die 42. BImSchV vom 12.07.2017.

Abgenommen ist das Paket noch nicht. Fachkundig abnehmen wird es beim Pilotbetrieb die Technische Leitung
(Abschnitt 15). Bis dahin kennzeichnet die Oberfläche jeden Eintrag.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe |
| --- | --- | --- |
| `ventilation_system` | Lüftungsanlage | 431 |
| `air_conditioning_system` | Klimaanlage | 433 |
| `refrigeration_system` | Kälteanlage | 434 |
| `evaporative_cooling_system` | Verdunstungskühlanlage | 434 |

Die Kostengruppe ist wie in den anderen Paketen eine eigene Zuordnung auf der dritten Ebene der DIN 276,
Ausgabe 2018-12, und nicht am Text der Norm geprüft.

- **Klimaanlage:** dazu gehören auch eine Teilklimaanlage, ein Splitgerät und eine kombinierte Klima- und
  Lüftungsanlage.
- **Verdunstungskühlanlage:** dazu gehört ein Rückkühlwerk mit offenem Kreislauf.
- **Was noch fehlt:** Wärmepumpen tragen dieselben Pflichten nach der F-Gas-Verordnung; sie kommen mit dem
  Paket Heizung (#352).

Die Pflichten fragen nach diesen Merkmalen:

| Merkmal | An | Einheit |
| --- | --- | --- |
| Nennleistung | Lüftungsanlage | ganze Kilowatt, ein Bruchteil aufgerundet |
| Nennleistung für den Kältebedarf | Klimaanlage | ganze Kilowatt, ein Bruchteil aufgerundet |
| Füllmenge fluorierter Treibhausgase nach Anhang I | Klima- und Kälteanlage | ganze Kilogramm CO2-Äquivalent: 4,9 t sind 4900 |
| Füllmenge ungesättigter H-FKW und H-FCKW nach Anhang II Gruppe 1 | Klima- und Kälteanlage | ganze Kilogramm |
| Hermetisch geschlossen und so gekennzeichnet | Klima- und Kälteanlage | ja oder nein |
| Mit Leckage-Erkennungssystem | Klima- und Kälteanlage | ja oder nein |

Gerundet wird bei der Leistung aufwärts: Das Gesetz fragt nach "mehr als 12 kW", und eine Anlage mit 12,5 kW
zählt so als 13 und bekommt die Inspektion.

**Fehlende Merkmale:** Solange an einer Anlage ein Merkmal fehlt, schlägt der Katalog jede Pflicht vor, die
danach fragt. Eine Klimaanlage, deren Füllmenge noch niemand eingetragen hat, bekommt deshalb alle Stufen der
Dichtheitskontrolle vorgeschlagen. Sind die Merkmale in der Akte eingetragen, bleibt die eine, die gilt.

**Eine Füllmenge von 0** heißt: keine Gase dieser Gruppe. Ohne Eintrag gilt die Füllmenge als unbekannt.

## Pflichtarten

| Pflichtart | Bedingung | Fundstelle | Frist |
| --- | --- | --- | --- |
| Raumlufttechnische Anlage instand halten und prüfen lassen | Lüftungs- und Klimaanlage | § 4 Abs. 3 ArbStättV | ohne Vorgabe, die Gefährdungsbeurteilung legt sie fest (ASR A3.6 Nr. 6.6) |
| Hygieneinspektion der raumlufttechnischen Anlage | Lüftungs- und Klimaanlage | VDI 6022 Blatt 1:2018-01, Abschnitt 7.4 | ohne Vorgabe bis zur rechtlichen Prüfung |
| Klimaanlage energetisch inspizieren lassen (bis 70 kW) | mehr als 12 bis 70 kW | § 74 Abs. 1 und § 76 GEG | 10 Jahre, Höchstfrist |
| Klimaanlage energetisch inspizieren lassen (über 70 kW) | mehr als 70 kW | §§ 74 bis 76 GEG, ab 2027 GModG | 10 Jahre, ab dem 01.01.2027 5 Jahre |
| Lüftungsanlage energetisch inspizieren lassen (über 70 kW) | mehr als 70 kW, ab dem 01.01.2027 | § 74 Abs. 1 und § 76 GModG | 5 Jahre, Höchstfrist |
| Auf Dichtheit kontrollieren lassen, 16 Stufen | Füllmenge, Verschluss und Leckage-Erkennung, siehe unten | Art. 5 Abs. 1 und 6 VO (EU) 2024/573 | 3 bis 24 Monate, Höchstfrist |
| Leckage-Erkennungssystem kontrollieren lassen | mit Leckage-Erkennungssystem | Art. 6 Abs. 1 und 3 VO (EU) 2024/573 | 12 Monate, Höchstfrist |
| Nutzwasser betriebsintern überprüfen | Verdunstungskühlanlage | § 4 Abs. 2 Nr. 1 der 42. BImSchV | 14 Tage, Höchstfrist |
| Nutzwasser im Labor untersuchen lassen | Verdunstungskühlanlage | § 4 Abs. 2 Nr. 2 und Abs. 3 der 42. BImSchV | 3 Monate, Höchstfrist |
| Verdunstungskühlanlage durch Sachverständige überprüfen lassen | Verdunstungskühlanlage | § 14 Abs. 1 der 42. BImSchV | 5 Jahre, Höchstfrist |

### Die energetische Inspektion zum 01.01.2027

Seit dem 29.07.2026 heißt das Gebäudeenergiegesetz Gebäudemodernisierungsgesetz. §§ 74 bis 78 sind dabei
inhaltlich gleich geblieben. Zum 01.01.2027 ändert Art. 2 des Gesetzes vom 23.07.2026 die Inspektion:

- Eine Klima- oder kombinierte Anlage über 70 kW wird zum ersten Mal im fünften Jahr inspiziert, danach alle
  fünf Jahre. Bis dahin galt beides mit zehn Jahren. Die Regel `ac_inspection_large_interval` hat beide Werte
  nebeneinander, mit dem Wechsel am 01.01.2027. Die Pflichtart bekommt an diesem Tag ihre zweite Fassung, und
  bestätigte Pflichten melden die kürzere Frist (Abschnitt 2.3).
- Neu ist die Lüftungsanlage über 70 kW, mit eigener Pflichtart ab dem 01.01.2027. Ältere Anlagen bekommen eine
  Übergangsfrist nach § 76 Abs. 1 Satz 4: sechs, vier oder zwei Jahre, je nach Alter. Den ersten Termin setzt
  der Betreiber, wenn er die Pflicht bestätigt. Was das Gesetz unter der Nennleistung einer Lüftungsanlage
  versteht, sagt es nicht.
- Bis 70 kW bleibt es bei zehn Jahren.

**Ausnahmen:** Sie stehen in der Beschreibung der Pflichtarten: Gebäudeautomation, ein Vertrag über die
Gesamtenergieeffizienz, die Überwachung im Wohngebäude. Gilt eine davon, verwirft der Betreiber den Vorschlag
mit dieser Begründung.

**Stichprobe:** Für mehr als zehn gleichartige Anlagen bis 70 kW in vergleichbaren Nichtwohngebäuden genügt eine
Stichprobe (§ 74 Abs. 2, § 75 Abs. 4). Das Paket bildet sie nicht ab: Die Pflichten der übrigen Anlagen verwirft
der Betreiber mit diesem Grund.

### Die Stufen der Dichtheitskontrolle

Die Verordnung staffelt nach der Füllmenge, getrennt für die Gase nach Anhang I in CO2-Äquivalent und für die
ungesättigten nach Anhang II Gruppe 1 in Kilogramm (Art. 5 Abs. 6). Ein Leckage-Erkennungssystem verdoppelt die
Frist.

| Stufe | Anhang I | Anhang II Gruppe 1 | ohne Erkennung | mit Erkennung |
| --- | --- | --- | --- | --- |
| a | 5 bis unter 50 t | 1 bis unter 10 kg | 12 Monate | 24 Monate |
| b | 50 bis unter 500 t | 10 bis unter 100 kg | 6 Monate | 12 Monate |
| c | ab 500 t | ab 100 kg | 3 Monate | 6 Monate |

Eine hermetisch geschlossene und so gekennzeichnete Einrichtung braucht die Kontrolle erst ab 10 t oder ab 2 kg
(Art. 5 Abs. 1 Unterabs. 2). Deshalb hat Stufe a je Gasgruppe eine eigene Pflichtart für eine solche
Einrichtung. Das ergibt acht Pflichtarten je Gasgruppe, zusammen sechzehn. Die Schlüssel sagen, welche:
`leak_check_annex1_band_a_sealed_detection` ist Anhang I, Stufe a, hermetisch geschlossen, mit Erkennung.

Ab Stufe c ist ein Leckage-Erkennungssystem Pflicht (Art. 6 Abs. 1). Mit ihm kommt seine eigene Kontrolle alle
zwölf Monate.

Kontrollieren darf nur eine natürliche Person, die nach Art. 10 der Verordnung zertifiziert ist. In Deutschland
braucht sie eine Sachkundebescheinigung nach § 5 der Chemikalien-Klimaschutzverordnung (§ 14 Abs. 2). Das Paket
bringt dafür die Art der Qualifikation `fgas_certified_person`, für die energetische Inspektion
`energy_inspector`.

Die Aufzeichnungen nach Art. 7 stehen im Formular `leak_check`: Kältemittel, Füllmenge, Nachfüllung,
Rückgewinnung, Unternehmen mit Zertifikat, Person mit Sachkundebescheinigung, Ergebnis und Reparatur. Sie bleiben
fünf Jahre.

### Verdunstungskühlanlagen

- **Überprüfung im Betrieb:** alle zwei Wochen, mit dem Formular `cooling_water_protocol`.
- **Laboruntersuchung:** alle drei Monate auf allgemeine Koloniezahl und Legionellen, durch ein akkreditiertes
  Prüflaboratorium, mit dem Befund im Formular `cooling_water_findings`.
- **Sachverständige:** alle fünf Jahre.
- **Legionellen:** Sie werden gegen den Prüfwert 1 von 100 KBE je 100 ml gemessen, mit `at_most`. Die Verordnung
  spricht von einer Überschreitung, also liegt erst ein Befund über 100 außerhalb. Er steht am Protokoll mit der
  Fundstelle und wird mit der Unterschrift ein Mangel an der Anlage.
- **Was der Betreiber danach tut:** Prüfwert 2, Maßnahmenwert, Meldung an die Behörde und die engeren
  Abstände nach §§ 5, 6, 9 und 10 stehen in der Beschreibung der Pflichtarten.

Die Nachweise bleiben, solange die Anlage in Betrieb ist. Das Betriebstagebuch muss bis fünf Jahre nach seinem
letzten Eintrag bleiben (§ 12 Abs. 3), und das Paket kennt keine Frist, die erst mit dem letzten Eintrag
beginnt. Das Betriebstagebuch aus den Nachweisen einer Anlage kommt mit #437.

## Formulare

| Formular | Wofür |
| --- | --- |
| `ventilation_protocol` | Wartung und Prüfung einer raumlufttechnischen Anlage, mit den Prüfgrößen der ASR A3.6 Nr. 6.6 Abs. 3 |
| `energy_inspection` | die energetische Inspektion, mit der Registriernummer des Berichts |
| `leak_check` | die Dichtheitskontrolle mit den Aufzeichnungen nach Art. 7 |
| `cooling_water_protocol` | die betriebsinterne Überprüfung des Nutzwassers mit den Bioziden |
| `cooling_water_findings` | der Befund des Labors |

## Mängelklassen

Eine eigene Einteilung des Pakets, ohne Fundstelle:

- **gering:** ohne Einfluss auf Betrieb und Hygiene;
- **erheblich:** Betrieb, Hygiene oder Dichtheit beeinträchtigt;
- **Gefahr für die Gesundheit:** diese Klasse macht eine Anlage unsicher.

## Was das Paket nicht abdeckt

- Die Abstände der Hygieneinspektion nach VDI 6022 und den Wechsel der Luftfilter: Sie stehen in privaten Regeln
  und kommen nach der rechtlichen Prüfung.
- Die einmaligen Pflichten der 42. BImSchV, mit denen der Betreiber selbst rechnet:
  - die Gefährdungsbeurteilung vor der Inbetriebnahme (§ 3 Abs. 4), als verlangtes Soll-Dokument der Anlagenart;
  - die Prüfschritte nach Anlage 2;
  - die Anzeige bei der Behörde (§ 13).
- Kühltürme und Nassabscheider der 42. BImSchV: Sie gehören zu Kraftwerken und Prozessen, nicht zur
  Haustechnik.
- Die Grenzwerte des Kältemittelverlusts nach § 2 der Chemikalien-Klimaschutzverordnung: Sie folgen aus den
  Nachfüllmengen über die Jahre, nicht aus einem Termin.
- Mobile Einrichtungen nach Art. 5 Abs. 3 der Verordnung und elektrische Schaltanlagen.
- Die Verordnung (EU) Nr. 517/2014 und die Energieeinsparverordnung, die die heutigen Vorschriften abgelöst
  haben.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Die Verantwortung des Betreibers bleibt beim
Betreiber.
