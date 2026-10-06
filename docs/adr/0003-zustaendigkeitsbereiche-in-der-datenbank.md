---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidung 8, Abschnitte 2.7, 2.8 und 7; ADR 0002; ADR 0003 und 0006 im Repository `opengewerk`; Versuch gegen PostgreSQL 18 vom 01.10.2026
informed: Mitwirkende der Organisation opengewerk
---

# Zuständigkeitsbereiche in der Datenbank

## Kontext und Problemstellung

Innerhalb eines Betreibers gibt es Bereiche (Leitentscheidung 8): wer für die Liegenschaften im Norden zuständig ist, sieht und bearbeitet die im Süden nicht, und sein Gerät hält sie nicht. Ein Bereich bündelt Liegenschaften, eine Zugehörigkeit gilt für alle Bereiche oder für genannte, und befristet übernimmt jemand die Bereiche einer anderen Person (Abschnitt 2.8).

Am 01.10.2026 ist entschieden worden, dass die Datenbank das durchsetzt und nicht jede einzelne Abfrage: eine Zeile mit Ortsbezug trägt ihren Bereich, und eine Policy lässt nur die Bereiche der Anfrage durch. Offen ist das Wie:

1. Woher weiß eine Zeile ihren Bereich, und wie bleibt er richtig, wenn eine Liegenschaft den Bereich wechselt?
2. Woher weiß die Datenbank, welche Bereiche eine Anfrage sehen darf?
3. Was kostet die Policy?
4. Was sieht ein Hintergrundlauf, der für keinen Menschen arbeitet?

## Entscheidungstreiber

- Ein Fehler muss in die sichere Richtung fallen: eine vergessene Bedingung, ein vergessener Aufruf oder eine fehlende Angabe zeigt weniger Zeilen und nie mehr.
- Die Trennung der Betreiber aus dem Fundament bleibt, wie sie ist. Der Bereich kommt als zweite Grenze dazu und weicht die erste nicht auf.
- Eine Route kann die Bereiche einer Anfrage nicht aufweiten, auch nicht durch einen Fehler.
- Eine neue Tabelle mit Ortsbezug, der die Grenze fehlt, fällt in der CI auf und nicht bei einem Betreiber.
- Ein kleiner Betreiber mit einem einzigen Bereich merkt von alledem nichts.

## Betrachtete Optionen

Für den Bereich an der Zeile:

**A: Eine Spalte, von einem Trigger geführt.** Jede Zeile mit Ortsbezug trägt `area_id`; ein Trigger setzt sie beim Schreiben aus der Liegenschaft, ein zweiter zieht sie nach, wenn die Liegenschaft den Bereich wechselt.

**B: Eine Spalte, von einem Fremdschlüssel geführt.** Jede Zeile trägt `property_id` und `area_id`, und ein zusammengesetzter Fremdschlüssel auf die Liegenschaft mit `ON UPDATE CASCADE` hält beide zusammen.

**C: Keine Spalte.** Die Policy schlägt den Bereich bei jedem Lesen über die Liegenschaft nach.

Für die Bereiche einer Anfrage:

**a: Die Anwendung setzt sie** als Einstellung der Transaktion, wie den Mandanten.

**b: Die Datenbank leitet sie her**, aus der Person der Transaktion und den Tabellen der Zugehörigkeit.

## Entscheidung

Gewählt wurden **B** und **b**.

**Die Tabellen**

1. `areas`: die Bereiche eines Betreibers. Ein neuer Betreiber bekommt einen, und jede Liegenschaft nennt genau einen.

2. Eine Zugehörigkeit gilt für alle Bereiche (`all_areas` an der Zugehörigkeit) oder für die in `member_areas` genannten. Welche Rollen von Haus aus alle Bereiche sehen, ist eine Vorgabe beim Anlegen und keine Regel der Datenbank: die Leitung und die Technische Leitung alle, Objektleitung und Haustechnik ihre.

3. `substitutions`: wer wen von wann bis wann vertritt. Wer vertritt, sieht in dieser Zeit zusätzlich die Bereiche der vertretenen Person.

**Der Bereich an der Zeile**

4. Jede Tabelle mit Ortsbezug trägt `property_id` und `area_id`, und der Fremdschlüssel

   ```sql
   FOREIGN KEY (tenant_id, property_id, area_id)
     REFERENCES properties (tenant_id, id, area_id) ON UPDATE CASCADE
   ```

   macht daraus eine Eigenschaft der Daten: der Bereich einer Zeile ist immer der ihrer Liegenschaft. Wechselt eine Liegenschaft den Bereich, zieht die Datenbank jede Zeile darunter mit, in derselben Anweisung und ohne einen Trigger, den jemand für eine neue Tabelle vergessen könnte.

5. Dass die genannte Liegenschaft die richtige ist, halten die Schlüssel aus ADR 0002: ein Gebäude nennt seine Liegenschaft, ein Raum sein Gebäude mit dessen Liegenschaft, eine Anlage ihr Gebäude mit dessen Liegenschaft. Eine Zeile kann sich so keinen Bereich aussuchen: wer den eigenen Bereich an ein Gebäude eines fremden schreibt, scheitert am Schlüssel.

6. Betreiberweit und ohne Bereich bleiben, was keinen Ort hat: Katalog, Fremdfirmen, Lager, Schließanlagen, Einstellungen, die Bereiche selbst.

**Die Policy**

7. Jede Tabelle mit Ortsbezug bekommt zur Policy des Mandanten eine zweite, **restriktive**: `within_areas`. Restriktive Policies verknüpft PostgreSQL mit UND, permissive mit ODER; keine andere Policy kann sie also aufweiten.

8. Was eine Anfrage sieht, sagen zwei Funktionen der Datenbank, und sie lesen dieselben zwei Einstellungen, die das Fundament für jede Transaktion setzt, den Mandanten und die Person:

   - `session_sees_all_areas()`: die Zugehörigkeit der Person gilt für alle Bereiche, oder die Transaktion ist ausdrücklich ein Hintergrundlauf.
   - `session_areas()`: die Bereiche der Person, dazu die der Personen, die sie heute vertritt.

   Die Anwendung setzt keine Liste von Bereichen. Eine Route, die sich irrt, kann deshalb nichts aufweiten: die Datenbank fragt ihre eigenen Tabellen.

9. **Die Policy ruft die Funktionen als Unterabfrage auf**:

   ```sql
   USING ((SELECT session_sees_all_areas())
          OR area_id = ANY ((SELECT session_areas())::uuid[]))
   ```

   Das ist keine Stilfrage. Direkt aufgerufen wertet PostgreSQL beide Funktionen für jede Zeile aus, auch wenn sie als `STABLE` erklärt sind; als Unterabfrage laufen sie einmal je Anweisung. Gemessen am 01.10.2026 mit zwei Betreibern, je 4 Bereichen, 20 Liegenschaften, 60 Gebäuden und 6000 Anlagen:

   | Abfrage | ohne Bereichs-Policy | Funktionen direkt | als Unterabfrage |
   | --- | --- | --- | --- |
   | 100 Anlagen eines Gebäudes, sortiert | 0,14 ms | 2,4 ms | 0,21 ms |
   | Zählen aller Anlagen des Betreibers | 0,64 ms | 142 ms | 0,73 ms |

   Die Policy kostet richtig geschrieben rund eine Zehntelmillisekunde je Anweisung und falsch geschrieben das Zweihundertfache, und kein Test, der Ergebnisse vergleicht, sieht den Unterschied. Sie entsteht deshalb aus einem Baustein, und ein Katalogtest liest den Ausdruck jeder Bereichs-Policy und lehnt einen direkten Aufruf ab.

10. **Kein Benutzer heißt: keine Zeile.** Eine Transaktion ohne Person sieht in den Tabellen mit Ortsbezug nichts. Ein Hintergrundlauf, der für keinen Menschen arbeitet (Fristen, Erinnerungen, Sicherung des Stands), sagt ausdrücklich, dass er alle Bereiche braucht, über eine eigene Einstellung der Transaktion, die nur der Datenbankzugriff für Hintergrundläufe setzt und keine Route.

**Schreiben**

11. `WITH CHECK` gilt wie `USING`: wer eine Liegenschaft in einen Bereich verlegen will, den er nicht hat, wird abgelehnt, und wer nur den alten Bereich hat, kann sie nicht aus seinem Blick hinaus verlegen. Verlegen ist Sache derer, die alle Bereiche sehen.

12. Die Kaskade des Fremdschlüssels läuft an der Row-Level Security vorbei, wie jede Prüfung eines Fremdschlüssels. Das ist hier gewollt: wer die Liegenschaft verlegen darf, verlegt alles darunter, auch Zeilen, die er aus anderen Gründen nicht ändern dürfte.

**Das Gerät**

13. Welche Zeilen ein Gerät hält, folgt aus denselben zwei Funktionen (ADR 0006). Ändern sich die Bereiche einer Person, lässt ihr Gerät fallen, was es nicht mehr halten darf.

### Konsequenzen

Gut:

- Eine vergessene Bedingung in einer Abfrage zeigt nichts, was die Person nicht sehen darf. Das gilt für jede Route, jeden Export und jede Auswertung, die noch niemand geschrieben hat.
- Der Bereich einer Zeile kann nicht von dem ihrer Liegenschaft abweichen, auch nicht für einen Augenblick.
- Die Vertretung braucht keine Kopie von Zuordnungen und kein Aufräumen danach: sie wirkt an dem Tag, an dem sie gilt, und danach nicht mehr.
- Der Katalogtest der Mandantentrennung aus dem Fundament bekommt eine zweite Hälfte: jede Tabelle mit `property_id` hat `area_id`, den Schlüssel und die Policy.

Schlecht:

- Zwei Spalten mehr an jeder Tabelle mit Ortsbezug, und an Zeilen, die an einem von mehreren Bezügen hängen, ein Schlüssel je Bezug, der die Liegenschaft mitführt.
- Eine Liegenschaft mit vielen Zeilen zu verlegen ist eine große Anweisung. Sie ist selten und läuft im Büro.
- Die Datenbank liest für jede Anweisung an einer Tabelle mit Ortsbezug die Zugehörigkeit der Person. Das ist die Zehntelmillisekunde aus der Messung.
- Wer in einer Auswertung über alle Bereiche zählen will und nicht alle sehen darf, bekommt die Zahl seiner Bereiche. Das ist die Entscheidung und kein Fehler, muss aber an der Oberfläche gesagt werden, wo eine Zahl nach "alle" aussieht.
- Der Tag einer Vertretung ist der Tag der Datenbank. Eine Vertretung, die um Mitternacht endet, endet um Mitternacht in deren Zeitzone.

Nachträge:

- **Nachtrag vom 03.10.2026, gebaut mit `#17`.** Die Migration `0002_areas` legt Bereiche, Zugehörigkeit zu allen oder zu genannten Bereichen und Vertretung an, dazu die zwei Funktionen aus Punkt 8, als Aufrufer und `STABLE`. An sechs Stellen sagt der Bau mehr als diese Entscheidung oder weicht von ihr ab:

  1. Wer alle Bereiche sieht, steht nicht als Spalte `all_areas` an der Zugehörigkeit (Punkt 2), sondern als Zeile einer eigenen Tabelle `member_all_areas`. `memberships` ist eine Tabelle des Fundaments: eine Spalte dieser Anwendung daran wäre eine Abweichung von seinen Bausteinen, die jeder Vergleich meldet (ADR 0010 im Repository `opengewerk`), und das Vokabular des Änderungsprotokolls könnte sie nicht benennen, weil eine Anwendung keine Tabelle des Fundaments selbst benennt. Die Zeile hängt über `(tenant_id, user_id)` an der Zugehörigkeit und geht mit ihr.
  2. Die Vorgabe beim Anlegen (Punkt 2) gibt ein Trigger an `memberships`, nicht die Anwendung. Jeder Weg in einen Betreiber schreibt eine Zugehörigkeit (Ersteinrichtung, Einladung, `add-staff`, weiterer Betreiber), keiner davon kennt Bereiche, und alle schreiben sie nach dem Schritt in den Betreiber, unter der Anwendungsrolle; dort läuft der Trigger. Ein Betreiber ohne Bereich bekommt mit seiner ersten Zugehörigkeit den Bereich "Alle Liegenschaften". Leitung und Technische Leitung sehen alle Bereiche, alle anderen den einen, solange es nur einen gibt, und keinen, sobald es mehrere gibt, bis jemand ihre nennt; die Liste der Rollen ist `rolesSeeingEveryArea` in `packages/domain`, ein Test hält sie gegen die Datenbank. Ein Trigger an `tenants` ging nicht: einen Betreiber legt eine Funktion an, die als Eigentümer der Tabellen läuft, und unter `FORCE` dürfte der Eigentümer keinen Bereich schreiben. Die Vorgabe gilt nur für eine neue Zugehörigkeit, wer wieder hereingelassen wird, behält seine Bereiche. Die Zugehörigkeiten, die vor der Migration bestanden, bekommen dieselbe Vorgabe, mit dem Grund `migration` im Protokoll ihres Betreibers, damit niemand nach dem Update weniger sieht als davor.
  3. Der Tag einer Vertretung ist der Tag in Deutschland (`Europe/Berlin`) und nicht der der Zeitzone, auf die der Server gestellt ist; damit entfällt der letzte Punkt unter "Schlecht". Eine gesperrte vertretene Person gibt ihre Bereiche weiter, das ist der Fall aus Abschnitt 1 des Konzepts: jemand verlässt das Unternehmen, und die Vertretung übernimmt. Eine gesperrte Person sieht nichts und vertritt niemanden.
  4. Der Katalogtest (Bestätigung) prüft vier Regeln. Jede Policy `within_areas` ist restriktiv, gilt für jeden Befehl und für die Anwendungsrolle und liest und schreibt über den Ausdruck des Bausteins `withinAreas`; ein direkter Aufruf wird als solcher benannt. Jede Tabelle mit `area_id` hat sie, ausgenommen `member_areas`, die die Funktionen selbst lesen. Jede Tabelle mit `property_id` hat `area_id` und den Schlüssel auf die Liegenschaft mit `ON UPDATE CASCADE`. Und ein Schlüssel, der auf eine Zeile mit Bereich zeigt, läuft über Mandant und Liegenschaft, damit sich keine Zeile an einen Ort eines anderen Bereichs hängen kann. Solange keine Tabelle einen Ort hat, zeigt der Test das an Tabellen, die er nach dem Baustein selbst anlegt, mit einer Gegenprobe je Regel.
  5. Die Messung aus Punkt 9 ist als Test wiederholt, an denselben Mengen: zwei Betreiber mit je 4 Bereichen, 20 Liegenschaften und 6000 Anlagen, und eine Person mit einem Bereich zählt alle Anlagen ihres Betreibers. Gezählt werden die gelesenen Puffer, weil die Zeit eine Eigenschaft der Maschine ist und die Puffer eine des Plans:

     | Policy | Puffer | Zeit am 03.10.2026 |
     | --- | --- | --- |
     | nur die des Betreibers | 160 | 2,6 ms, zählt 6000 Zeilen |
     | Baustein mit Unterabfragen | 169 | 1,1 ms, zählt 1500 Zeilen |
     | Funktionen direkt aufgerufen | 54.160 | rund 900 ms |

     Der Test verlangt, dass der Baustein weniger als 50 Puffer mehr liest als die Policy des Betreibers allein und der direkte Aufruf mehr als das Zwanzigfache des Bausteins. Dass der direkte Aufruf langsamer ist als in der ersten Messung, liegt an den Funktionen, wie sie gebaut sind: sie prüfen auch die Sperre und die Vertretung und setzen ihren `search_path`. Einmal je Anweisung fällt das nicht ins Gewicht, für jede Zeile summiert es sich.
  6. Ein Lauf im Hintergrund sagt über `inEveryArea` in `packages/server/src/database/every-area.ts`, dass er alle Bereiche braucht; die Funktion setzt `app.all_areas` für die eine Transaktion. Ein Test hält die Liste der Dateien, die das dürfen, bisher nur diese; die Läufe kommen mit `#24` und `#25`.

- **Nachtrag vom 05.10.2026, gebaut mit `#84`.** Die Routen unter `/areas` und `/substitutions` halten die Bereiche, wer in welchem arbeitet und wer wen vertritt. An fünf Stellen sagt der Bau mehr als diese Entscheidung:

  1. **Wer was darf.** Die Bereiche, in denen jemand arbeitet, liest jeder, der Orte sieht (`GET /areas`): eine Liste filtert danach, und eine neue Liegenschaft kommt in einen davon. Bereiche anlegen, umbenennen und entfernen ist eine Einstellung des Betreibers, wer in welchem arbeitet und wer wen vertritt gehört zu den Zugängen; Abschnitt 7 des Konzepts gibt beides der Leitung. Ein eigenes Recht für Bereiche gibt es nicht.
  2. **Leitung und Technische Leitung haben immer alle Bereiche.** Punkt 2 nennt das eine Vorgabe beim Anlegen, und die Datenbank kennt weiter keine Regel dazu. Die Route nimmt für eine Rolle aus `rolesSeeingEveryArea` aber nur "alle" (`memberAreasProblem` in `packages/domain`), wie Abschnitt 7 es für beide Rollen sagt und die Tafel "Zugang bearbeiten" es zeichnet. Für jede andere Rolle gilt alle oder die genannten, auch keiner: wer keinen Bereich hat, sieht nichts mit Ortsbezug und ist nicht gesperrt.
  3. **Entfernen heißt erst leeren** (entschieden am 04.10.2026, Abschnitt 2.8). `DELETE /areas/:id` lehnt einen Bereich ab, in dem noch eine Liegenschaft liegt, und nennt ihre Zahl; mit `moveTo` verlegt die Route sie vorher in den genannten Bereich, in derselben Transaktion, mit allem darunter nach Punkt 4. Auch eine Liegenschaft, die als gelöscht markiert ist, wird verlegt: sie nennt ihren Bereich weiter, und ihr Schlüssel hielte ihn fest. Der letzte Bereich eines Betreibers bleibt. Wer nicht jede Liegenschaft des Bereichs sieht, kann ihn nicht leeren; dann lehnt der Schlüssel der Liegenschaft ab, und die Antwort sagt, wer es kann. Die Zeilen in `member_areas` gehen mit dem Bereich.
  4. **Geschrieben wird nur, was sich ändert.** `PUT /areas/members/:userId` vergleicht mit dem Bestand und schreibt die Zeile, die kommt oder geht, damit das Änderungsprotokoll den Bereich nennt und nicht jeden, den die Person behält. Was sie sieht, folgt sofort; ihr Gerät nennt beim nächsten Abruf einen anderen Wert unter `narrowed` und lässt fallen, was es nicht mehr halten darf (Punkt 13).
  5. **Eine Vertretung endet, indem ihre Zeile geht.** Es wird nichts kopiert, also ist nichts aufzuräumen (Punkt 3), und wer sie eingetragen und beendet hat, steht im Änderungsprotokoll. Die Route nimmt keine, die ganz in der Vergangenheit liegt, keine für jemanden, der nicht für den Betreiber arbeitet, keinen gesperrten Vertreter und dieselben zwei Personen nicht zweimal für überlappende Tage. Die Liste zeigt, was läuft oder kommt.

- **Nachtrag vom 05.10.2026, Bereiche mit der Einladung und mit dem Rollenwechsel (`#84`).** Abschnitt 2.8 des Konzepts lässt die Leitung mit Rolle und Bereichen einladen, und die Tafeln zeichnen beides in einem Dialog, beim Anlegen wie beim Bearbeiten. Einladung, Zugehörigkeit und Rollen sind Tabellen und Routen des Fundaments, die von Bereichen nichts wissen. Das Fundament ruft die Anwendung deshalb in seiner eigenen Transaktion, mit einer neuen Einladung, mit der Zugehörigkeit, zu der sie wird, und mit einem Rollenwechsel (`MembershipAdditions`, Nachtrag vom selben Tag in ADR 0010 des Repositorys `opengewerk`); gebunden ist das in `packages/server/src/areas/additions.ts`. Was der Bau festlegt:

  1. **Zwei Tabellen neben der Einladung** (Migration `0014_invitation_areas`), keine Spalte an ihr, aus dem Grund, aus dem `member_all_areas` eine eigene Tabelle ist (Nachtrag vom 03.10.2026, Punkt 1): die Einladung gehört dem Fundament. `invitation_area_choices` hält je Einladung, die etwas zu Bereichen sagt, ob es alle sind oder die genannten; `invitation_areas` hält darunter je genanntem Bereich eine Zeile. Die Anwendungsrolle darf beide lesen und einfügen und sonst nichts: eine Einladung wird nicht bearbeitet, sondern durch eine neue ersetzt.
  2. **Eine Einladung ohne Wort zu Bereichen sagt nichts**, und die Zugehörigkeit, zu der sie wird, beginnt mit dem, was die Vorgabe aus Punkt 2 einer neuen gibt. So wird eine Anfrage genommen, die von Bereichen nichts weiß, etwa von einer Oberfläche vor diesem Bau.
  3. **Wird ein genannter Bereich entfernt, geht seine Zeile mit ihm, die Wahl bleibt.** Nannte die Einladung nur diesen, heißt sie danach "keiner", und wer sie einlöst, hat keinen Bereich, auch wenn der Betreiber nur noch einen hat und eine neue Zugehörigkeit ihn von sich aus bekäme. Die Liste der Einladungen sagt das, wie die der Zugänge.
  4. **Rolle und Bereiche in einer Anfrage passen zusammen oder werden beide nicht gespeichert.** Genannte Bereiche für Leitung oder Technische Leitung, ein Bereich, den der Betreiber nicht hat, oder eine Angabe ohne "alle oder die genannten" lehnen Einladung und Rollenwechsel ab; es entsteht keine Einladung, und die Rollen bleiben, wie sie waren.
  5. **Ein Rollenwechsel ohne Wort zu Bereichen** gibt alle Bereiche, wem die neue Rolle sie nach `rolesSeeingEveryArea` gibt, und lässt sie sonst, wie sie sind (Punkt 2: die Vorgabe gilt beim Anlegen). Wer Leitung war und es nicht mehr ist, behält damit alle Bereiche, bis seine genannt sind; die Liste der Zugänge zeigt es, und der Dialog der Haustechnik speichert Rolle und Bereiche ohnehin zusammen.
  6. **Eine Zugehörigkeit, die eine Einladung wieder aufnimmt**, gesperrt oder mit anderen Rollen, behält ihre Bereiche, wenn die Einladung nichts sagt, und bekommt sonst die der Einladung. Rollen, die in allen Bereichen gelten, bekommen alle, was auch immer vorher genannt war.
  7. **`invitation_areas` trägt `area_id` und keine Grenze zwischen den Bereichen**, wie `member_areas` (Punkt 6; Nachtrag vom 03.10.2026, Punkt 4): sie nennt Bereiche und liegt in keinem. Die Katalogprüfung führt sie in `areaColumnsWithoutTheLine` mit ihrem Grund.
  8. **`GET /areas/invitations`** nennt hinter "Zugänge ansehen", was die Einladungen sagen, die sich noch einlösen lassen, neben der Liste der Einladungen des Fundaments.
- **Nachtrag vom 06.10.2026, die Fassung eines Dokuments trägt keinen Bereich (`#97`).** Jede Zeile mit Ort trägt `area_id`, geführt vom Schlüssel über die Liegenschaft mit `ON UPDATE CASCADE`. Für `attachment_versions` geht das nicht: eine Fassung wird einmal geschrieben, und ein Auslöser des Fundaments (`attachment_version_stays_as_written`) lehnt jede Änderung für jeden ab, auch die des Schlüssels, der einer Liegenschaft in einen anderen Bereich folgt. Mit einer Bereichsspalte an der Fassung ließe sich eine Liegenschaft, an der ein Dokument hängt, nicht mehr verlegen (`opengewerk/opengewerk#569`). Die Fassung fragt deshalb ihr Dokument: die restriktive Policy `within_areas_of_their_file` lässt eine Fassung nur durch, wenn ihr Dokument für die Person da ist, mit einem `EXISTS` auf `attachments`, das unter seinen eigenen Policies gelesen wird, zum Lesen wie zum Schreiben. Das Dokument selbst trägt `area_id` und `within_areas` wie jede Zeile mit Ort. Die Katalogprüfung kennt die Ausnahme beim Namen (`linesThroughARow` in `packages/server/src/database/test-areas.ts`): der eine Schlüssel der Fassung auf ihr Dokument darf ohne die Liegenschaft laufen, und dafür verlangt die Prüfung die Policy, restriktiv, für jeden Befehl, für die Anwendungsrolle und mit dem Ausdruck des Bausteins. `areas.test.ts` hält, dass eine Fassung liest und anlegt, wer ihr Dokument sieht, dass sie ihrem Dokument in einen anderen Bereich folgt, ohne geändert zu werden, und dass die Prüfung eine Fassung ohne ihre Policy nennt. Eine weitere Tabelle kommt nur auf die Liste, wenn ihre Zeilen Teil einer Zeile mit Ort sind und nie geändert werden.
- **Nachtrag vom 06.10.2026, die eine Frage an den Bereichen vorbei (`#98`).** Wer das Etikett einer Anlage aus einem fremden Bereich scannt, soll erfahren, dass es außerhalb der eigenen Bereiche liegt, und nicht, dass es das Etikett nicht gibt (Tafel "Etikett gesperrt, fremd, außerhalb", Abschnitt 2.8 des Konzepts). Die Policy `within_areas` verbirgt eine solche Zeile, also lässt sich die Frage unter ihr nicht stellen. Dafür gibt es `label_state_in_tenant(code)`: die erste und einzige Funktion dieser Anwendung, die mit den Rechten des Eigentümers läuft (`SECURITY DEFINER`). Sie liest den Betreiber aus der Transaktion und nimmt keinen als Argument, antwortet mit einem Wort (`valid`, `blocked` oder nichts) und gibt weder Anlage noch Raum, Liegenschaft, Bereich oder Kennung heraus. `EXECUTE` ist PUBLIC genommen und der Anwendungsrolle gegeben, die Tabelle `labels` trägt dafür die Policy `readable_by_the_owner` des Fundaments, und die Funktion steht mit ihrem Grund auf der Liste in `tenant-isolation.test.ts`. Die Route `GET /labels/:code` fragt zuerst unter den Policies der Person und erst für einen Code, den sie nicht sieht, diese Funktion; ihre Antwort ist ein Wort (`open`, `blocked`, `outside`, `unknown`). `inEveryArea` bleibt einer Route verwehrt wie bisher. Eine zweite solche Funktion ist eine neue Entscheidung und kein Muster.
- **Nachtrag vom 06.10.2026, die zweite Frage an den Bereichen vorbei (`#99`).** Der Nachtrag zu `#98` nennt eine zweite Funktion mit den Rechten des Eigentümers eine neue Entscheidung und kein Muster. Hier ist sie. Zwei Leute, die in zwei Bereichen den Bestand aufnehmen, legen dieselbe Anlage so leicht doppelt an wie zwei in einem, und die Policy `within_areas` verbirgt die erste vor der zweiten. Abschnitt 2.7 des Konzepts verlangt den Konflikt trotzdem: "die Person sieht die andere Anlage, soweit sie in ihrem Bereich liegt". Gefunden wird also über die Grenze, gezeigt nicht. Dafür gibt es `asset_duplicate_candidates(asked_serial, asked_mark)`: sie liest den Betreiber aus der Transaktion und gibt von seinen Anlagen die heraus, deren Ziffern zu der gefragten Seriennummer oder dem gefragten Kennzeichen passen, mit Kennung, Seriennummer und Kennzeichen und sonst nichts. **Was eine Dublette ist, sagt weiter `domain`** (`possibleDuplicates`), auf dem Gerät wie auf dem Server, und wird in SQL kein zweites Mal gesagt: Kleinschreiben und das Entfernen von Leerzeichen ändern keine Ziffer, also ist jede Anlage, die die Regel nennen würde, unter den herausgegebenen, und wer fragt, muss die Nummer fast buchstabengenau kennen. Gefragt wird nur aus dem Abgleich (`sync/duplicates.ts`), für eine Anlage, die ein Gerät anlegt. Was daraus das Gerät erreicht, ist ein Konflikt mit dem Namen des Feldes; die andere Anlage zeigt das Gerät nur, wenn es sie nach dem Abgleich selbst hält. `EXECUTE` ist PUBLIC genommen und der Anwendungsrolle gegeben, `assets` trägt dafür `readable_by_the_owner`, und die Funktion steht mit ihrem Grund auf der Liste in `tenant-isolation.test.ts`. `inEveryArea` bleibt einer Route verwehrt wie bisher.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- eine Person mit dem Bereich Nord unter der Anwendungsrolle keine Zeile aus Süd liest oder schreibt, geprüft je Tabelle,
- eine Transaktion ohne Person in keiner Tabelle mit Ortsbezug eine Zeile sieht,
- eine verlegte Liegenschaft jede Zeile darunter mitnimmt, mit einem Test, der die Tabellen aus dem Katalog liest und keine auslässt,
- der Katalogtest eine Tabelle mit Ortsbezug ohne Spalte, Schlüssel oder Policy ablehnt, und eine Bereichs-Policy, die eine der Funktionen direkt aufruft,
- und die Messung aus Punkt 9 als Test über die Zahl der Pufferzugriffe wiederholt wird, damit eine langsame Policy auffällt.

## Vor- und Nachteile der Optionen

### A: Spalte, von einem Trigger geführt

- Gut: eine Spalte statt zweier.
- Schlecht: der Trigger muss an jeder Tabelle hängen, und der zweite, der beim Verlegen nachzieht, muss jede kennen. Eine Tabelle, die er nicht kennt, behält den alten Bereich, und nichts meldet es.

### B: Spalte, von einem Fremdschlüssel geführt

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

### C: Keine Spalte

- Gut: nichts kann auseinanderlaufen, weil es nichts Zweites gibt.
- Schlecht: jede Policy wäre ein Join bis zur Liegenschaft, je Zeile und über bis zu vier Ebenen. Zeilen, die an einem von mehreren Bezügen hängen, bräuchten vier davon.

### a: Die Anwendung setzt die Bereiche

- Gut: die Policy vergleicht nur gegen eine Einstellung und liest keine Tabelle.
- Schlecht: jede Stelle, die eine Transaktion öffnet, müsste die Bereiche richtig setzen. Eine, die es falsch tut, weitet auf, und die Datenbank kann es nicht merken.

### b: Die Datenbank leitet sie her

- Gut: es gibt keine Stelle in der Anwendung, die Bereiche weitergibt. Was eine Person sieht, steht in den Tabellen und nirgends sonst.
- Schlecht: eine Abfrage mehr je Anweisung, und Hintergrundläufe brauchen einen eigenen, ausdrücklichen Weg.

## Weitere Informationen

- ADR 0002, Datenmodell vom Ort bis zum Nachweis
- ADR 0003 im Repository `opengewerk`, Datenbank und Datenzugriff, mit dem Nachtrag "Fremdschlüssel sehen an der Row-Level Security vorbei"
- ADR 0006 im Repository `opengewerk`, Authentifizierung, Autorisierung und Mandantenfähigkeit
- Planungskonzept, Abschnitte 2.7 und 2.8
