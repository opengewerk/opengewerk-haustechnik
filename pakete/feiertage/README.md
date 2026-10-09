# Paket Gesetzliche Feiertage

Die gesetzlichen Feiertage je Land (Abschnitt 2.9 des Planungskonzepts): "Gesetzliche Feiertage je
Land sind Regeln wie alle anderen, mit Fundstelle und Gültigkeit, damit der Plan eines Rundgangs sie
auslassen kann." Ein Feiertag ist eine Regel unter `regeln/`, mit dem Land als `scope`. Ein Tag, der
jedes Jahr wiederkommt, steht in der Einheit `month_day`, als Monat mal hundert plus Tag (1003 ist
der 3. Oktober); einer, der mit Ostern wandert, in `days_from_easter`, gezählt ab Ostersonntag (-2
ist Karfreitag, 60 Fronleichnam). Die Notiz einer Regel ist der Name des Feiertags, so steht er am
Plan.

Ein Land, für das das Paket keine Feiertage hat, hat keine: Der Plan einer Liegenschaft dort bietet
die Wahl "Gesetzliche Feiertage auslassen" nicht an, statt Feiertage zu erfinden. Jeder Feiertag
steht beim Land, auch der Tag der Deutschen Einheit, der bundesweit gilt: An einem Tag gilt ein
Schlüssel bundesweit oder je Land, nicht beides, und so bleibt jedes Land für sich vollständig.

## Baden-Württemberg

`regeln/baden-wuerttemberg.json`, nach § 1 des Feiertagsgesetzes (FTG) in der Fassung vom 8. Mai
1995 (GBl. S. 450), zuletzt geändert am 1. Dezember 2015 (GBl. S. 1034), dazu Art. 2 Abs. 2 des
Einigungsvertrags für den 3. Oktober. Gültig ab dem Tag der Fassung, der 3. Oktober ab 1990.

| Schlüssel | Feiertag | Tag |
| --- | --- | --- |
| `new_year` | Neujahr | 1. Januar |
| `epiphany` | Erscheinungsfest | 6. Januar |
| `good_friday` | Karfreitag | 2 Tage vor Ostersonntag |
| `easter_monday` | Ostermontag | 1 Tag nach Ostersonntag |
| `labour_day` | 1. Mai | 1. Mai |
| `ascension_day` | Christi Himmelfahrt | 39 Tage nach Ostersonntag |
| `whit_monday` | Pfingstmontag | 50 Tage nach Ostersonntag |
| `corpus_christi` | Fronleichnam | 60 Tage nach Ostersonntag |
| `unity_day` | Tag der Deutschen Einheit | 3. Oktober |
| `all_saints_day` | Allerheiligen | 1. November |
| `christmas_day` | Erster Weihnachtstag | 25. Dezember |
| `second_christmas_day` | Zweiter Weihnachtstag | 26. Dezember |

Gründonnerstag, Reformationstag und Buß- und Bettag sind in Baden-Württemberg kirchliche Feiertage
nach § 2 FTG und keine gesetzlichen; sie stehen nicht im Paket. Ein einmaliger Feiertag, wie der
Reformationstag 2017, käme als eigene Regel mit `validFrom` und `validUntil` am selben Tag.
