# Konzept

Hier liegen die Planungsdokumente von OpenGewerk Haustechnik. Sie sind die verbindliche Quelle für den Funktionsumfang, auch sobald es Code gibt: was gebaut wird, steht zuerst hier.

| Datei | Inhalt |
| --- | --- |
| [`Planungskonzept.md`](Planungskonzept.md) | Vollständiges Planungskonzept: Leitentscheidungen, Architektur-Grundbausteine, Funktionsumfang, Pflichtenpakete, Schnittstellen, Rollen, rechtliche Anforderungen, Sicherheit und Mitbestimmung, Fahrplan, Vergleich mit bestehenden Lösungen, offene Entscheidungen |

Das Konzept der Handwerkersoftware liegt im Repository [`opengewerk`](https://github.com/opengewerk/opengewerk) unter `docs/konzept/`. Die Architekturentscheidungen, auf denen beide Anwendungen stehen, liegen dort unter `docs/adr/`.

## Wie diese Dokumente geändert werden

Änderungen laufen wie Codeänderungen über einen Pull Request, nicht über direkte Pushes auf `main`. Damit bleibt nachvollziehbar, wann eine Entscheidung gefallen ist und warum.

Für einen Pull Request an diesen Dokumenten gilt:

- Die Versionsnummer in der Kopfzeile des Dokuments anheben und das Änderungsprotokoll am Dateiende ergänzen.
- Widersprüche zu anderen Abschnitten mit auflösen, statt eine Korrektur an einer zweiten Stelle danebenzuschreiben.
- Jeder Punkt hat eine Phase. Wer in den Abschnitten 2 bis 10 etwas einträgt, trägt seine Phase im selben Zug in Abschnitt 12 ein, in der Tabelle oder in der Zuordnung darunter.
- Rechtliche Aussagen brauchen eine Fundstelle: Paragraf und Gesetz, oder Norm mit Ausgabe und Abschnitt, keine allgemeine Einschätzung. Normtexte werden nicht wiedergegeben.

Wer erst einmal nur eine Frage oder eine Idee hat, ist in den [Discussions](https://github.com/opengewerk/opengewerk-haustechnik/discussions) besser aufgehoben als in einem Pull Request.
