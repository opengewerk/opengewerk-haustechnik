# Paket Brandschutz

Feuerlöscher, Brandmelde- und Alarmierungsanlagen, Rauch- und Wärmeabzug, Feststellanlagen,
Brandschutzklappen, Wandhydranten, Löschanlagen und Brandschutztüren (Abschnitt 5 des
Planungskonzepts). Diese erste Fassung bringt die Einträge aus der Arbeitsstättenverordnung und aus
den Technischen Regeln für Arbeitsstätten. Viele Fristen dieses Bereichs stehen in privaten Normen;
deren Verweise kommen als neue Fassung, sobald die rechtliche Prüfung sie trägt und sie am Text der
Norm geprüft sind.

Fachkundig abgenommen hat das Paket der Pilotbetrieb am 16.10.2026 (Abschnitt 15), jeder Eintrag
mit der Prüfsumme dessen, was abgenommen wurde. Wird ein Eintrag geändert, fällt seine Abnahme
weg, und die Oberfläche kennzeichnet ihn wieder, bis er erneut abgenommen ist.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe |
| --- | --- | --- |
| `fire_extinguisher` | Feuerlöscher | 474 |
| `wall_hydrant` | Wandhydrant | 474 |
| `extinguishing_system` | Feuerlöschanlage | 474 |
| `fire_alarm_system` | Brandmeldeanlage | 456 |
| `alarm_system` | Alarmierungsanlage | 456 |
| `smoke_extraction` | Rauch- und Wärmeabzugsanlage | 431 |
| `fire_damper` | Brandschutzklappe | 431 |
| `fire_door` | Brandschutztür oder -tor | 344 |
| `hold_open_device` | Feststellanlage | 344 |

Die Kostengruppen sind eine eigene Zuordnung auf der dritten Ebene der DIN 276, Ausgabe 2018-12, wie
im Paket `messstellen`, und nicht am Text der Norm geprüft. Ein natürlicher Rauchabzug im Dach oder in
der Fassade kann in einer Kostenplanung auch unter der Baukonstruktion stehen. Brandschutztür und
Feststellanlage sind Bauteile einer Innenwand und stehen deshalb unter 344 und nicht unter 400.

Das Paket für das Landesrecht nennt diese Anlagenarten für die Prüfungen, die das Bauordnungsrecht
eines Landes verlangt, etwa `brandschutz.smoke_extraction`.

## Pflichtarten

| Pflichtart | Anlagenarten | Fundstelle | Frist |
| --- | --- | --- | --- |
| Feuerlöscher warten lassen | Feuerlöscher | ASR A2.2 Nr. 7.4.2 | 2 Jahre, Richtwert |
| Instand halten und prüfen lassen | Brandmeldeanlage, Wandhydrant | ASR A2.2 Nr. 7.4.1 | nach Hersteller |
| Sicherheitseinrichtung instand halten und prüfen lassen | Alarmierungsanlage, Rauch- und Wärmeabzug, Feuerlöschanlage, Brandschutzklappe | § 4 Abs. 3 ArbStättV | keine |
| Brandschutztür oder -tor prüfen | Brandschutztür oder -tor | ASR A1.7 Nr. 10.2 Abs. 3 | nach Zulassung |
| Feststellanlage monatlich prüfen | Feststellanlage | ASR A1.7 Nr. 10.2 Abs. 3 | 1 Monat, Richtwert |
| Feststellanlage jährlich prüfen lassen | Feststellanlage | ASR A1.7 Nr. 10.2 Abs. 3 | 1 Jahr, Richtwert |

Die ASR A2.2 zählt Wandhydranten zu den Feuerlöscheinrichtungen; für Feuerlöscher hat sie die
eigene Regel mit zwei Jahren, die eine längere Frist des Herstellers zulässt. Bis zur Änderung vom
Mai 2025 standen beide Regeln unter Nr. 7.5. Die ASR A1.7 nennt für Feststellanlagen einmal im Monat
durch den Betreiber und einmal im Jahr durch Sachkundige als Beispiel; das Paket führt beides als
Richtwert, maßgeblich ist die Zulassung.

Die Fristen stehen als Regeln in `regeln/asr.json` und beginnen mit der Ausgabe ihrer ASR, Mai 2018
und November 2009. Geprüft sind sie am Text der BAuA in der jeweils geltenden Fassung.

## Formulare und Vorlagen

- `hold_open_device_function_check`: die monatliche Prüfung der Feststellanlage durch den Betreiber.
- Vorlage `fire_extinguisher_visual_check`: eine Sichtkontrolle der Feuerlöscher für einen Rundgang,
  die ein Betreiber übernimmt und anpasst. Eine Pflicht dazu nennt keine der Quellen; sie hilft, einen
  Feuerlöscher, der fehlt oder beschädigt ist, vor der nächsten Wartung zu finden.

## Mängelklassen

Eine eigene Einteilung des Pakets, ohne Fundstelle: ohne Einfluss auf die Funktion, Funktion
eingeschränkt, nicht funktionsfähig. Die letzte macht eine Anlage unsicher; nach der ASR A2.2 wird
eine solche Einrichtung unverzüglich instand gesetzt oder ausgetauscht.

## Was das Paket nicht abdeckt

- Fristen und Prüfungen aus privaten Normen und Richtlinien, etwa für Brandmeldeanlagen, die
  Instandhaltung von Feuerlöschern, Wandhydranten, Rauch- und Wärmeabzug, Feststellanlagen und
  Löschanlagen. Bis die rechtliche Prüfung sie trägt, trägt der Betreiber die Frist ein.
- Die Prüfungen nach dem Bauordnungsrecht der Länder in Sonderbauten: sie stehen im Paket
  [`landesrecht`](../landesrecht/README.md). Rauchwarnmelder in Wohnungen hat noch kein Paket.
- Die wiederkehrende Druckprüfung von Feuerlöschern und Behältern einer Gaslöschanlage nach der
  Betriebssicherheitsverordnung.
- Brandschutzklappen nach ihrer Zulassung und den Angaben des Herstellers; das Paket schlägt für sie
  nur die Pflicht aus der Arbeitsstättenverordnung vor.
- Organisatorischer Brandschutz ohne Anlage: Brandschutzhelfer, Brandschutzordnung, Flucht- und
  Rettungspläne, Unterweisungen.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Die Verantwortung des Betreibers bleibt beim
Betreiber.
