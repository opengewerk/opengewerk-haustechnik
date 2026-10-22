<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo-dark.svg">
    <img alt="OpenGewerk" src="https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo.svg" width="420">
  </picture>
</p>

<p align="center"><strong>Self-hosted Software für Betreiber und ihre Haustechnik</strong></p>

<p align="center">
  <a href="https://github.com/opengewerk/opengewerk-haustechnik/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/opengewerk/opengewerk-haustechnik/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/opengewerk/opengewerk-haustechnik/releases"><img alt="Neueste Fassung" src="https://img.shields.io/github/v/release/opengewerk/opengewerk-haustechnik"></a>
  <a href="LICENSE"><img alt="Lizenz AGPL-3.0" src="https://img.shields.io/github/license/opengewerk/opengewerk-haustechnik"></a>
</p>

## Was ist OpenGewerk Haustechnik?

OpenGewerk Haustechnik ist ein self-hosted Open-Source-System für alle, die Gebäude betreiben und dafür eigene Haustechniker haben: Kliniken und Pflegeeinrichtungen, Bildungsträger, Wohnungsunternehmen, Kommunen, kirchliche Träger, Unternehmen mit eigener Werks- oder Haustechnik. Liegenschaften, Gebäude, Räume und technische Anlagen stehen in einem Datenmodell. Der Leitsatz lautet **Die Betreiberpflicht ist der Kern, nicht die Checkliste**: gebaut wird um die Kette Anlage, Pflicht, Termin, Vorgang, Nachweis. Welche Prüfung für welche Anlagenart gilt, in welchem Abstand, durch wen und nach welcher Vorschrift, steht in offenen Pflichtenpaketen mit Fundstelle und Gültigkeitszeitraum. Das System schlägt vor, der Betreiber entscheidet. Rundgänge und Prüfungen laufen auf dem Telefon auch ohne Netz, und ein Nachweis lässt sich nach der Unterschrift nicht mehr ändern, auch nicht vom Administrator.

Wie sie sich von CAFM-Systemen, Checklisten-Werkzeugen und Excel abgrenzt und wie sie zur Handwerkersoftware OpenGewerk steht, steht in [Funktionsumfang und Stand](docs/funktionsumfang.md).

## Stand

Phase 1, das MVP für den Pilotbetrieb, ist abgeschlossen; die neueste Fassung steht unter [Releases](https://github.com/opengewerk/opengewerk-haustechnik/releases). Der Pilotbetrieb, ein Träger mit rund zwanzig Liegenschaften, arbeitet nur noch damit; seine bisherige Anwendung ist abgeschaltet. Phase 2, die vollständigen Betreiberpflichten, ist mit der Fassung 0.2.0 erschienen; was dazu noch offen ist, steht im [Meilenstein Phase 2](https://github.com/opengewerk/opengewerk-haustechnik/milestone/3). Was jede Fassung gebracht hat, steht im [CHANGELOG](CHANGELOG.md).

## Schnellstart

Gebraucht werden Docker und Docker Compose ab 2.22. Das Paket einer Fassung liegt auf der Seite ihres [Releases](https://github.com/opengewerk/opengewerk-haustechnik/releases), mit Prüfsumme und signierten Abbildern für x86_64 und ARM64:

```bash
tar --no-same-owner -xzf opengewerk-haustechnik-<fassung>.tar.gz
cd opengewerk-haustechnik
sh docker/start.sh
```

Beim ersten Start legt das Skript `docker/.env` an, erzeugt jeden Schlüssel selbst und fragt nur nach der Adresse, unter der die Instanz im Browser erreichbar sein soll. Danach läuft sie auf `127.0.0.1:23800`:

- Im Browser fragt die Ersteinrichtung nach dem Einrichtungscode aus `docker/.env` und legt den Betreiber, das erste Konto und dessen zweiten Faktor an.
- Davor gehört ein Reverse Proxy mit TLS und eigenem Hostnamen; Vorlagen für Apache und nginx liegen unter [`docker/proxy/`](docker/proxy/).
- Jede Nacht sichert sich die Instanz selbst. Ein Update ist das neue Paket an derselben Stelle und derselbe Befehl.

Sicherung, Rückspielen, Speicher, die Kommandozeile und der Betrieb neben OpenGewerk stehen in der Anleitung zum [Betrieb](docs/betrieb.md), der Weg aus dem Quelltext in der [Entwicklung](docs/entwicklung.md).

## Dokumentation

| Was | Wo |
| --- | --- |
| Abgrenzung, Verhältnis zu OpenGewerk, Stand und Fahrplan | [`docs/funktionsumfang.md`](docs/funktionsumfang.md) |
| Betrieb: Installation, Sicherung, Rückspielen, Reverse Proxy, Kommandozeile | [`docs/betrieb.md`](docs/betrieb.md) |
| Entwicklung: Checkout mit Submodul, Datenbank, Vorschau und jeder Baustein | [`docs/entwicklung.md`](docs/entwicklung.md) |
| Planungskonzept, die verbindliche Quelle für den Funktionsumfang | [`docs/konzept/`](docs/konzept/) |
| Pflichtenpakete und wie ein Paket aufgebaut ist | [`pakete/`](pakete/README.md) |
| Welche Daten über Beschäftigte die Anwendung hält, für eine Arbeitnehmervertretung | [`docs/verfahrensbeschreibung/`](docs/verfahrensbeschreibung/Verfahrensbeschreibung.md) |
| Vorlage für einen Vertrag zur Auftragsverarbeitung, noch nicht rechtlich geprüft | [opengewerk.de](https://opengewerk.de/haustechnik/auftragsverarbeitung/) |
| Architekturentscheidungen | [`docs/adr/`](docs/adr/) |
| Änderungen je Fassung | [`CHANGELOG.md`](CHANGELOG.md) |

## Projektfamilie

- [`opengewerk`](https://github.com/opengewerk/opengewerk): die Handwerkersoftware, CRM und ERP für Handwerksbetriebe, und das Fundament, auf dem diese Anwendung steht.
- [`opengewerk-haustechnik`](https://github.com/opengewerk/opengewerk-haustechnik): diese Anwendung, für Betreiber von Gebäuden und ihre Haustechnik.
- [`opengewerk-kanzlei`](https://github.com/opengewerk/opengewerk-kanzlei): der Hub, mit dem eine Steuerberaterkanzlei ihre Mandanten aus einer Anwendung heraus bearbeitet.
- [`opengewerk-api-spec`](https://github.com/opengewerk/opengewerk-api-spec): der API-Vertrag zwischen Handwerkersoftware und Kanzlei-Hub.
- [opengewerk.de](https://opengewerk.de): die Website des Projekts.

## Hilfe und Mitmachen

Besonders wertvoll sind Rückmeldungen aus dem Betrieb: welche Prüfung im Alltag untergeht, welche Fundstelle im Pflichtenkatalog fehlt oder nicht stimmt, wo ein Rundgang heute noch auf Papier läuft. Wer vom Fach ist, ob Elektro, Brandschutz, Trinkwasser, Raumluft oder Aufzüge, kann einen Eintrag des Katalogs prüfen, ohne eine Zeile Code zu schreiben.

- Fragen und Ideen gehören in die [Discussions](https://github.com/opengewerk/opengewerk-haustechnik/discussions), kurze Fragen auch auf den [Discord-Server](https://discord.gg/NRrEvbQdxz). Zum Austausch gibt es [r/OpenGewerk](https://www.reddit.com/r/OpenGewerk/).
- Fehler und Wünsche laufen über die [Issue-Vorlagen](https://github.com/opengewerk/opengewerk-haustechnik/issues/new/choose).
- Sicherheitslücken bitte nicht als öffentliches Issue, sondern über das [private Sicherheitsformular](https://github.com/opengewerk/opengewerk-haustechnik/security/advisories/new). Das Verfahren steht in der [SECURITY.md](https://github.com/opengewerk/.github/blob/main/SECURITY.md) der Organisation.
- Wer Code beitragen will, liest die [CONTRIBUTING.md](https://github.com/opengewerk/.github/blob/main/CONTRIBUTING.md) und die [Entwicklung](docs/entwicklung.md); es gilt der [Verhaltenskodex](https://github.com/opengewerk/.github/blob/main/CODE_OF_CONDUCT.md).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Wer die Software als Dienst für andere betreibt, gibt seine Änderungen zurück.
