---
status: angenommen
date: 2026-10-01
decision-makers: Projektleitung OpenGewerk
consulted: Planungskonzept "OpenGewerk Haustechnik" v0.3, Leitentscheidungen 3, 4 und 10, Abschnitte 2.3, 2.5, 2.9, 5 und 15; ADR 0002; ADR 0004 und 0008 im Repository `opengewerk`
informed: Mitwirkende der Organisation opengewerk
---

# Pakete: Pflichtenkatalog, Anlagenarten, Regeln und Formulare als Daten

## Kontext und Problemstellung

Pflichten sind Daten, kein Code und kein Freitext (Leitentscheidung 3). Welche Prüfung für welche Anlagenart gilt, in welchem Abstand, durch wen und nach welcher Vorschrift, steht in Paketen, die jemand vom Fach lesen und ändern kann, ohne eine Zeile Code anzufassen. Abschnitt 5 des Konzepts nennt das Format und sieben Pakete bis Version 1.

Die Handwerkersoftware hat mit ADR 0008 dasselbe für Gewerke entschieden und mit ihrem Elektro-Paket gebaut: ein Ordner mit `manifest.json`, Formularen und Regeln als JSON, eingebaut in Server und Oberfläche. Dieses ADR überträgt das Format und entscheidet, was der Katalog darüber hinaus braucht:

1. Wie kommt ein Paket in die Anwendung, und wie auf ein Gerät ohne Netz?
2. Wie ändert sich ein Eintrag, auf den sich schon ein Betreiber verlässt?
3. Was muss an jedem Eintrag stehen, damit sich ein Betreiber darauf verlassen darf?
4. Was prüft die CI, bevor ein Beitrag gemergt wird?

## Entscheidungstreiber

- Ein Beitrag zum Katalog braucht kein Programmieren. Was ein Beitrag ohne Code falsch machen kann, fängt ein Test.
- Eine neue Vorschrift ist ein neuer Datensatz mit Gültigkeitsbeginn. Für eine Prüfung von 2027 gilt auch 2030 noch die Frist von 2027.
- Server und Gerät rechnen mit denselben Einträgen. Ein Rundgang im Keller prüft einen Messwert gegen denselben Grenzwert wie das Büro.
- Ein Eintrag, auf den sich ein Betreiber verlässt, ändert sich nicht unter ihm.
- Der Katalog nennt, woher eine Pflicht kommt, und gibt keine Normtexte wieder (Abschnitt 5).
- Kein Paket kostet Geld, und keines wird freigeschaltet (Leitentscheidung 10).

## Betrachtete Optionen

Für den Weg in die Anwendung:

**A: Eingebaut.** Die Pakete sind Teil des Baus von Server und Oberfläche, wie das Elektro-Paket der Handwerkersoftware.

**B: Vom Server gelesen.** Die Pakete liegen als Dateien neben der Anwendung, der Server liest sie beim Start und liefert sie an die Geräte aus.

**C: In der Datenbank.** Die Pakete werden eingespielt und stehen als Zeilen in Tabellen.

Für die Änderung eines Eintrags:

**a: Ändern an Ort und Stelle**, die Geschichte steht in git.

**b: Fassungen.** Ein gemergter Eintrag ist unveränderlich, eine Änderung ist eine neue Fassung daneben.

## Entscheidung

Gewählt wurden **A** und **b**.

**Das Format**

1. Ein Paket ist ein Ordner mit Daten, im Format von ADR 0008 der Handwerkersoftware und mit den Unterordnern aus Abschnitt 5:

   ```
   pakete/<name>/
     manifest.json          # Name, Titel, Fassung, benötigte Fassung der Anwendung
     anlagenarten/*.json    # Arten mit Kostengruppe, Feldern, Merkmalen, Soll-Dokumenten
     pflichten/*.json       # Pflichtarten mit Fundstelle, Qualifikation, Geltungsbereich
     regeln/*.json          # Fristen und Grenzwerte mit Gültigkeit und Fundstelle
     formulare/*.json       # Prüf- und Wartungsprotokolle
     vorlagen/*.json        # Vorlagen für Rundgänge
     abnahmen.json          # je Eintrag: zuletzt gegen die Quelle geprüft, abgenommen von wem und wann
   ```

   Die Namen der Felder sind englisch, die Texte deutsch. Jede Datei wird gegen ein Schema geprüft.

2. **Schlüssel.** Jeder Eintrag hat einen Schlüssel, der innerhalb seines Pakets eindeutig ist und nie neu vergeben wird; nach außen heißt er `<paket>.<schlüssel>`. Was ein Betreiber selbst anlegt, eine eigene Anlagenart oder eine eigene Pflicht, steht in der Datenbank und trägt eine Kennung, die mit keinem Schlüssel eines Pakets zusammenfallen kann.

3. **Regeln sind Datensätze der Regel-Engine des Fundaments**: Schlüssel, Wert, Einheit, Gültigkeitszeitraum, Fundstelle, dazu der Geltungsbereich (bundesweit oder ein Land). Eine Pflichtart nennt ihre Frist nicht als Zahl, sondern als Schlüssel einer Regel. Für einen Tag ohne hinterlegte Regel gibt es keine Antwort statt einer erfundenen.

**Der Weg in die Anwendung**

4. Die Pakete sind Teil des Baus: der Server lädt sie mit seinem Code, und die Oberfläche bringt sie mit. So rechnen Server und Gerät mit denselben Einträgen, und ein Gerät ohne Netz hat sie. In der Oberfläche sind sie ein Teil, der nach dem Start nachgeladen und vom Service Worker vorgehalten wird; sie zählen nicht zu dem, was vor dem ersten Bildschirm geladen sein muss.

5. Die Logik steht nicht im Paket. Welche Pflichtarten für eine Anlage an einem Tag in Frage kommen, welche Frist gilt und ob ein Messwert seinen Grenzwert hält, rechnen reine Funktionen im Paket `domain`, die den Katalog als Argument bekommen.

6. **Kein Paket wird je Betreiber ein- oder ausgeschaltet.** Was nicht zutrifft, trifft nicht zu: ein Betreiber ohne Aufzug hat keine Anlage dieser Art, und das Landesrecht gilt nach dem Land der Liegenschaft. Ein Schalter je Paket wäre der Anfang eines Paketes gegen Aufpreis.

**Fassungen und Abnahme**

7. Jeder Eintrag einer Pflichtart, einer Anlagenart, eines Formulars und einer Vorlage hat eine **Fassung**, und jede Fassung ist eine eigene Datei: `<schlüssel>.v1.json`, `<schlüssel>.v2.json`. Eine Fassung nennt den Tag, ab dem sie gilt; an einem Tag gilt die höchste Fassung, deren Beginn erreicht ist. **Eine gemergte Fassung wird nicht geändert**, auch nicht für einen Tippfehler: die Berichtigung ist die nächste Fassung. Ein ausgefülltes Formular bleibt so mit seiner Fassung lesbar, und eine bestätigte Pflicht nennt eine Fassung, die morgen noch dasselbe sagt.

8. **Regeln werden nicht neu gefasst, sondern fortgeschrieben.** Ein Regeldatensatz gilt für einen Zeitraum; ändert sich die Vorschrift, bekommt der alte ein Ende und ein neuer beginnt. War ein Wert von Anfang an falsch eingetragen, wird der Datensatz berichtigt: was die Vorschrift an einem Tag verlangt hat, ändert sich nicht dadurch, dass der Katalog es zuerst falsch wiedergegeben hat.

9. **Prüfung und Abnahme stehen neben dem Eintrag**, in `abnahmen.json`: je Fassung und je Regeldatensatz der Tag, an dem er zuletzt gegen seine Quelle geprüft wurde, und wer ihn fachkundig abgenommen hat und wann. Beides ändert sich, ohne dass der Eintrag sich ändert, und gehört deshalb nicht in eine Datei, die unveränderlich ist. Die Abnahme nennt die Prüfsumme dessen, was abgenommen wurde. Ein Regeldatensatz, der nach seiner Abnahme berichtigt wird, hat damit keine mehr, und die CI lehnt eine Abnahme ab, deren Prüfsumme nicht passt: wer berichtigt, nimmt die Abnahme heraus, und der Eintrag ist wieder als nicht abgenommen gekennzeichnet, bis jemand vom Fach ihn erneut ansieht.

10. **Eine bestätigte Pflicht trägt, womit sie bestätigt wurde**: die Fassung der Pflichtart und die Frist, die an dem Tag galt. Kommt eine neue Fassung oder ändert sich eine Regel, ändert sich die Pflicht nicht still. Die Anwendung zeigt, für wie viele Anlagen sich etwas ändert, und der Betreiber übernimmt.

**Was an jedem Eintrag steht**

11. Eine Pflichtart ohne **Fundstelle** wird nicht aufgenommen: Paragraf mit Gesetz oder Verordnung, Norm mit Ausgabe und Abschnitt, oder die Regel der Technik, die sie trägt.

12. Jede Pflichtart trägt ihre **Herkunft**: staatliches Recht, Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse, oder private Norm. Was das Paket zu ihr sagen darf, hängt daran (Abschnitt 5): bei staatlichem Recht Fundstelle, Frist und Qualifikation in eigenen Worten; bei einer privaten Norm den Verweis und die Pflicht in eigenen Worten, und die Frist nur, soweit die rechtliche Prüfung das trägt. Bis dahin nennt der Eintrag keine Frist, und der Betreiber trägt sie ein.

13. Für jeden Eintrag steht in `abnahmen.json` der **Tag, an dem er zuletzt gegen seine Quelle geprüft wurde**. Liegt er länger als ein Jahr zurück, ist der Eintrag gekennzeichnet, und ein geplanter Lauf erinnert daran. Ein Eintrag ohne **Abnahme** ist ebenfalls gekennzeichnet, überall wo er gelesen wird.

14. Der **Geltungsbereich** einer Pflichtart nennt Anlagenarten, Bedingungen an Merkmale der Anlage, Gebäudearten und Länder. Er ist eine Aufzählung von Bedingungen und kein Ausdruck in einer eigenen Sprache.

15. Die **Aufbewahrung** des Nachweises ist eine Regel mit drei Formen (ADR 0004).

**Was die CI prüft**

16. Für jedes Paket, bei jedem Pull Request:

    - jede Datei entspricht ihrem Schema;
    - keine Pflichtart ohne Fundstelle und ohne Herkunft, und kein Eintrag ohne Tag der letzten Prüfung;
    - keine Frist an einer Pflichtart aus einer privaten Norm ohne den Vermerk, dass die rechtliche Prüfung sie trägt;
    - jede genannte Regel gibt es, mit Gültigkeitszeitraum und ohne Lücke mitten in einer Reihe;
    - jeder Verweis auf eine Anlagenart, ein Merkmal, ein Formular oder eine Vorlage hat ein Ziel;
    - kein Schlüssel kommt zweimal vor, und keine Fassung fehlt in einer Reihe;
    - **eine Fassung, die es auf `main` gibt, ist im Pull Request Byte für Byte dieselbe**, verglichen mit dem Stand von `main`;
    - jede Abnahme nennt die Prüfsumme des Eintrags, wie er dasteht.

17. Was die CI nicht prüfen kann, prüft die Abnahme: ob die Pflicht so im Gesetz steht, und ob der Text eigene Worte sind. Vorlagen, Checklisten und Texte eines Betreibers werden nicht aufgenommen, auch nicht abgewandelt.

### Konsequenzen

Gut:

- Server und Gerät können nicht mit verschiedenen Katalogen rechnen, weil beide aus demselben Bau stammen.
- Eine Fassung ist eine Zusage: sie sagt morgen dasselbe. Worauf eine bestätigte Pflicht, ein ausgefülltes Formular oder ein Nachweis verweist, lässt sich in zehn Jahren nachlesen.
- Ob sich ein Betreiber auf einen Eintrag verlassen darf, steht daneben und ändert sich, ohne dass der Eintrag sich ändert: geprüft am, abgenommen von.
- Wer einen Fehler im Katalog findet, ändert eine JSON-Datei, und die CI sagt, was daran nicht stimmt.
- Eine Pflicht aus einer privaten Norm kann nicht versehentlich mit einer Frist erscheinen.

Schlecht:

- Eine Änderung am Katalog braucht eine Fassung der Anwendung. Eine Vorschrift, die morgen gilt, erreicht einen Betreiber erst mit seinem nächsten Update; der Gültigkeitsbeginn im Datensatz sorgt dafür, dass sie vorher eingespielt werden kann.
- Der Katalog wächst in der Oberfläche mit. Als nachgeladener Teil zählt er nicht ins Budget des ersten Bildschirms, aber er wird geladen und vorgehalten, auf jedem Gerät.
- Fassungen als Dateien heißen viele Dateien, und auch ein Tippfehler kostet eine. Ein Eintrag, der dreimal neu gefasst wurde, liegt viermal da, und ein Betreiber, der gegen die erste bestätigt hat, wird dreimal gefragt, ob er übernimmt.
- Regeln und die übrigen Einträge ändern sich auf zwei verschiedene Arten. Wer beiträgt, muss wissen, welche er vor sich hat; die CI sagt es ihm, wenn er es verwechselt.
- Der Vergleich mit `main` braucht in der CI die Geschichte des Repositorys und nicht nur den Stand.

Nachträge:

- **Nachtrag vom 03.10.2026, das Format ist gebaut (`#19`).** Das Paket `@opengewerk/haustechnik-catalogue` unter `packages/catalogue` ist der Lader: sein Bau liest den Ordner `pakete/`, prüft jedes Paket und schreibt das Bündel mit Prüfsumme nach `dist/`, das Server und Oberfläche importieren. Ein Paket mit einem Fehler hält den Bau an, und die Liste der Befunde steht im Protokoll des Schritts "Bauen". Die Abfragen über den Katalog stehen in `packages/domain` (`catalogueOf`), und jede gibt einen Eintrag nur zusammen mit seiner Prüfung und Abnahme heraus. An diesen Stellen sagt der Bau mehr als die Punkte 1 bis 17:

  1. **Das Schema ist eine Beschreibung im Lader und keine JSON-Schema-Datei**, aus dem Grund des Nachtrags vom 24.09.2026 zu ADR 0004 im Repository `opengewerk`: was ein Paket richtig machen muss, geht über die Form seiner Daten hinaus, und in JSON Schema wäre all das eine zweite Sprache in der ersten. Jeder Befund ist ein deutscher Satz, der Datei und Feld nennt. Ein Feld, das das Schema nicht kennt, ist ebenfalls ein Befund; sonst fiele ein falsch geschriebenes Feld still weg. Erst wenn alle Dateien ihrem Schema entsprechen, prüft der Lader, wie sie zusammenhängen, damit ein Tippfehler nicht als fehlende Regel gemeldet wird.
  2. **Der Lader durchsucht die Ordner, das Manifest zählt keine Dateien auf.** Beim Elektro-Paket der Handwerkersoftware nennt das Manifest seine Dateien, und eine Datei, die dort fehlt, bleibt unbemerkt liegen; hier braucht ein Beitrag keine zweite Stelle. Eine Datei, die zu keinem Teil eines Pakets gehört, lehnt der Bau ab.
  3. **Schlüssel und Fassung stehen im Dateinamen** und nicht noch einmal in der Datei. Ein Schlüssel nennt in seinem Paket genau ein Ding, über alle Teile und die Regeln hinweg, damit `<paket>.<schlüssel>` eindeutig ist; er hat deshalb keinen Punkt. Ein Verweis ohne Punkt meint das eigene Paket, einer mit Punkt ein anderes.
  4. **Merkmal und Feld einer Anlagenart sind zweierlei**: nach einem Merkmal fragt der Geltungsbereich einer Pflichtart, nach einem Feld niemand. Ein Merkmal mit einer Zahl ist eine ganze Zahl in einer Einheit der Regel-Engine, und eine Bedingung vergleicht es mit einer Regel, weil sich auch eine Schwelle mit dem Recht ändert. Dass jede Fassung jeder Anlagenart im Geltungsbereich das Merkmal in dieser Art hat, prüft der Bau. Soll-Dokumente haben Schlüssel und Bezeichnung; Arten von Dokumenten kommen mit der Ablage.
  5. **Die Tätigkeit einer Pflichtart heißt im Code `task`**, weil `activity` nach ADR 0002 der Vorgang ist. Die Prüfung heißt `inspection`, wie ADR 0002 sie nennt, und die Inspektion nach DIN 31051 deshalb `condition_assessment`.
  6. **Ab wann eine Frist zählt, steht noch nicht im Format.** Abschnitt 4.4 des Konzepts nennt zwei Arten, ab dem Tag der Prüfung oder ab dem fälligen Tag. § 14 Abs. 5 BetrSichV kennt für die Anlagen nach Anhang 2 Abschnitt 2 bis 4 und Anhang 3, die Aufzugsanlagen eingeschlossen, eine dritte: ab dem Fälligkeitstermin, bei einer früheren Prüfung ab deren Monat, und fristgerecht ist eine Prüfung noch zwei Monate nach dem Termin. Das gehört zum Termin (`#25`); der Befund steht dort.
  7. **Formulare und Vorlagen liest der Lader bis `#28` nur in ihrer Hülle**: Beginn, Titel und dass es Abschnitte gibt. Was in den Abschnitten steht, prüft die Formular-Engine, sobald sie im Fundament ist.
  8. **Die Prüfsumme einer Abnahme** ist bei einer Fassung die ihrer Datei, Byte für Byte, bei einer Regel die ihres Datensatzes in einer festen Form. Fehlt sie oder passt sie nicht, nennt der Bau die richtige.
  9. **Der Vergleich mit `main` braucht nur dessen Stand und nicht seine Geschichte**, anders als die Konsequenzen oben annehmen: die CI holt die Spitze von `main` mit der Tiefe 1 und vergleicht jede Fassung, die es dort gibt, Byte für Byte mit dem Pull Request. Regeln, Manifeste und `abnahmen.json` ändern sich und werden nicht verglichen.
  10. **Das Probepaket liegt bei den Tests des Laders**, unter `packages/catalogue/test/pakete/probe/`, und nicht unter `pakete/`, weil alles dort mit der Anwendung ausgeliefert wird. Es hat eine Anlagenart, eine Pflichtart aus staatlichem Recht, die Hauptprüfung einer Aufzugsanlage nach Anhang 2 Abschnitt 2 Nr. 4.1 BetrSichV, und die Regel ihrer Frist; es ist neu geschrieben und von niemandem abgenommen. Wie ein Paket aufgebaut ist, steht in `pakete/README.md`.

  Noch nicht gebaut sind die Auswertung des Geltungsbereichs, die mit den Vorschlägen in Phase 1 kommt, der Lauf, der an die Prüfung der Einträge erinnert, ebenfalls in Phase 1, und das Laden des Bündels in Server und Oberfläche: der Server lädt es mit den Anlagenarten (`#20`), die Oberfläche mit ihrem ersten Bildschirm, der den Katalog zeigt. Die Prüfsumme, an der ein Test dann festhält, dass beide denselben Katalog laden, trägt das Bündel schon.
- **Nachtrag vom 03.10.2026, Messstellen und der Katalog im Server (`#20`).** Eine Anlagenart kann `meter` nennen, mit `medium` aus der Liste in `domain` (`electricity`, `water`, `heat`, `district_heating`, `gas`, `cooling`) und `units`, den Einheiten, in denen ein Zähler dieser Art zählt (`kilowatt_hours`, `megawatt_hours`, `cubic_metres`), mindestens eine und keine doppelt. Ohne `meter` ist sie keine Messstelle. Warum das Medium an der Anlagenart steht und Zählernummer und Einheit an der Anlage, sagt der Nachtrag zu ADR 0002 vom selben Tag. Das Probepaket hat dafür einen Wasserzähler bekommen, ohne Pflicht; was Punkt 10 des Nachtrags zu `#19` über seinen Inhalt sagt, gilt seitdem mit zwei Anlagenarten. Der Bau prüft es wie den Katalog, schreibt es nach `dist/probe.json` und gibt es unter dem Einstieg `./testing` aus, für die Tests des Servers, solange der Katalog dieses Baus kein Paket hat. Der Server lädt das Bündel mit den Anlagenarten, wie es der Schluss des Nachtrags zu `#19` ankündigt.
- **Nachtrag vom 03.10.2026, die Zählweise einer Pflichtart (`#25`).** Was Punkt 6 des Nachtrags zu `#19` offenließ, steht jetzt im Format: eine Pflichtart nennt in `counting` mit festen Werten, wie ihr nächster Termin gezählt wird, ab dem Tag der Durchführung (`from_performance`), ab dem fälligen Tag (`from_due`) oder nach § 14 Abs. 5 BetrSichV (`betrsichv`). Das Feld ist Pflicht. Eine Pflichtart, die nach der BetrSichV zählt, nimmt ihre Frist in Monaten oder Jahren, weil der Termin dort ein Monat mit Jahr ist; eine Regel in Tagen lehnt der Bau ab. Gezählt wird nicht im Paket, sondern in `packages/domain` (`nextAppointment`, Nachtrag zu ADR 0002 vom selben Tag): ein Feld mit festen Werten und kein Ausdruck in einer eigenen Sprache, aus dem Grund von Punkt 14. Das Bündel hat damit das Format 2. Die Pflichtart des Probepakets, die Hauptprüfung einer Aufzugsanlage, zählt nach der BetrSichV.
- **Nachtrag vom 04.10.2026, Formulare ganz gelesen (`#28`).** Punkt 7 des Nachtrags zu `#19` ist eingelöst: die Formular-Engine steht seit opengewerk#521 und #522 im Fundament, und der Lader liest ein Formular und eine Vorlage ganz. Erst die Form, wie jede Datei eines Pakets: das Formular hat genau `validFrom`, `title` und `sections`, ein Abschnitt `key`, `title`, `hint` und `fields`, ein Feld je nach Art genau die Eigenschaften, die die Engine liest, jede im richtigen Typ; ein Feld, das der Lader nicht kennt, ist ein Befund. Dann prüft die Engine, wie sie die Anwendung bindet (`forms` in `packages/domain/src/model/forms.ts`), unter dem Schlüssel und der Fassung aus dem Dateinamen, und ihre Sätze stehen ohne den Schlüssel davor als Befunde der Datei. Dazu drei Entscheidungen. **Ein Grenzwert hat ein Ziel**: die Regel, die ein Messwert nennt, gibt es, im eigenen Paket oder unter dem Namen eines anderen, und sie zählt in einer Einheit, in die sich das Feld umrechnen lässt; im Bündel steht sie wie jeder Verweis unter dem Namen, den sie außerhalb ihres Pakets trägt, auch in einer Gruppe. **Ein Feld eines Pakets zeigt auf keinen Datensatz** (`about`): welche Anlagen und Räume es gibt, weiß erst eine Instanz, und eine Vorlage, die das kann, legt ein Betreiber im Büro an (Phase 1). **Die Einheiten der Formulare** sind Grad Celsius (`degrees_celsius`, gegen eine Regel in Zehntelgrad, für die Temperaturen aus Abschnitt 8 des Konzepts) und die drei Einheiten eines Zählers; eine weitere kommt mit dem ersten Formular, das sie braucht. Listen, über die eine Gruppe wiederholt, und gerechnete Grenzwerte hat die Haustechnik noch nicht, eine Gruppe ist deshalb `free`. Im Katalog trägt ein Formular seitdem den Typ seiner Definition (`PackagedForm` mit `title` und `sections`). Das Probepaket hat ein Formular bekommen, die Ablesung des Wasserzählers mit zwei Prüfpunkten und einem Zählerstand; weil es am 04.10.2026 geprüft ist, rechnen die Tests des Laders seitdem mit diesem Tag.
- **Nachtrag vom 05.10.2026, der Katalog kommt vom Server aufs Gerät (`#90`).** Punkt 4 sagt, die Oberfläche bringe die Pakete mit. Gebaut ist es anders, und aus dem Grund, den Punkt 4 selbst nennt: Server und Gerät sollen mit denselben Einträgen rechnen, und ein Gerät ohne Netz soll sie haben. Der Katalog bleibt Teil des Baus des Servers, kein Paket kommt an der CI vorbei in eine Instanz, und Option B bleibt abgelehnt. Die Oberfläche aber holt ihn von ihrem Server, statt ihn mitzubringen: `GET /catalogue` liefert das Bündel ganz, `GET /catalogue/checksum` seine Prüfsumme. Das Gerät hält das Bündel in der lokalen Ablage des Betreibers (`keeps` am Abgleich-Client des Fundaments, `packages/web/src/sync/catalogue.ts`), fragt von da an die Prüfsumme und holt das Ganze erst wieder, wenn der Server eine andere nennt. Ein Bündel in einem Format, das dieser Bau nicht liest, ersetzt keines, das er lesen kann. Drei Gründe:

  1. **Derselbe Katalog, auch während eines Updates.** Die Oberfläche eines Geräts ist für eine Weile älter als ihr Server, weil der Service Worker die neue Fassung erst zeigt, wenn jemand sie übernimmt. Ein Katalog im Bau der Oberfläche wäre in dieser Zeit ein anderer als der, mit dem der Server rechnet. Der geholte ist immer der des Servers.
  2. **Ein Server mit einem anderen Katalog braucht keine andere Oberfläche.** Die Vorschau und die Tests laufen mit dem Probepaket, das der Bau der Oberfläche nicht enthält.
  3. **Kein Einstieg der Oberfläche wächst mit den Paketen.** Die Konsequenz "Der Katalog wächst in der Oberfläche mit" entfällt.

  Der Preis: ein Gerät hat den Katalog erst nach seiner ersten Verbindung, wie seine Datensätze auch, und bis dahin sagt ein Bildschirm, dass er noch nicht da ist. Beim Abmelden geht er mit der lokalen Ablage (ADR 0006, Punkt 2). Die erste Konsequenz unter "Gut" heißt damit: Server und Gerät rechnen mit demselben Katalog, weil das Gerät den seines Servers hält. Den letzten Punkt der Bestätigung halten zwei Tests: der Server liefert ohne übergebenen Katalog den seines Baus aus (`packages/server/src/api/catalogue.test.ts`), und ein Gerät hält, was sein Server geliefert hat, und ersetzt es, wenn der eine andere Prüfsumme nennt (`packages/web/src/sync/catalogue.test.tsx`). Beide Routen verlangen das Recht `sync.read` und nicht das Recht, Pflichten anzusehen: Anlagenarten und Formulare braucht auch, wer das Pflichtenverzeichnis nicht liest, und in dem Bündel steht nichts, was ein Betreiber geschrieben hat. Im Büro zeigen "Katalog" und die Seite einer Pflichtart, was das Gerät hält; `contents`, `ruleRecords` und `form` in `packages/domain` sind die Fragen dafür. Je Paket zählt `acceptanceTally` jeden Eintrag, auch Anlagenarten, Formulare, Vorlagen und Regeln, weil Punkt 9 jedem eine Abnahme gibt: wer "alle abgenommen" liest, soll keinen finden, der es nicht ist.

## Bestätigung

Die Entscheidung gilt als umgesetzt, wenn

- ein Paket mit einer Pflichtart ohne Fundstelle, mit einer Frist ohne Regel oder mit einer Lücke in einer Reihe die CI rot macht, jeweils einmal mit einem Gegenbeispiel gesehen,
- eine Änderung an einer gemergten Fassung die CI rot macht, ebenso eine Abnahme, deren Prüfsumme nicht zum Eintrag passt,
- für einen Tag vor dem Beginn einer Regel keine Antwort kommt,
- ein Eintrag ohne Abnahme überall, wo er gelesen wird, als solcher erkennbar ist,
- und Server und Oberfläche denselben Katalog laden, was ein Test über seine Prüfsumme festhält.

## Vor- und Nachteile der Optionen

### A: Eingebaut

- Gut: siehe Konsequenzen. Derselbe Weg wie beim Elektro-Paket der Handwerkersoftware (ADR 0008 dort, Nachtrag vom 24.09.2026).
- Schlecht: siehe Konsequenzen.

### B: Vom Server gelesen

- Gut: die Oberfläche bleibt klein, und ein Paket ließe sich ohne neuen Bau tauschen.
- Schlecht: ein Gerät könnte einen anderen Stand halten als der Server, und "ohne neuen Bau tauschen" ist ein Weg, auf dem ein Paket ohne die Prüfungen der CI in eine Instanz käme.

### C: In der Datenbank

- Gut: ein Betreiber könnte Einträge selbst ändern.
- Schlecht: genau das soll er nicht. Er überschreibt keine Vorschrift, er setzt, was die Vorschrift ihm überlässt (Leitentscheidung 3). Dazu wäre der Katalog je Instanz ein anderer, und die Abnahme sagte nichts mehr.

### a: Ändern an Ort und Stelle

- Gut: eine Datei je Eintrag.
- Schlecht: eine bestätigte Pflicht verwiese auf einen Eintrag, der inzwischen etwas anderes sagt, und ein Formular von 2027 ließe sich 2030 nicht mehr lesen wie ausgefüllt.

### b: Fassungen

- Gut: siehe Konsequenzen.
- Schlecht: siehe Konsequenzen.

## Weitere Informationen

- ADR 0008 im Repository `opengewerk`, Plugin-System für Gewerke und Erweiterungen, mit den Nachträgen vom 24.09.2026
- ADR 0004, Nachweis und Festschreibung
- Planungskonzept, Abschnitte 2.3, 2.9 und 5
