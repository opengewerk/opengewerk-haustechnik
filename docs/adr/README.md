# Architecture Decision Records

Ein Architecture Decision Record, kurz ADR, hält eine einzelne Architekturentscheidung fest: welches Problem zur Debatte stand, welche Möglichkeiten es gab, wofür man sich entschieden hat und was daraus folgt. Der Zweck ist nicht die Entscheidung selbst, die steht im Code. Der Zweck ist die Begründung, damit in zwei Jahren niemand eine Regel umstößt, ohne den Grund zu kennen, oder sie aus Unsicherheit stehen lässt, obwohl der Grund längst weggefallen ist.

Die Dokumente folgen dem [MADR-Format](https://adr.github.io/madr/), auf Deutsch.

## Zwei Orte

OpenGewerk Haustechnik steht auf demselben Fundament wie die Handwerkersoftware. Die Entscheidungen über das Fundament und über den Tech-Stack stehen deshalb nicht hier, sondern im Repository `opengewerk` unter [`docs/adr/`](https://github.com/opengewerk/opengewerk/tree/main/docs/adr), und gelten hier unverändert:

| ADR dort | Entscheidung |
| --- | --- |
| [0002](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0002-sprache-und-backend-framework.md) | TypeScript durchgängig, NestJS, ein Paket `domain` ohne I/O |
| [0003](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0003-datenbank-und-datenzugriff.md) | PostgreSQL mit Row-Level Security, Drizzle ORM, UUIDv7 |
| [0004](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0004-frontend-und-pwa.md) | React und Vite als eine PWA mit zwei Einstiegen |
| [0005](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0005-offline-sync-und-konflikte.md) | Eigener Abgleich mit Postausgang und serverautoritativer Zusammenführung |
| [0006](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0006-auth-und-mandantenfaehigkeit.md) | Eingebaute Anmeldung über better-auth, Rollen und Rechte, Trennung in der Datenbank |
| [0007](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0007-dateispeicher-dokumente-und-pdf.md) | Inhaltsadressierter Dateispeicher, PDF über Chromium in einem eigenen Container |
| [0008](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0008-plugin-system-fuer-gewerke.md) | Fachliches als Datenpakete mit Tests |
| [0009](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0009-werkzeuge-und-repo-struktur.md) | pnpm mit Turborepo, Node 24, TypeScript 7, Vitest, ESLint mit Prettier, PostgreSQL 18 |
| [0010](https://github.com/opengewerk/opengewerk/blob/main/docs/adr/0010-fundament-als-pakete.md) | Das Fundament als eigene Pakete, eingebunden als Git-Submodul auf einem festen Commit |

Ein ADR in diesem Ordner entscheidet, was nur diese Anwendung betrifft. Braucht sie etwas anderes vom Fundament, wird es dort entschieden und geändert und hier der Stand angehoben.

## Bestehende Entscheidungen

| Nummer | Titel | Status |
| --- | --- | --- |
| [0001](0001-stack-und-fundament.md) | Derselbe Stack, das Fundament als Submodul | angenommen |

## Wann ein ADR sinnvoll ist

Immer dann, wenn eine Entscheidung schwer umkehrbar ist oder mehrere Module betrifft: der Aufbau des Datenmodells vom Ort bis zum Nachweis, die Zuständigkeitsbereiche, die Festschreibung eines Nachweises, das Format der Pakete, die Regeln für den Abgleich. Eine Bibliothek auszutauschen ist dagegen meist kein ADR wert.

## Ein neues ADR anlegen

1. Die nächste freie vierstellige Nummer nehmen, die Nummern werden nie neu vergeben.
2. Datei nach dem Muster `NNNN-kurzer-titel.md` benennen, kleingeschrieben, Wörter mit Bindestrich getrennt. Die Überschrift im Dokument ist der Titel allein, ohne die Nummer davor, die steht im Dateinamen.
3. Das Dokument im MADR-Format schreiben: Kontext und Problemstellung, Entscheidungstreiber, betrachtete Optionen, Entscheidung mit Konsequenzen, Vor- und Nachteile der Optionen.
4. Den Status im YAML-Frontmatter setzen: `vorgeschlagen`, `angenommen`, `abgelehnt`, `überholt durch NNNN`. Beantwortet ein neues ADR offene Enden eines alten, ohne dessen Entscheidung umzustoßen, bekommt das alte zusätzlich das Feld `amended-by: NNNN`; sein Text bleibt unangetastet. Dazu gehören `date`, `decision-makers`, `consulted` und `informed`.
5. Die Tabelle in dieser Datei ergänzen.
6. Als Pull Request einreichen. Die Diskussion findet im Pull Request statt, nicht im Dokument.

Ein angenommenes ADR wird nicht mehr inhaltlich umgeschrieben. Ändert sich die Entscheidung, entsteht ein neues ADR, und das alte bekommt den Status `überholt durch` mit Verweis auf das neue. So bleibt die Historie lesbar. Widerspricht ein ADR dem Planungskonzept, wird das Konzept im selben Pull Request geändert: das Konzept ist die verbindliche Quelle für den Funktionsumfang, ein ADR für das Wie.
