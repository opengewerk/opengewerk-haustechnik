# Änderungsprotokoll

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei festgehalten.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen der [Semantischen Versionierung](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt

- Initiales Repository-Gerüst: README, Lizenz, Vorlagen für Issues und Pull Requests
- Planungskonzept v0.1 unter `docs/konzept/`: Leitentscheidungen, Datenmodell vom Ort bis
  zum Nachweis, Funktionsumfang, Pflichtenpakete, rechtliche Anforderungen mit Fundstellen,
  die am 01.10.2026 gegen die amtlichen Texte geprüft sind, und der Fahrplan in sieben
  Phasen
- CI mit den Prüfungen "Kodierung und Zeilenenden" und "Schreibweise", wie in den anderen
  Repositories der Organisation: UTF-8 ohne BOM, LF, keine Gedankenstriche, keine
  umgeschriebenen Umlaute, geprüft am ganzen Bestand und nicht nur am Diff
- CodeQL, das die zu prüfenden Sprachen aus dem Dateibestand ermittelt, und Dependabot für
  die Actions der Workflows
- Der Arbeitsbereich: das Repository `opengewerk` ist als Git-Submodul unter
  `upstream/opengewerk` eingebunden, auf einem festen Commit, und seine Pakete unter
  `packages/platform/` sind Mitglieder des Arbeitsbereichs (ADR 0010 dort). Compiler-Optionen,
  Lint-Regeln, Testbasis und Formatierung werden aus dem Submodul gelesen und nicht
  abgeschrieben; `pnpm run check:toolchain` vergleicht die Fassungen der Werkzeuge mit denen
  des Fundaments. Das erste eigene Paket ist `@opengewerk/haustechnik-domain`. Ein Import aus
  der Handwerkersoftware am Fundament vorbei scheitert im Lint und an einem Test, der die
  `package.json` des Pakets liest
- CI-Job "Typprüfung, Lint und Tests" über alle Mitglieder des Arbeitsbereichs, die Pakete
  des Fundaments eingeschlossen. Er wird rot, wenn das Submodul auf einen Commit zeigt, der
  nicht auf `main` des Fundaments liegt, oder wenn die Werkzeuge von denen des Fundaments
  abweichen. Dependabot schlägt den neuen Stand des Fundaments wöchentlich vor
- ADR 0001, Derselbe Stack, das Fundament als Submodul: welche Architekturentscheidungen der
  Handwerkersoftware hier gelten, wie das Repository aufgebaut ist, wie die Pakete heißen und
  was diese Anwendung selbst nennt, damit sie neben der Handwerkersoftware auf demselben
  Server laufen kann
- Die Serverseite des Fundaments ist Mitglied des Arbeitsbereichs: `@opengewerk/platform-server`
  mit Datenbankzugriff, Migrationslauf, den Tabellen für Betreiber, Konten, Zugehörigkeiten,
  Audit-Log und Abgleich und den SQL-Bausteinen, aus denen die erste Migration dieser Anwendung
  entsteht. Ihre Tests laufen damit auch hier, in der CI gegen ein PostgreSQL 18 als Dienst und
  lokal gegen eine eigene Testdatenbank aus `docker/compose.test.yaml` auf Port 5434.
  `pnpm run test` richtet jedes Paket auf sie aus, damit die Tests des Fundaments nicht die
  Testdatenbank eines anderen Repositorys leeren, die auf demselben Rechner läuft
- ADR 0002 bis 0006, die Entscheidungen vor der ersten Tabelle: das Datenmodell vom Ort bis
  zum Nachweis mit den Namen im Code, die Zuständigkeitsbereiche in der Datenbank samt einer
  Messung gegen PostgreSQL 18 (eine Policy, die ihre Funktionen direkt aufruft, ist
  zweihundertmal langsamer als dieselbe mit Unterabfragen), der Nachweis mit eingefrorenem
  Stand und Fingerabdruck, die Pakete als Daten mit unveränderlichen Fassungen, und die
  Regeln dafür, was ein Gerät ohne Netz hält, anlegt und ändert
- Der Server dieser Anwendung beginnt mit ihrer Datenbank: das Paket
  `@opengewerk/haustechnik-server` mit dem Schema, der ersten Migration `0000_foundation` samt
  Rücknahme und dem Befehl `migrate`, der Migrationen als Eigentümer der Tabellen einspielt. Die
  Migration legt in einer leeren Datenbank an, was jede Anwendung der Organisation trägt:
  Betreiber, Konten und Sitzungen, Zugehörigkeiten und Einladungen, Rollen, das Audit-Log mit
  Hashkette, die Tabellen des Abgleichs, Nummernkreise, versiegelte Zugangsdaten und den Bereich
  der Instanz. Sie ist aus den Schema-Modulen und SQL-Bausteinen des Fundaments zusammengesetzt
  und nicht abgeschrieben. Die Nummernkreise dieser Anwendung sind `asset` für die Anlagennummer,
  `work_order` für die Nummer eines Auftrags und `evidence` für den Nachweis, der eine Zweck
  versiegelter Zugangsdaten ist `smtp_password`; die Einstellungen mit Gültigkeitszeitraum kommen
  mit der ersten Einstellung (ADR 0001, Nachträge vom 02.10.2026)
- Tests gegen die echte Datenbank, migriert als Eigentümer der Tabellen und nicht als Superuser,
  für den keine Policy gilt. Eine leere Datenbank ist nach dem Lauf bereit, und ein zweiter Lauf
  tut nichts; eine geänderte Migration wird abgelehnt; schlägt eine von mehreren fehl, bleibt die
  Datenbank auf dem Stand davor; die Rücknahme führt zu einer leeren Datenbank. Zwei Betreiber
  bekommen in jeder Tabelle eine Zeile, und geprüft wird je Tabelle, aus dem Katalog der
  Datenbank und nicht aus einer Liste, dass jeder nur seine sieht, keiner dem anderen eine
  schreibt, ändert oder löscht, und dass von innen nichts von dem zu sehen ist, was der Instanz
  gehört. Eine Tabelle, die eine spätere Migration ohne `FORCE`, ohne Policy, ohne Recht, ohne
  Audit-Trigger oder ohne eine Zeile in diesem Test bringt, macht ihn rot. Dazu der Vergleich
  der Datenbank mit den Bausteinen des Fundaments, der anzeigt, wenn das Fundament sich bewegt
  hat und diese Anwendung eine Migration schuldet
- Rechte und Rollen dieser Anwendung. Der Katalog der Rechte steht in `packages/domain`: lesen
  und schreiben für Ort, Anlagen, Pflichten, Vorgänge, Nachweise und Mängel, dazu Zugänge,
  Einstellungen und Änderungsprotokoll, jedes mit einem Schlüssel aus Ding und Tätigkeit und
  einer Bezeichnung in Worten. Wo das Konzept zwei Wörter für dasselbe Ding hat, sind es zwei
  Rechte: Anlagen aufnehmen und pflegen, Vorgänge ausführen, planen und abnehmen, Mängel
  melden und führen. Ein Betreiber beginnt mit den vier Rollen aus Phase 1, Leitung, Technische
  Leitung, Objektleitung und Haustechnik, geschrieben als Zeilen, sobald er entsteht. Die
  Leitung führt den Betreiber und arbeitet nur mit zweitem Faktor; beides sind Angaben der Rolle
  und keine Rechte, und die letzte Leitung lässt sich weder herabstufen noch sperren. Kein
  Recht ändert oder löscht einen Nachweis, ersetzt eine Unterschrift oder überspringt eine
  Abnahme
- Die Schnittstelle des Servers beginnt mit dem, was das Fundament mitbringt: Ersteinrichtung
  mit Einrichtungscode, Einmal-Link, Konto und Geräte, die Verwaltung der Zugänge und der
  Bereich der Instanz, hinter dem Guard und in den Worten dieser Anwendung (Betreiber, Leitung,
  Verwaltung der Instanz). Gestartet wird sie noch nicht, und eine Einladung geht als Link
  hinaus, bis ein Betreiber seinen Mailserver einrichten kann
- Tests dazu: je Rolle, was sie darf und was nicht; die Tabelle in Abschnitt 7 des Konzepts
  gegen den Katalog, sodass ein Recht, das nur an einer der beiden Stellen steht, anders heißt
  oder einer anderen Rolle gehört, den Lauf rot macht; jede Route des Moduls gegen den Guard,
  mit den Routen ohne Anmeldung als Liste, die sich nur mit Absicht verlängert; und gegen die
  echte Datenbank der Weg von der leeren Instanz über die Ersteinrichtung bis zur Anmeldung, bei
  der die Leitung ohne zweiten Faktor nicht weiterkommt
- Die Oberfläche beginnt mit ihrer Hülle (#13, erster Teil): das Paket
  `@opengewerk/haustechnik-web` mit den beiden Einstiegen `/` für das Büro und `/m` für die
  Arbeit vor Ort, mit Tor, Anmeldung, Ersteinrichtung, Einladung, zweitem Faktor, "Konto",
  "Zugänge", dem Bereich der Instanz, der Leiste des Abgleichs und dem Konfliktbildschirm aus dem
  Fundament. Was diese Anwendung dazu sagt, sagt sie in ihren Worten: der Mandant ist der
  Betreiber, wer ihn führt, die Leitung, wer die Instanz betreibt, die Verwaltung der Instanz,
  und die Einstiege heißen "Büro" und "Vor Ort". Name, Symbol und beide Manifeste tragen
  "OpenGewerk Haustechnik"; die Markendateien liegen als die eine erlaubte Kopie unter
  `assets/brand`. Bis die Datensätze aus Phase 1 eigene Listen haben, beginnt das Büro bei den
  Einstellungen und der Einstieg vor Ort bei den Konflikten. Die CI prüft das Bündelbudget je
  Einstieg (gebaut 150 kB vor Ort und 168 kB im Büro, Grenzen 300 und 450 kB) und den Bau auf
  Wörter der Handwerkersoftware für Betreiber, Leitung und den Einstieg vor Ort. Der Einstieg
  vor Ort öffnet auf einem Gerät, das schon angemeldet war, auch ohne Netz
- Der Server startet (#13, zweiter Teil): `pnpm --filter @opengewerk/haustechnik-server run
  start` setzt eine Instanz aus ihrer Konfiguration zusammen, liefert beide Einstiege der
  Oberfläche aus, meldet unter `/health` seine Gesundheit mit der Fassung und zeigt auf einer
  leeren Instanz die Ersteinrichtung mit Einrichtungscode; mit `CLOSED` läuft er, ohne etwas
  herauszugeben. Dazu kommen die Routen des Abgleichs unter `/sync`, die die Leiste des
  Abgleichs fragt, mit den Regeln dieser Anwendung: bis die Datensätze ihre Richtlinien haben
  (#27), reist keiner, und ein Gerät, das trotzdem einen schickt, bekommt die Ablehnung mit dem
  Vorgang genannt
- Das Änderungsprotokoll (#13, dritter Teil): unter den Einstellungen für die Leitung, die es
  nach Abschnitt 7 des Konzepts als einzige einsieht, und im Bereich der Instanz unter
  "Protokoll". Bildschirm und Routen sind die des Fundaments, die Wörter die dieser Anwendung:
  ein Betreiber, seine Einstellungen, die Rolle, die ihn leitet, die Verwaltung der Instanz,
  die Gründe einer Änderung und die Bezeichnungen der Rechte und Rollen. Sie stehen einmal in
  `packages/domain` und gelten für Server und Oberfläche. Eigene Tabellen hat diese Anwendung
  noch nicht; jede, die kommt, braucht dort Namen für sich und jede Spalte, sonst wird ein Test
  rot, der die Wörter gegen den Katalog der Datenbank hält. Dazu Tests, dass nur die Leitung
  das Protokoll liest und die anderen Rollen die Ablehnung mit dem fehlenden Recht in Worten
  bekommen, dass die Prüfung der Kette antwortet und dass die Einstellungen den Eintrag nur dem
  anbieten, der ihn lesen darf, mit Gegenproben
- Der Betrieb über Docker Compose (#15): ein eigenes Abbild, gebaut mit dem Submodul und geprüft
  auf Bündelbudget und Wörter der Handwerkersoftware, die Compose-Datei mit Datenbank,
  Migrationsdienst, Anwendung und Sicherung, und `sh docker/start.sh` als der eine Befehl für
  den ersten Start und jedes Update. Die Skripte dahinter sind die des Fundaments; diese
  Anwendung nennt ihnen ihren Namen, den Anfang ihrer Variablen (`HAUSTECHNIK_`) und eine
  Beispieladresse. Projektname, Port, Datenbank und Volumes sind ihre eigenen, damit sie neben
  einer Installation von OpenGewerk läuft, und die Archive der Sicherung heißen nach ihrer
  Datenbank. Den Renderer bringt #23 mit, weil die Anwendung bis dahin nichts druckt
- Die Befehle für die Kommandozeile: `add-staff`, `reset-password`, `appoint-operator` und
  `add-tenant`, die Befehle des Fundaments mit den Worten und Rollen dieser Anwendung, als
  Rückweg, wenn sich jemand ausgesperrt hat. Ein Passwort kommt verdeckt vom Terminal oder aus
  `HAUSTECHNIK_PASSWORD`, nie aus einem Argument
- Die CI-Läufe "Betrieb über Docker Compose", "Sicherung und Rückspielen" und "Update einer
  laufenden Instanz" mit den Schritten des Fundaments gegen den Stapel dieser Anwendung. Dazu
  meldet sich nach dem Rückspielen ein Konto von vor der Sicherung mit seinem Passwort an, und
  das Update führt von der ersten Migration auf die zweite, mit dem Nummernkreis für Aufträge an
  seiner Stelle. Ein vierter Lauf, "Neben OpenGewerk auf einem Server", startet OpenGewerk aus
  dem Submodul und die Haustechnik daneben: beide antworten auf ihrem Port und mit eigenen
  Volumes, eine Sitzung gilt nur bei ihrer Anwendung, ihr Cookie nennt keine Domain und gilt
  damit nur unter dem Hostnamen, von dem es kam, und die Haustechnik lässt sich samt Volumes
  entfernen, ohne dass sich an OpenGewerk etwas ändert

- Zuständigkeitsbereiche in der Datenbank (#17, ADR 0003): ein Betreiber bündelt seine
  Liegenschaften in Bereichen, eine Zugehörigkeit gilt für alle Bereiche oder für genannte, und
  eine Vertretung gibt jemandem an ihren Tagen die Bereiche einer anderen Person dazu. Was eine
  Person sieht, liest die Datenbank selbst aus diesen Tabellen, mit zwei Funktionen, die die
  Policy jeder Tabelle mit Ort als Unterabfrage fragt; die Anwendung gibt keine Liste von
  Bereichen weiter, und eine Route, die sich irrt, kann nichts aufweiten. Eine Transaktion ohne
  Person sieht keine Zeile mit Ort, ein Lauf im Hintergrund sagt ausdrücklich, dass er alle
  Bereiche braucht. Ein neuer Betreiber bekommt mit seiner ersten Zugehörigkeit den Bereich
  "Alle Liegenschaften" und merkt sonst nichts davon; Leitung und Technische Leitung sehen von
  Haus aus alle Bereiche, die anderen den einen, und wer schon vor dem Update bei einem
  Betreiber arbeitete, bekommt dieselbe Vorgabe. Noch hat keine Tabelle einen Ort, die
  Liegenschaften kommen mit #18 und bringen die Policy aus dem Baustein mit. Geprüft ist die
  Grenze an Tabellen, die der Test nach demselben Baustein anlegt: Lesen, Ändern und Löschen je
  Tabelle, ein Verweis auf einen Ort eines anderen Bereichs, das Verlegen einer Liegenschaft, das
  jede Zeile darunter mitnimmt, und die Vertretung an ihren Tagen. Ein Katalogtest wird rot,
  sobald eine Tabelle mit Ort einen Teil der Grenze vergisst oder ihre Policy die Funktionen
  direkt aufruft, was beim Zählen von 6000 Anlagen 54.160 statt 169 Puffer kostet
- Der Ort (#18, ADR 0002): Liegenschaft mit Anschrift, Bundesland und Bereich, Gebäude mit
  Kürzel, Gebäudearten und Baujahr, Geschoss mit Ebene, Raum mit Nummer, Bezeichnung und
  Nutzung, in den Tabellen `properties`, `buildings`, `floors` und `rooms`. Jede Ebene trägt
  die Kennungen der Ebenen darüber, und zusammengesetzte Schlüssel lassen einen Raum nur auf
  einem Geschoss seines Gebäudes stehen und ein Gebäude nur auf seiner Liegenschaft. Jede
  Zeile trägt den Bereich ihrer Liegenschaft, die Policy aus dem Baustein der Bereiche und die
  Spalten des Abgleichs; verlegt die Leitung eine Liegenschaft in einen anderen Bereich, zieht
  jede Zeile darunter mit. Gelöscht wird durch Markieren, und was darunter hängt, wird im selben
  Augenblick mitmarkiert. Ein Gebäude hat eine Gebäudeart oder mehrere, aus den Sonderbauten
  des § 38 Abs. 2 LBO Baden-Württemberg, dazu Wohngebäude, Garage, Außenanlage und Sonstiges:
  eine Schule mit Aula ist auch Versammlungsstätte. Die Routen unter `/properties`,
  `/buildings`, `/floors` und `/rooms` legen an, ändern, verlegen einen Raum und löschen, mit
  den Rechten aus Abschnitt 7 des Konzepts: Räume nimmt auf, wer vor Ort arbeitet, die
  Struktur pflegen Leitung und Technische Leitung. Dieselben Prüfungen stehen in `domain` und
  in der Datenbank, und der Compiler hält die Typen der Zeilen gegen das Modell. Die Flächen
  kommen nach dem Fahrplan des Konzepts in Phase 3, die Bildschirme in Phase 1, und auf ein
  Gerät reisen die Orte erst mit den Regeln des Abgleichs (#27)
- Das Paketformat (#19, ADR 0005): der Katalog aus Anlagenarten, Pflichtarten, Regeln,
  Formularen und Vorlagen steht als JSON unter `pakete/<name>/`, jede Fassung einer Anlagenart,
  Pflichtart, eines Formulars oder einer Vorlage in einer eigenen Datei, und `abnahmen.json`
  nennt je Fassung und je Regel den Tag der letzten Prüfung gegen die Quelle und, wo es sie
  gibt, die Abnahme mit Person, Tag und Prüfsumme. Das neue Paket
  `@opengewerk/haustechnik-catalogue` liest den Ordner beim Bau, prüft jede Datei gegen ihr
  Schema und die Pakete gegeneinander und schreibt das Bündel, das Server und Oberfläche laden
  werden; ein Fehler hält den Bau an und nennt Datei, Feld und Grund. Rot wird es unter anderem
  bei einer Pflichtart ohne Fundstelle, einer Frist ohne Regel, einer Lücke mitten in einer
  Reihe von Regeln, einem Verweis ohne Ziel, einer Frist aus einer privaten Norm ohne den
  Vermerk der rechtlichen Prüfung und einer Abnahme, deren Prüfsumme nicht passt. In einem Pull
  Request vergleicht die CI jede Fassung, die es auf `main` gibt, Byte für Byte, denn eine
  bestätigte Pflicht muss morgen auf dieselbe Fassung zeigen können. In `domain` beantwortet
  `catalogueOf` die Fragen an den Katalog, jede mit einem Tag: welche Fassung gilt, welche Regel
  der Frist, und für einen Tag vor dem Beginn einer Regel keine. Jeder Eintrag kommt dort nur
  mit seiner Prüfung und Abnahme heraus, sodass ein Eintrag ohne Abnahme überall als solcher
  erkennbar ist. Ein Probepaket mit der Hauptprüfung einer Aufzugsanlage nach der BetrSichV
  liegt als Material bei den Tests und als Vorbild für einen Beitrag, beschrieben in
  `pakete/README.md`. Die Inhalte der Pakete kommen in Phase 1
- Die Technik (#20, ADR 0002): eine Anlage steht in genau einem Gebäude und auf Wunsch in
  einem seiner Räume, hat eine Anlagenart aus dem Katalog der Pakete und dazu Hersteller,
  Typ, Seriennummer, Baujahr, Inbetriebnahme, Gewährleistungsende und das Kennzeichen des
  Betreibers. Eine Komponente ist eine Anlage unter einer Anlage im selben Gebäude, beliebig
  tief; dass keine unter sich selbst hängt, prüft die Datenbank, und zieht die Anlage in ein
  anderes Gebäude, kommen ihre Komponenten mit. Auf ihrer Liegenschaft bleibt eine Anlage,
  denn auf einer anderen gälten andere Pflichten. Die Werte der Merkmale und Felder einer
  Anlagenart stehen an der Anlage und werden gegen die Art geprüft. Eine Messstelle ist eine
  Anlagenart, deren Paket Medium und Einheiten nennt, und ihre Anlage trägt Zählernummer und
  Einheit. Der Lebenszyklus ist eine Liste von Zuständen ab einem Tag, einer je Tag; der
  Zustand an einem Tag wird daraus gerechnet und nie gespeichert, mit Eigenschaftstests über
  beliebige Einträge und Tage. Die Anlagennummer kommt aus dem Nummernkreis `asset`,
  `AN-00001` aufwärts, und wird nach dem Löschen nicht neu vergeben, damit ein Etikett nie auf
  eine andere Anlage zeigt. Was eine Anlage versorgt, ohne dort zu stehen, ist eine Liste von
  Gebäuden und Räumen ihrer Liegenschaft. Die Routen unter `/assets` und
  `POST /buildings/:id/assets` legen an, ändern, verlegen, hängen um, führen den Lebenszyklus
  und löschen, mit den Rechten aus Abschnitt 7: aufnehmen darf, wer vor Ort arbeitet,
  pflegen die Objektleitung und darüber. Ein Raum, in dem eine Anlage steht, zieht seitdem nur
  innerhalb seines Gebäudes um, einer, den eine Anlage versorgt, nur innerhalb seiner
  Liegenschaft, weil die Schlüssel jede Zeile halten, die ihn nennt. Das Probepaket hat einen
  Wasserzähler bekommen, und der Bau gibt es unter `@opengewerk/haustechnik-catalogue/testing`
  für die Tests des Servers aus. Eigene Anlagenarten des Betreibers haben im Fahrplan noch
  keine Phase (#52); die Stände der Zähler und die Bildschirme kommen in Phase 1, und auf ein
  Gerät reisen die Anlagen mit den Regeln des Abgleichs (#27)
- Wie der nächste Termin einer Pflicht gezählt wird, sagt ihre Pflichtart (#25): ab dem Tag der
  Durchführung, ab dem fälligen Tag oder nach § 14 Abs. 5 BetrSichV, wo der Termin ein Monat mit
  Jahr ist und eine Prüfung noch zwei Monate danach fristgerecht. Der Bau eines Pakets verlangt die
  Angabe und lehnt für die BetrSichV eine Frist in Tagen ab. Der nächste Termin aus den Tagen, an
  denen die Pflicht erfüllt wurde, und der Zustand einer Pflicht an einem Tag (nie erfasst, ruht,
  überfällig, fällig, erfüllt bis) sind reine Funktionen in `packages/domain`, mit
  Eigenschaftstests über beliebige Tage; eine nicht bestandene oder nicht durchgeführte Prüfung
  zählt nicht. Das Bündel des Katalogs hat damit das Format 2

### Geändert

- Planungskonzept auf v0.2: die Entscheidungen vom 01.10.2026 stehen an ihren Stellen, und
  Abschnitt 15 nennt sie im Zusammenhang. Das Fundament kommt als Pakete aus dem Repository
  `opengewerk` und wird nicht abgeschrieben; die Zuständigkeitsbereiche erzwingt die
  Datenbank; alle sieben Pflichtenpakete erscheinen vollständig vor Version 1, zuerst mit
  dem, was staatliches Recht hergibt; eigene Rollen kommen in Phase 2. Lager und
  Auswertungen rücken im Fahrplan nach Phase 2, weil der Pilotbetrieb sie braucht, bevor er
  seine bisherige Anwendung abschaltet
- Planungskonzept auf v0.3: die Technik, mit der das Fundament eingebunden wird, ist
  entschieden (Git-Submodul auf einem festen Commit) und steht nicht mehr unter den offenen
  Punkten; die Anlässe der Benachrichtigungen stehen in der Zuordnung bei Phase 0
- Die Prüfungen "Kodierung und Zeilenenden" und "Schreibweise" überspringen den Eintrag
  eines Submoduls. Seine Dateien werden in dem Repository geprüft, zu dem sie gehören
- Planungskonzept auf v0.4: Abschnitt 5 nennt `abnahmen.json`, in der Prüfung und Abnahme
  eines Katalogeintrags neben ihm stehen, und sagt, dass Regeln fortgeschrieben und berichtigt
  statt neu gefasst werden (ADR 0005). Wer eine Instanz betreibt, heißt durchgehend
  "Verwaltung der Instanz", damit "Betreiber" in der Oberfläche nur eines bedeutet
- Das Fundament ist auf den Stand mit der Anmeldung angehoben (`opengewerk/opengewerk#473`,
  `#475` und `#476`). Der Guard vor jeder Route mit Herkunftsprüfung und Sicherheits-Headern,
  Konten mit Passwort, zweitem Faktor und Passkeys, Sitzungen je Gerät, die Ersteinrichtung
  mit Einrichtungscode, der Einmal-Link und die Verwaltung der Zugänge liegen damit in
  `@opengewerk/platform-server` und kommen von dort, statt hier ein zweites Mal zu entstehen.
  Wie ein Mandant und seine Rollen in dieser Anwendung heißen, sagt sie dem Fundament selbst;
  gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen in der CI dieses
  Repositorys mit, 328 statt 154
- Das Fundament ist auf den Stand mit den Rollen als Zeilen angehoben
  (`opengewerk/opengewerk#477` und `#479`). Was jemand bei einem Betreiber darf, steht damit in
  Zeilen des Betreibers (`tenant_roles`): je Rolle der Schlüssel, die Bezeichnung, die Rechte
  und zwei Angaben, ob sie den Betreiber führt und ob sie einen zweiten Faktor verlangt. Die
  Rechte dieser Anwendung werden ihr eigener Katalog, ihre Rollen die Zeilen, mit denen ein
  Betreiber beginnt; eigene Rollen eines Betreibers, wie Phase 2 sie vorsieht, sind dann
  weitere Zeilen und kein neuer Mechanismus. Die Oberfläche bekommt die Rechte je Betreiber vom
  Server und hält keine eigene Liste, was eine Rolle darf. Gebaut ist davon hier noch nichts.
  Die Tests des Fundaments dazu laufen in der CI dieses Repositorys mit, 351 statt 328
- Das Fundament ist auf den Stand mit Zugangsdaten, Nummernkreisen und dem Bereich der Instanz
  angehoben (`opengewerk/opengewerk#480` und `#481`). Versiegelte Zugangsdaten, Einstellungen
  mit Gültigkeitszeitraum und Nummernkreise sind damit Tabellen des Fundaments, die eine
  Anwendung mit ihren eigenen Listen anlegt: welche Zwecke, welche Einstellungen und welche
  Kreise es gibt, nennt diese Anwendung, den Mechanismus dahinter schreibt sie nicht noch
  einmal. Dazu kommt der Bereich der Instanz: wer sie verwaltet, ihre Einstellungen, ihr
  Protokoll, die Liste der Betreiber und der Weg zu einem weiteren Betreiber, samt den Befehlen
  `appoint-operator` und `add-tenant`. Jeden Satz, der dabei einen Betreiber, seine Leitung oder
  die Verwaltung der Instanz nennt, gibt diese Anwendung dem Fundament mit, damit er hier so
  heißt wie im Konzept. Gebaut ist davon hier noch nichts. Die Tests des Fundaments dazu laufen
  in der CI dieses Repositorys mit, 432 statt 351
- Das Fundament ist auf den Stand mit seiner Oberfläche angehoben (`opengewerk/opengewerk#482`
  bis `#497`). `@opengewerk/platform-web` ist damit Mitglied des Arbeitsbereichs: Tokens und
  Bausteine der Bildschirme, der Abgleich auf dem Gerät, die Sitzung, das Tor vor der Anmeldung,
  die Hülle der beiden Einstiege, "Konto", die Zugänge und der Bereich der Instanz, Kamera, Scan
  und Unterschrift, der Konfliktbildschirm, Service Worker und Manifeste und die Prüfungen der CI
  als Werkzeug. Wie diese Anwendung heißt und was sie dazu sagt, gibt sie dem Fundament einmal
  als Wert mit, wenn ihre Oberfläche entsteht (#13); gebaut ist davon hier noch nichts. Dazu
  heißt der Kopf, in dem eine Seite ihren Betreiber nennt, jetzt `x-opengewerk-tenant`, und die
  Pfade, die der Server des Fundaments selbst beantwortet, stehen als `foundationPaths` in
  `platform-domain`. Die Tests des Fundaments laufen in der CI dieses Repositorys mit: 95 in
  `platform-domain`, 437 in `platform-server` und 693 in `platform-web`
- Das Fundament ist auf den Stand mit seinem Betrieb angehoben (`opengewerk/opengewerk#498` bis
  `#500`, #14). Der Einstieg des Servers liegt damit in `@opengewerk/platform-server`: die
  Gesundheitsprüfung unter `/health`, das Ausliefern der Oberfläche, der Server mit allem, was
  vor den Routen steht, das Herunterfahren in fester Reihenfolge und die Zeile beim Start.
  Einrichten, Starten und Sichern sind Skripte des Fundaments, die den Namen einer Anwendung und
  den Anfang ihrer Variablen aus ihrer `application.env` lesen, und die drei CI-Läufe auf einem
  ganzen Stapel sind Schritte, die eine Anwendung mit ihrem Material füllt. Benutzt wird davon
  hier noch nichts, das kommt mit dem eigenen Betrieb (#15). Dem Fundament sagt diese Anwendung
  dafür einen Satz mehr, den das Protokoll beim Start einer leeren Instanz schreibt: dass die
  Ersteinrichtung im Browser den Betreiber und den ersten Zugang anlegt. Die Tests des
  Fundaments laufen in der CI dieses Repositorys mit, in `platform-server` jetzt 479 statt 437
- Das Fundament ist auf den Stand mit dem Abgleich auf dem Server angehoben
  (`opengewerk/opengewerk#501` und `#502`, #21). Das Anwenden der Vorgänge eines Geräts, die
  Konflikte und der Abruf nach der Änderungsnummer liegen damit in
  `@opengewerk/platform-server`, ebenso die Routen unter `/sync`, denen eine Anwendung das Recht
  je Vorgang, ihre Worte für eine Ablehnung der Datenbank und die Auswahl je Gerät mitgibt. Hier
  gebunden werden die Routen mit der Leiste des Abgleichs (#13), die Richtlinien je Entität und
  die Auswahl nach Bereich mit #27. Die Tests des Fundaments laufen in der CI dieses Repositorys
  mit, in `platform-server` jetzt 526 statt 479
- Das Fundament ist auf den Stand mit den neuesten Fassungen seiner Werkzeuge angehoben
  (`opengewerk/opengewerk#503`): `vite` 8.3.2, `vitest` 5.0.3, `@tanstack/react-router`
  1.170.41, `@tanstack/react-query` 5.104.0 und `lucide-react` 1.49.0. Die Oberfläche dieser
  Anwendung beginnt damit auf der neuesten Fassung, und `vitest` steht hier wie dort auf 5.0.3.
  `@opengewerk/haustechnik-domain` sagt jetzt, dass das Laden eines Moduls nichts tut
  (`sideEffects: false`), damit der Service Worker nur die eine Liste mitnimmt, die er braucht
- Das Fundament ist auf den Stand mit dem Änderungsprotokoll angehoben
  (`opengewerk/opengewerk#504` und `#505`, #22). Das Lesen einer Seite von Änderungen, die
  Prüfung der Hashkette und die Liste der Personen unter `/audit` liegen damit in
  `@opengewerk/platform-server`, der Bildschirm "Änderungsprotokoll", der Knopf "Änderungen" an
  einem Datensatz und das Protokoll der Instanz in `@opengewerk/platform-web`. Was eine
  Anwendung dazu sagt, gibt sie als Vokabular mit: wie ihre Tabellen und Spalten heißen, welche
  Teile das Protokoll eines Datensatzes mitnimmt, woran ein Datensatz zu erkennen ist, und die
  Wörter, die das Fundament für seine eigenen Tabellen und Gründe von ihr braucht. Ein
  Baukasten (`auditVocabularyGaps`) hält das Vokabular gegen den Katalog der Datenbank; dass er
  Wörter für die Einstellungen eines Betreibers meldete, eine Tabelle, die diese Anwendung erst
  mit ihrer ersten Einstellung anlegt, ist im Fundament berichtigt (`#505`). Die Tests des
  Fundaments laufen in der CI dieses Repositorys mit: 112 in `platform-domain`, 552 in
  `platform-server` (vorher 526) und 728 in `platform-web`
- Das Fundament ist auf den Stand mit dem Geltungsbereich der Regel-Engine angehoben
  (`opengewerk/opengewerk#506`, #16). Eine Regel gilt bundesweit oder in einem Land, und eine
  Abfrage nennt neben dem Tag auf Wunsch das Land: eine Regel für Baden-Württemberg ist für
  Bayern keine Antwort, eine bundesweite gilt in jedem Land. Gilt ein Schlüssel am selben Tag
  bundesweit und in einem Land, lehnt der Aufbau das Paket ab, weil jede Antwort geraten wäre.
  Dazu kommen die Einheiten, die Pflichten eines Gebäudes brauchen (Monate, Zehntelgrad Celsius,
  Kilowatt, Kilogramm und Tonnen CO₂-Äquivalent, Anzahl je 100 ml), und die Prüfung auf Lücken je
  Schlüssel und Geltungsbereich (`ruleHoles`). Benutzt wird davon hier noch nichts, das kommt mit
  den Pflichtenpaketen. Die Tests des Fundaments laufen in der CI dieses Repositorys mit, in
  `platform-domain` jetzt 130 statt 112
- Das Fundament ist auf den Stand mit Dateispeicher, Renderer, E-Mail und Push angehoben
  (`opengewerk/opengewerk#507` bis `#512`, #23). Die Ablage von Dateien nach ihrem SHA-256, der
  Stand der nächtlichen Sicherung, der Druck über den Renderer, der Mailserver eines Mandanten mit
  Postausgang und Job, Push und der Weg vom Anlass zur Nachricht liegen damit in
  `@opengewerk/platform-server`. Zwei Tabellen davon trägt das Fundament selbst, die Dateien eines
  Betreibers und seinen Mailserver; die Migration `0005_files_and_mail_settings` legt sie an, wie
  die Bausteine des Fundaments sie beschreiben, und die Prüfung von Sicherung und Rückspielen zählt
  beide mit und findet eine Datei im Speicher. Gebunden wird davon hier noch nichts: der
  Dateispeicher kommt mit den Dokumenten, der Renderer mit dem ersten PDF, Mailserver, Postausgang
  und Push mit den Benachrichtigungen, alle in Phase 1 und jeweils mit ihren Rechten und ihren
  Tafeln; bis dahin geht eine Einladung als Link hinaus. Die Tests des Fundaments laufen in der CI
  dieses Repositorys mit, in `platform-domain` jetzt 137 statt 130 und in `platform-server` 740
  statt 552
- Das Fundament ist auf den Stand mit der Fristen-Engine angehoben (`opengewerk/opengewerk#513`
  bis `#516`, #24). Fristart und Frist in Tagen oder Monaten, der Lauf, der die Fristen mit ihren
  Quellen abgleicht und je Fälligkeit genau einmal erinnert, die Routen unter `/deadlines` und die
  Bildschirme "Fristen" liegen damit im Fundament, dazu `GET /deadlines/run`, über das ein Lauf,
  der nicht stattgefunden hat, im Büro sichtbar wird. Zwei Tabellen davon trägt das Fundament
  selbst, was ein Betreiber für eine Fristart einstellt und wann der Lauf ihn zuletzt durchging;
  die Migration `0006_deadlines` legt sie an, wie die Bausteine des Fundaments sie beschreiben, und
  die Prüfung von Sicherung und Rückspielen zählt beide mit einer ersten Zeile. Das
  Änderungsprotokoll sieht die Läufe nicht, die Liste dafür übernimmt `audit.test.ts` jetzt vom
  Fundament, statt sie auszuschreiben. Gebunden wird die Engine hier mit den Pflichten (#25), deren
  Fristen Liegenschaft und Bereich tragen. Die Tests des Fundaments laufen in der CI dieses
  Repositorys mit, in `platform-domain` jetzt 160 statt 137 und in `platform-server` 774 statt 740
- `pnpm run check:toolchain` vergleicht auch die Fassungen der Abhängigkeiten, die ein Paket
  dieser Anwendung und ein Paket des Fundaments beide laden, zuerst `drizzle-orm` und `pg`. Zwei
  Fassungen davon in einem Prozess hießen Tabellen, die mit der einen angelegt und mit der
  anderen abgefragt werden; die Prüfung wird rot, sobald das Fundament eine Fassung hebt und die
  Anwendung nicht folgt
- Planungskonzept auf v0.6: Abschnitt 7 nennt die Rechte für den Abgleich, "Daten abgleichen"
  und "Änderungen senden". Alle vier Rollen haben beide, weil der Abgleich ein anderer Weg
  hinein ist und kein eigenes Tun: was ein Gerät sendet, entscheiden die übrigen Rechte Vorgang
  für Vorgang. Katalog und Rollen in `packages/domain` haben sie ebenso
- Planungskonzept auf v0.5: Abschnitt 7 nennt für die vier Rollen aus Phase 1 jedes Recht
  einzeln, in den Worten, die ein Betreiber liest, wenn ihm eines fehlt. Zugänge, Einstellungen
  und Änderungsprotokoll hat nur die Leitung; die Struktur der Liegenschaften, das
  Pflichtenverzeichnis und die Fristen pflegen Leitung und Technische Leitung; die
  Objektleitung plant, verteilt und nimmt ab und pflegt die Anlagen ihrer Bereiche. ADR 0002
  nennt im Nachtrag die Namen für den Ort, die Rechte und die Rollen im Code

### Behoben

- Der Nummernkreis für Aufträge fehlte in der Ausgangsmigration. Das Konzept nennt für das
  Fundament drei Kreise, für Anlagen, Nachweise und Aufträge (Abschnitt 12, Phase 0; Abschnitt
  4.8; ADR 0002, Punkt 13); angelegt waren zwei. Die Migration `0001_work_order_numbers` trägt
  den dritten nach, an seiner Stelle zwischen Anlage und Nachweis, mit Rücknahme. Eine gemergte
  Migration wird nicht geändert, deshalb eine zweite. Dazu die ersten Tests für ein Update: eine
  Datenbank auf dem Stand der ersten Migration, mit Zählern eines Betreibers, bekommt den Kreis
  und behält ihre Zähler; die Rücknahme entfernt nur den Zähler der Aufträge und schreibt den
  Grund in das Protokoll des Betreibers
- Die README nannte für die Tests eines einzelnen Pakets den Aufruf
  `pnpm run test -- --filter=<paket>`. pnpm reicht das `--` mit weiter, der Filter landet dann
  beim Testläufer jedes Pakets, und der kennt ihn nicht. Richtig ist
  `pnpm run test --filter=<paket>`
