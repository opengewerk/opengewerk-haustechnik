# Pakete

Hier liegt der Katalog: welche Anlagenarten es gibt, welche Pflichten für sie in Frage kommen,
nach welcher Regel ihre Frist läuft, mit welchem Formular geprüft wird, und wer jeden Eintrag
zuletzt gegen seine Quelle geprüft und abgenommen hat. Pflichten sind Daten, kein Code und kein
Freitext (Leitentscheidung 3 des Planungskonzepts, ADR 0005). Wer zum Katalog beiträgt, schreibt
JSON und kein Programm; was eine Datei falsch machen kann, sagt der Bau.

Ein vollständiges Beispiel ist das Probepaket unter `packages/catalogue/test/pakete/probe/`: zwei
Anlagenarten, davon eine Messstelle, eine Pflichtart aus staatlichem Recht und die Regel ihrer
Frist. Es liegt nicht hier,
weil alles in diesem Ordner mit der Anwendung ausgeliefert wird.

Das erste Paket hier ist [`allgemein`](allgemein/README.md): je Kostengruppe der technischen
Anlagen eine allgemeine Anlagenart für jede Anlage, die kein Fachpaket beschreibt, und die drei
allgemeinen Mängelklassen.

## Aufbau

```
pakete/<name>/
  manifest.json          Name, Titel, Fassung, benötigte Fassung der Anwendung
  anlagenarten/          je Fassung einer Anlagenart eine Datei <schlüssel>.v<fassung>.json
  pflichten/             je Fassung einer Pflichtart eine Datei <schlüssel>.v<fassung>.json
  regeln/                Fristen, Schwellen und Grenzwerte, je Datei beliebig viele: <name>.json
  formulare/             Prüf- und Wartungsprotokolle, <schlüssel>.v<fassung>.json
  vorlagen/              Vorlagen für Rundgänge, <schlüssel>.v<fassung>.json
  mangelklassen.json     die Klassen der Mängel, und ob eine Klasse eine Anlage unsicher macht
  abnahmen.json          je Fassung, Regel und Mängelklasse: zuletzt geprüft am, abgenommen von wem und wann
  README.md              wer mag, beschreibt hier das Paket
```

Ein Paket heißt wie sein Ordner, mit kleinen Buchstaben, Ziffern und Bindestrichen. Andere
Dateien lehnt der Bau ab. Die Namen der Felder sind englisch, die Texte deutsch, die Dateien
UTF-8 ohne BOM mit LF als Zeilenende.

## Schlüssel und Verweise

Ein Schlüssel hat kleine Buchstaben, Ziffern und Unterstriche und beginnt mit einem Buchstaben,
etwa `elevator` oder `elevator_main_test_interval`. Er nennt in seinem Paket genau ein Ding: eine
Anlagenart, eine Pflichtart, ein Formular, eine Vorlage, eine Regel oder eine Mängelklasse, und
er wird nie neu vergeben. Außerhalb seines Pakets heißt ein Eintrag `<paket>.<schlüssel>`.

Ein Verweis ohne Punkt meint das eigene Paket, ein Verweis mit Punkt ein anderes: eine Pflichtart
im Paket für das Landesrecht nennt die Anlagenart `brandschutz.smoke_extraction`.

## Fassungen

Eine Anlagenart, eine Pflichtart, ein Formular und eine Vorlage haben Fassungen, und jede Fassung
ist eine eigene Datei: `elevator.v1.json`, `elevator.v2.json`. Jede nennt in `validFrom` den Tag,
ab dem sie gilt; an einem Tag gilt die höchste Fassung, deren Beginn erreicht ist. Die Fassungen
zählen von 1 an ohne Lücke, und keine beginnt vor der davor.

**Eine gemergte Fassung wird nicht geändert, auch nicht für einen Tippfehler.** Eine bestätigte
Pflicht und ein ausgefülltes Formular nennen ihre Fassung, und die muss morgen dasselbe sagen. Die
Berichtigung ist die nächste Fassung, auf Wunsch mit demselben Beginn. Die CI vergleicht jede
Fassung, die es auf `main` gibt, Byte für Byte mit dem Pull Request.

Regeln haben keine Fassungen, sie werden fortgeschrieben: ändert sich die Vorschrift, bekommt der
alte Datensatz ein Ende (`validUntil`) und ein neuer beginnt am Tag danach. War ein Wert von Anfang
an falsch eingetragen, wird der Datensatz berichtigt, und seine Abnahme kommt heraus, bis jemand
vom Fach ihn erneut ansieht.

## Die Dateien

### manifest.json

```json
{
  "name": "probe",
  "title": "Probepaket",
  "version": "1.0.0",
  "minimumCore": "0.0.0"
}
```

`name` ist der Name des Ordners, `version` die Fassung des Pakets, `minimumCore` die Fassung der
Anwendung, die das Paket mindestens braucht. Sie darf nicht neuer sein als die Anwendung, mit der
es gebaut wird.

### anlagenarten/

| Feld | Bedeutung |
| --- | --- |
| `validFrom` | Tag, ab dem diese Fassung gilt |
| `label` | Bezeichnung |
| `costGroup` | Kostengruppe nach DIN 276, drei Ziffern, etwa `"461"` |
| `characteristics` | Merkmale, nach denen der Geltungsbereich einer Pflichtart fragt; je Merkmal `key`, `label` und `kind`: `number` mit `unit` aus den Einheiten der Regel-Engine, `flag` für ja oder nein, `choice` mit mindestens zwei `options` aus `value` und `label` |
| `fields` | weitere Felder einer Anlage dieser Art, nach denen keine Pflicht fragt: `text`, `number` mit einer Einheit zum Anzeigen, `date`, `flag`, `choice` |
| `expectedDocuments` | Soll-Dokumente mit `key` und `label`, etwa der Notfallplan |
| `meter` | nur bei einer Messstelle: `medium`, was sie misst (`electricity`, `water`, `heat`, `district_heating`, `gas`, `cooling`), und `units`, die Einheiten, in denen ein Zähler dieser Art zählt (`kilowatt_hours`, `megawatt_hours`, `cubic_metres`), mindestens eine |

Ein Merkmal mit einer Zahl ist eine ganze Zahl in seiner Einheit, wie der Wert einer Regel: eine
Füllmenge von 4,9 Tonnen CO2-Äquivalent steht als 4900 in `kilograms_co2e`.

Eine Anlagenart ohne `meter` ist keine Messstelle. Das Medium steht an der Anlagenart,
Zählernummer und Einheit stehen an der einzelnen Anlage: ein Stromzähler zählt in
`kilowatt_hours` und ein großer vielleicht in `megawatt_hours`, ein Wasserzähler misst immer
Wasser.

### pflichten/

| Feld | Bedeutung |
| --- | --- |
| `validFrom` | Tag, ab dem diese Fassung gilt |
| `label` | Bezeichnung |
| `description` | die Pflicht in eigenen Worten, nie im Wortlaut der Quelle |
| `task` | Tätigkeit: `inspection` (Prüfung), `maintenance` (Wartung), `condition_assessment` (Inspektion), `function_check` (Funktionskontrolle), `visual_check` (Sichtkontrolle), `sampling` (Probenahme) |
| `origin` | Herkunft: `state_law` (staatliches Recht), `insurer_and_committee_rules` (Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse), `private_standard` (private Norm oder Richtlinie) |
| `bindingness` | Verbindlichkeit: `statute` (Gesetz oder Verordnung), `technical_rule` (technische Regel), `manufacturer` (Vorgabe des Herstellers) |
| `source` | Fundstelle: der Paragraf mit Gesetz oder Verordnung, die Norm mit Ausgabe und Abschnitt, oder die Regel der Technik. Ohne sie wird eine Pflichtart nicht aufgenommen |
| `interval` | Frist: `kind` ist `maximum` (Höchstfrist), `guide` (Richtwert) oder `none` (ohne Vorgabe); die ersten beiden nennen in `rule` den Schlüssel einer Regel, nie eine Zahl |
| `counting` | Zählweise des nächsten Termins: `from_performance` (ab dem Tag der Durchführung), `from_due` (ab dem fälligen Tag) oder `betrsichv` (nach § 14 Abs. 5 BetrSichV: Termin als Monat und Jahr, fristgerecht bis zwei Monate danach; die Regel der Frist zählt dann in Monaten oder Jahren) |
| `qualification` | `level`: `instructed_person`, `skilled_person`, `competent_person`, `approved_body`, `certified_expert` oder `accredited_laboratory`; auf Wunsch eine `note` |
| `evidence` | `kinds`, eine oder mehrere von `protocol`, `report`, `round_point`, `work_order`; bei einem Protokoll auf Wunsch das `form` |
| `retention` | Aufbewahrung: `kind` ist `years` mit der `rule` der Jahre, `until_next_inspection` oder `while_in_use` |
| `scope` | Geltungsbereich: `assetKinds` (mindestens eine), dazu auf Wunsch `conditions`, `buildingKinds` und `states`; eine leere Liste heißt: alle |

Eine Bedingung in `conditions` nennt ein `characteristic` und vergleicht auf genau eine Art:
`atLeast` oder `below` mit dem Schlüssel einer Regel in der Einheit des Merkmals, denn auch eine
Schwelle ändert sich mit dem Recht; `is` mit `true` oder `false`; `oneOf` mit Werten einer
Auswahl. Das Merkmal muss jede Fassung jeder Anlagenart im Geltungsbereich haben.

Was ein Paket zu einer Pflicht sagen darf, hängt an ihrer Herkunft (Abschnitt 5 des Konzepts):

| Herkunft | Was im Paket steht |
| --- | --- |
| Staatliches Recht | Fundstelle, Frist, Qualifikation und die Pflicht in eigenen Worten |
| Regelwerk der Unfallversicherungsträger und der staatlichen Ausschüsse | Fundstelle, Frist und Qualifikation in eigenen Worten |
| Private Norm oder Richtlinie | der Verweis auf Norm, Ausgabe und Abschnitt und die Pflicht in eigenen Worten; eine Frist nur mit dem Vermerk `legalClearance`, dass die rechtliche Prüfung sie trägt, bis dahin `"kind": "none"` |

### regeln/

```json
{
  "note": "Was diese Regeln sind und woher sie kommen.",
  "records": [
    {
      "key": "elevator_main_test_interval",
      "validFrom": "2015-06-01",
      "validUntil": null,
      "unit": "months",
      "value": 24,
      "source": "Anhang 2 Abschnitt 2 Nr. 4.1 Satz 4 BetrSichV",
      "origin": "state_law"
    }
  ]
}
```

Ein Datensatz der Regel-Engine: Wert als ganze Zahl in seiner Einheit, Gültigkeitszeitraum mit
`validUntil` bis einschließlich, `null` solange er gilt, Fundstelle und Herkunft. `scope` nennt
ein Land, etwa `"DE-BW"`; fehlt es, gilt die Regel bundesweit. An einem Tag gilt ein Schlüssel
bundesweit oder je Land, nicht beides. Für einen Tag ohne Regel gibt es keine Antwort, und eine
Lücke mitten in einer Reihe lehnt der Bau ab.

### formulare/ und vorlagen/

```json
{
  "validFrom": "2015-06-01",
  "title": "Ablesung Wasserzähler",
  "sections": [
    {
      "key": "meter",
      "title": "Zähler",
      "fields": [
        { "kind": "check_point", "key": "seal_intact", "label": "Plombe unversehrt" },
        {
          "kind": "meter_reading",
          "key": "reading",
          "label": "Zählerstand",
          "unit": "cubic_metres",
          "decimals": 3,
          "required": true
        }
      ]
    },
    {
      "key": "end",
      "title": "Abschluss",
      "fields": [{ "kind": "signature", "key": "signature", "label": "Unterschrift", "seals": true }]
    }
  ]
}
```

Ein Formular und eine Vorlage für einen Rundgang nennen `validFrom`, `title` und ihre `sections`;
Schlüssel und Fassung stehen im Dateinamen. Ein Abschnitt hat `key`, `title`, auf Wunsch `hint`
und seine `fields`. Jedes Feld hat `kind`, `key` und `label`, auf Wunsch `hint`, `required`
(muss vor der Unterschrift ausgefüllt sein) und `carry` (wird übernommen, wenn das letzte
ausgefüllte Formular die Vorlage des nächsten ist). Die Arten:

- `text`, auf Wunsch `multiline`
- `number`: eine Zahl mit `unit` und `decimals` (null bis drei Nachkommastellen)
- `measurement`: ein Messwert mit `unit` und `decimals`, auf Wunsch mit `limit`, etwa
  `{ "kind": "at_least", "rule": "hot_water_minimum" }`. Ein Grenzwert ist immer eine Regel aus
  `regeln/`, nie eine Zahl im Formular, und die Regel muss in einer Einheit zählen, in die sich der
  Messwert umrechnen lässt: Grad Celsius gegen eine Regel in Zehntelgrad.
- `choice`: eine Auswahl mit mindestens zwei `options`, je mit `value` und `label`
- `yes_no` und `photo`
- `check_point`: ein Prüfpunkt mit den Antworten "in Ordnung", "nicht in Ordnung", "entfällt"
  und "nicht möglich". Jede Antwort außer der ersten braucht beim Ausfüllen eine Bemerkung, und
  jeder Prüfpunkt braucht eine Antwort, bevor unterschrieben wird; `required: false` gibt es an
  ihm deshalb nicht.
- `meter_reading`: ein Zählerstand mit `unit` und `decimals`
- `signature`: eine Unterschrift; mit `seals` schreibt sie das Formular fest
- `group`: eine Gruppe von Feldern, die sich wiederholt, mit `repeat: "free"` und ihren `fields`

Einheiten sind `degrees_celsius`, `kilowatt_hours`, `megawatt_hours` und `cubic_metres`. Ein
Messwert, ein Prüfpunkt, ein Zählerstand und eine Unterschrift werden nie übernommen. Ein Feld eines
Pakets zeigt auf keine Anlage und keinen Raum (`about`), denn welche es gibt, weiß erst eine
Instanz; das kann nur die Vorlage eines Betreibers. Der Bau liest jedes Feld genau und prüft das
Formular danach mit der Formular-Engine des Fundaments; ein Feld, das er nicht kennt, ist ein
Befund wie überall im Paket.

### mangelklassen.json

```json
{
  "classes": [
    { "key": "minor", "label": "gering", "unsafe": false },
    { "key": "significant", "label": "erheblich", "unsafe": false },
    { "key": "dangerous", "label": "gefährlich", "unsafe": true }
  ]
}
```

Die Klassen, in die ein Mangel eingeordnet wird (Abschnitt 4.4 und 4.6 des Konzepts), in der
Reihenfolge, in der sie zur Wahl stehen. Jede hat `key`, `label` und `unsafe`: ob ein Mangel
dieser Klasse die Anlage unsicher macht. Eine Klasse aus einem Regelwerk nennt in `source`, wo sie
dort steht; eine eigene Einteilung des Pakets lässt das Feld weg. Ein Mangel hält seine Klasse als
`<paket>.<schlüssel>`, deshalb wird der Schlüssel einer Klasse nie neu vergeben.

Die Datei gibt es nur in einem Paket mit eigenen Klassen, und dann nennt sie mindestens eine. Das
Beispiel oben ist die Datei des Pakets `allgemein`: seine drei Klassen gelten für jeden Mangel,
der nicht aus einer Prüfung kommt. Ein Mangel aus einer Prüfung nimmt die Klassen des Pakets
seiner Pflichtart.

### abnahmen.json

```json
{
  "entries": [
    { "file": "pflichten/elevator_main_test.v1.json", "checkedOn": "2026-10-03" }
  ],
  "rules": [
    { "key": "elevator_main_test_interval", "validFrom": "2015-06-01", "checkedOn": "2026-10-03" }
  ],
  "classes": [
    { "key": "minor", "checkedOn": "2026-10-05" }
  ]
}
```

Jede Fassung, jede Regel und jede Mängelklasse hat genau einen Eintrag mit dem Tag, an dem sie
zuletzt gegen ihre Quelle geprüft wurde; `classes` fehlt in einem Paket ohne Mängelklassen. Liegt
der Tag mehr als ein Jahr zurück, ist der Eintrag gekennzeichnet. Wer einen Eintrag fachkundig
abnimmt, ergänzt `"accepted": { "by": "Name", "on": "2026-10-05", "sha256": "..." }`. Die
Prüfsumme ist die der Datei, bei einer Regel und bei einer Mängelklasse die ihres Datensatzes;
fehlt sie oder passt sie nicht, nennt der Bau die richtige. Ein Eintrag ohne Abnahme ist überall
gekennzeichnet, wo er gelesen wird.

## Was der Bau und die CI prüfen

- jede Datei gegen ihr Schema, und kein Feld, das das Schema nicht kennt
- keine Pflichtart ohne Fundstelle und Herkunft, keine Frist ohne Regel, keine Frist aus einer
  privaten Norm ohne den Vermerk der rechtlichen Prüfung
- jede genannte Regel gibt es, in der passenden Einheit und dort, wo die Pflichtart gilt; keine
  zwei Regeln eines Schlüssels an einem Tag und keine Lücke mitten in einer Reihe
- jeder Verweis auf eine Anlagenart, ein Merkmal, ein Formular oder ein anderes Paket hat ein Ziel
- keine Pflichtart nennt eine allgemeine Anlagenart des Pakets `allgemein`: sie steht für eine
  Anlage, deren Fachpaket noch fehlt, und trägt keine Pflichtart
- kein Schlüssel zweimal, keine Fassung fehlt in einer Reihe, keine beginnt vor der davor
- für jede Fassung, jede Regel und jede Mängelklasse ein Eintrag in `abnahmen.json`, und jede
  Abnahme passt zu ihrer Prüfsumme
- in einem Pull Request: jede Fassung, die es auf `main` gibt, ist Byte für Byte dieselbe

Was der Bau nicht prüfen kann, prüft die Abnahme: ob die Pflicht so in der Quelle steht, und ob der
Text eigene Worte sind.

Lokal:

```bash
pnpm --filter @opengewerk/haustechnik-catalogue run build
pnpm --filter @opengewerk/haustechnik-catalogue run compare origin/main
```

## Was nicht hineingehört

- Text, Tabellen und Leistungskataloge aus Normen. Das Urheberrecht an privaten Normen bleibt
  bestehen, auch wo ein Gesetz auf sie verweist (§ 5 Abs. 3 UrhG)
- Vorlagen, Checklisten und Texte eines Betreibers, auch nicht abgewandelt. Was das Projekt
  mitliefert, ist neu geschrieben und steht unter der Lizenz des Projekts
- ein Paket, das Geld kostet oder freigeschaltet wird (Leitentscheidung 10)

Der Katalog erhebt keinen Anspruch auf Vollständigkeit. Er sagt, was er abdeckt, und die
Verantwortung des Betreibers bleibt beim Betreiber.
