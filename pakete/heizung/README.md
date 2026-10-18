# Paket Heizung

Wärmeerzeuger und Wärmepumpen, Abgasanlage, Heizöllagerung und Gasinstallation (Abschnitt 5 des
Planungskonzepts). Jeder Eintrag ist am 18.10.2026 gegen den amtlichen Text geprüft:

- das Gebäudeenergiegesetz, seit dem 29.07.2026 Gebäudemodernisierungsgesetz, auf gesetze-im-internet.de
  und im Bundesgesetzblatt (BGBl. 2026 I Nr. 226);
- die 1. BImSchV in der Fassung vom 13.10.2021;
- das Schornsteinfeger-Handwerksgesetz mit der Kehr- und Überprüfungsordnung;
- die AwSV vom 18.04.2017;
- die NDAV, zuletzt geändert am 18.12.2025.

Abgenommen ist das Paket noch nicht. Fachkundig abnehmen wird es beim Pilotbetrieb die Technische Leitung
(Abschnitt 15). Bis dahin kennzeichnet die Oberfläche jeden Eintrag.

## Anlagenarten

| Schlüssel | Anlagenart | Kostengruppe |
| --- | --- | --- |
| `boiler` | Heizkessel | 421 |
| `heat_pump` | Wärmepumpe | 421 |
| `flue_system` | Abgasanlage | 421 |
| `oil_storage` | Heizöllagerung | 421 |
| `gas_installation` | Gasinstallation | 413 |

Die Kostengruppe ist wie in den anderen Paketen eine eigene Zuordnung auf der dritten Ebene der DIN 276,
Ausgabe 2018-12, und nicht am Text der Norm geprüft. Die Heizöllagerung zählt zur Brennstoffversorgung des
Wärmeerzeugers.

Die Merkmale:

- **Heizkessel:** Brennstoff (Heizöl, Gas, feste Brennstoffe) und Nennwärmeleistung in ganzen Kilowatt. Dazu
  drei Fragen: Ist es ein Brennwertgerät? Liegen Inbetriebnahme oder Kesseltausch mehr als zwölf Jahre
  zurück? Hat er eine selbstkalibrierende Verbrennungsregelung?
  - Die zwölf Jahre ändern sich mit der Zeit. Der Betreiber setzt das Merkmal um, wenn es so weit ist; die
    Messpflicht bekommt dann ihre kürzere Frist.
- **Wärmepumpe:** die Bauart, mindestens sechs Wohnungen oder Nutzungseinheiten, eingebaut nach dem
  31.12.2023, Fernkontrolle und Wartungsvertrag. Dazu dieselben Merkmale der F-Gas-Verordnung wie eine
  Klimaanlage.
- **Heizöllagerung:** die Gefährdungsstufe nach § 39 AwSV, ob sie unterirdisch ist und ob sie in einem
  Schutz- oder Überschwemmungsgebiet liegt. Bei Heizöl (Wassergefährdungsklasse 2) ist Stufe A bis 1 m³,
  B über 1 bis 10 m³, C über 10 bis 100 m³ und D darüber.

Solange ein Merkmal fehlt, schlägt der Katalog jede Pflicht vor, die danach fragt.

## Pflichtarten

| Pflichtart | Bedingung | Fundstelle | Frist |
| --- | --- | --- | --- |
| Wärmeerzeuger warten und instand halten | Heizkessel, Wärmepumpe | § 60 Abs. 1 und 2 GEG | ohne Vorgabe |
| Wärmepumpe prüfen und optimieren lassen | ab sechs Einheiten, nach 2023, ohne Fernkontrolle; ab 2027 auch ohne Wartungsvertrag | § 60a GEG, ab 2027 GModG | 5 Jahre, Höchstfrist |
| Feuerungsanlage für Heizöl oder Gas messen lassen, 6 Stufen | ab 4 kW, Gas nicht als Brennwertgerät | § 15 Abs. 3 der 1. BImSchV | jedes dritte, zweite oder fünfte Kalenderjahr |
| Feuerungsanlage für feste Brennstoffe messen lassen | ab 4 kW | § 15 Abs. 1 der 1. BImSchV | jedes zweite Kalenderjahr |
| Abgasanlage kehren und überprüfen lassen | Abgasanlage | § 1 Abs. 1 und § 4 SchfHwG mit § 1 KÜO | aus dem Feuerstättenbescheid |
| Feuerstättenschau zulassen | Abgasanlage | § 14 SchfHwG | 5 Jahre, Richtwert |
| Heizöllagerung selbst kontrollieren | Heizöllagerung | § 46 Abs. 1 AwSV | ohne Vorgabe |
| Heizöllagerung durch Sachverständige prüfen lassen, 4 Fälle | nach Stufe, Lage und Schutzgebiet | § 46 Abs. 2 und 3 AwSV mit Anlage 5 und 6 | 5 Jahre, unterirdisch im Schutzgebiet 30 Monate |
| Gasinstallation instand halten | Gasinstallation | § 13 Abs. 1 und 2 NDAV | ohne Vorgabe |
| Gasleitungen auf Gebrauchsfähigkeit prüfen lassen | Gasinstallation | DVGW G 600 (A):2018-09, Abschnitt 13.3 | ohne Vorgabe bis zur rechtlichen Prüfung |
| Gasinstallation in Augenschein nehmen | Gasinstallation | DVGW G 600 (A):2018-09, Abschnitt 13.3 | ohne Vorgabe bis zur rechtlichen Prüfung |

### Die Wärmepumpe zum 01.01.2027

Die Betriebsprüfung nach § 60a hat zwei Fassungen, die Regel ihrer Frist zwei Datensätze mit dem Wechsel am
01.01.2027.

- **Bis 31.12.2026:** Geprüft wird eine Wärmepumpe, die über Wasser heizt. Mit Fernkontrolle wiederholt sich
  die Prüfung nicht, die erste ist trotzdem fällig.
- **Ab 01.01.2027:**
  - Eine Fernkontrolle oder ein Wartungsvertrag erspart die Prüfung ganz.
  - Die Luft-Luft-Wärmepumpe kommt dazu, wie es der Ausschuss begründet. Der Wortlaut "für Raumwärme und
    Warmwasser" lässt das offen.
  - Eine Wärmepumpe nur für Warmwasser bleibt draußen.

Die erste Prüfung kommt nach einer vollständigen Heizperiode, spätestens zwei Jahre nach der Inbetriebnahme;
ihren Termin setzt der Betreiber beim Bestätigen.

Den Nachweis bewahrt der Eigentümer zehn Jahre auf (§ 96 Abs. 2). Ab 2027 verweist § 96 noch auf einen
Absatz, den es dann nicht mehr gibt; das Paket bleibt bei zehn Jahren.

Die Dichtheitskontrolle einer Wärmepumpe steht nicht hier, sondern im Paket Raumluft und Kälte: seine
sechzehn Stufen und die Kontrolle des Leckage-Erkennungssystems nennen in ihrer Fassung 2 die Wärmepumpe
dieses Pakets, vom selben Tag an wie Fassung 1 (Art. 5 Abs. 2 Buchst. c der Verordnung (EU) 2024/573).

### Messen, Kehren, Feuerstättenschau

- **Wer die Termine setzt:** Verbindlich sind die Termine aus dem Feuerstättenbescheid des bevollmächtigten
  Bezirksschornsteinfegers (§ 14a SchfHwG). Er legt je Arbeit fest, wie oft sie im Kalenderjahr kommt und
  bis wann.
- **Kehren und Überprüfen:** Die Pflichtart hat deshalb keine Frist. Der Betreiber trägt sie aus dem Bescheid
  ein, mit dem Bescheid als Begründung. Die Grundzahlen der KÜO reichen von viermal im Jahr bis einmal in
  jedem dritten Jahr.
- **Messen:** Die Messung nach der 1. BImSchV hat feste Abstände, die das Paket als Höchstfrist in Jahren führt.
  Die Verordnung zählt in Kalenderjahren.
- **Gas-Brennwertgeräte:** Sie sind von den Anforderungen an den Abgasverlust ausgenommen und deshalb nicht
  messpflichtig. Die Überprüfung nach der KÜO bleibt.

### Heizöllagerung

Sachverständige prüfen nach Anlage 5 (außerhalb von Schutzgebieten) und Anlage 6 (in Wasserschutz-,
Heilquellenschutz- und Überschwemmungsgebieten):

| | außerhalb | im Schutzgebiet |
| --- | --- | --- |
| oberirdisch | ab Stufe C, alle 5 Jahre | ab Stufe B, alle 5 Jahre |
| unterirdisch | jede Stufe, alle 5 Jahre | jede Stufe, alle 30 Monate |

Die Frist beginnt mit der Prüfung vor der Inbetriebnahme. Es genügt, bis zum Ende des Monats zu prüfen, in
dem sie fällig ist.

Die Anlagendokumentation ist für jede Heizöllagerung verlangt (§ 43 Abs. 1). Das Merkblatt nach Anlage 3
hängt an der Anlage (§ 44 Abs. 4); das fragt das Formular der Eigenkontrolle ab.

### Gasinstallation

Eine staatliche wiederkehrende Prüfung der Gasleitungen gibt es auf Bundesebene nicht. Die NDAV macht den
Anschlussnehmer für die Instandhaltung verantwortlich, nach den anerkannten Regeln der Technik, und die
stehen in der TRGI. Deren Abstände kommen nach der rechtlichen Prüfung.

## Formulare

| Formular | Wofür |
| --- | --- |
| `heating_service` | die Wartung eines Wärmeerzeugers |
| `heat_pump_protocol` | die Betriebsprüfung einer Wärmepumpe mit den Punkten aus § 60a Abs. 2 GEG |
| `oil_storage_check` | die Eigenkontrolle der Heizöllagerung |
| `gas_visual_check` | der Augenschein der Gasinstallation |

Die Bescheinigungen des Schornsteinfegers und der Bericht der Sachverständigen sind Berichte und kommen als
Dokument an den Nachweis.

## Mängelklassen

Eine eigene Einteilung des Pakets, ohne Fundstelle:

- **gering:** ohne Einfluss auf Sicherheit und Betrieb;
- **erheblich:** Betrieb, Wirkungsgrad oder Dichtheit beeinträchtigt;
- **gefährlich:** Brand-, Vergiftungs- oder Austrittsgefahr; diese Klasse macht eine Anlage unsicher.

Die AwSV hat eine eigene Einteilung, nach der die Sachverständigen urteilen (§ 47 Abs. 2): ohne Mangel,
geringfügig, erheblich, gefährlich. Ihr Bericht nennt sie.

## Was das Paket nicht abdeckt

- **Einmalige Pflichten** stehen nicht in Paketen, weil der Katalog bisher nur wiederkehrende kennt (#439):
  - die Heizungsprüfung nach § 60b GModG: für eine vor dem 01.10.2009 eingebaute Anlage bis zum 30.09.2027;
  - der hydraulische Abgleich nach § 60c;
  - die erste Betriebsprüfung einer Wärmepumpe mit Fernkontrolle bis 31.12.2026;
  - die Gebäudeautomation nach § 56 bis 31.12.2029;
  - die Erstmessung nach § 14 der 1. BImSchV;
  - die Beratung nach § 4 Abs. 8 der 1. BImSchV;
  - die Erstprüfung einer Heizöllagerung nach § 70 Abs. 2 Nr. 5 AwSV bis 01.08.2027.
- Das Betriebsverbot für alte Heizkessel und die 65-%-Regel sind seit dem 29.07.2026 aus dem Gesetz gestrichen
  (§§ 71 bis 73). Der Anteil an Biomasse oder Wasserstoff für Gas- und Ölheizungen, die nach dem 29.07.2026
  eingebaut werden, gilt ab 2029 (§ 43). Er ist eine Pflicht an den Brennstoff, keine Prüfung.
- Die Mitteilungen an den Bezirksschornsteinfeger nach § 1 Abs. 2 SchfHwG, die Anzeige nach § 40 AwSV und die
  Abgaswege von Einzelraumfeuerstätten.
- Druckbehälter und Dampfkessel der Betriebssicherheitsverordnung: sie kommen mit dem Paket Förderanlagen und
  Arbeitsmittel (#353).
- Was das Landesrecht für Heizungsanlagen in Sonderbauten verlangt, kommt mit #354.

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Die Verantwortung des Betreibers bleibt beim
Betreiber.
