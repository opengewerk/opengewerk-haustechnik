# Betrieb

Wie eine Instanz installiert, gesichert, zurückgespielt und aktualisiert wird, was davor gehört und wie sie neben OpenGewerk läuft. Den kürzesten Weg zur laufenden Instanz zeigt die [README](../README.md#schnellstart).

Eine Installation startet mit einem Befehl, aus einem Checkout mit dem Submodul (siehe [Entwicklung](entwicklung.md)):

```bash
sh docker/start.sh
```

Beim ersten Mal legt das Skript `docker/.env` an, erzeugt jeden Schlüssel und fragt nach der Adresse, unter der die Instanz im Browser geöffnet wird; ohne Terminal kommt sie aus `HAUSTECHNIK_ADDRESS`. Ausgegeben werden nur Namen, nie ein Wert. Danach baut es das Abbild, spielt die Migrationen ein und startet erst dann die Anwendung, in der Reihenfolge eines Updates. Eine leere Instanz zeigt im Browser die Ersteinrichtung, die nach dem Einrichtungscode aus `docker/.env` fragt und den Betreiber, das erste Konto und dessen zweiten Faktor anlegt. Die Skripte dahinter sind die des Fundaments (`upstream/opengewerk/docker`); was sie über diese Anwendung wissen müssen, steht in `docker/application.env` und `docker/compose.yaml`.

Ein Update ist derselbe Befehl, nach `git pull` und `git submodule update --init`. Er baut das Abbild neu, migriert und tauscht erst danach die laufenden Container; scheitert die Migration, arbeitet die Instanz auf dem Stand davor weiter.

**Aus einer Fassung, ohne Quelltext.** Zu jeder Fassung gibt es auf der Seite des Releases das Paket `opengewerk-haustechnik-<fassung>.tar.gz` mit seiner Prüfsumme: der Ordner `docker` und die Skripte des Fundaments, mit denen er startet, und in seiner `compose.yaml` steht die Fassung an der Stelle von `source`. Entpackt mit `tar --no-same-owner -xzf opengewerk-haustechnik-<fassung>.tar.gz` und im Ordner `opengewerk-haustechnik` gestartet mit demselben `sh docker/start.sh`, holt es die Abbilder dieser Fassung für x86_64 und ARM64 aus ghcr.io, statt zu bauen; ein Update ist das neue Paket an derselben Stelle und derselbe Befehl, die `.env` bleibt. Beide Abbilder sind ohne Schlüssel über Sigstore signiert, und seit 0.2.0 nennt die `compose.yaml` eines Pakets sie mit ihrem Digest, genau die Bytes, die der Release gebaut und signiert hat (opengewerk#687). Bevor `start.sh` sie holt, prüft es mit `cosign` ihre Signatur gegen den Workflow "Release" dieser Fassung; schlägt das fehl, wird nichts geholt und nichts gestartet. Ohne `cosign` auf der Maschine sagt der Start, wie man von Hand prüft, und läuft weiter. Ein solches Paket startet immer seine eigene Fassung: `HAUSTECHNIK_VERSION` in der `.env` gilt nur für einen Checkout. Den Release schreibt der Workflow "Release" zu einem Tag `v<fassung>` auf `main`, das Paket packt `docker/pack-kit.sh`, und der Lauf "Installationspaket" der CI packt und startet es bei jedem Pull Request ohne den Quelltext daneben. Ein zweiter Job spiegelt beide Abbilder mit ihren Signaturen nach Docker Hub, als `opengewerk/opengewerk-haustechnik` und `opengewerk/opengewerk-haustechnik-backup`, dort mit `latest` für die neueste Fassung (#494). Das Paket holt weiter aus ghcr.io, denn Docker Hub begrenzt anonyme Pulls; eine ältere Fassung holt der Workflow "Docker Hub" von Hand nach.

**Dateien und PDFs.** Was ein Betreiber ablegt, liegt im Dateispeicher, einem eigenen Volume (`files`), unter der Prüfsumme seines Inhalts; die Datenbank hält dazu je Betreiber eine Zeile. Jede Sicherung nimmt Datenbank und Dateispeicher zusammen mit, und das Rückspielen prüft jede Datei gegen ihren Namen. Ein PDF druckt der Renderer, ein Chromium in einem eigenen Container, auf derselben festen Fassung wie im Fundament. Er hängt in einem eigenen, internen Netz allein mit der Anwendung und erreicht weder die Datenbank noch das Internet (opengewerk#686). Er startet von Haus aus mit, weil die Vorlage `COMPOSE_PROFILES=renderer` setzt, und braucht rund 340 MB Arbeitsspeicher und knapp 4 GB auf der Platte. Wer nie ein PDF braucht, schaltet ihn in `docker/.env` mit einem leeren `COMPOSE_PROFILES=` ab; alles andere läuft dann weiter, und wer ein PDF verlangt, bekommt einen Satz, der das sagt. Eine Installation von vor dem Renderer bekommt seine beiden Zeilen beim nächsten `sh docker/start.sh` in ihre `.env`. Die Bytes einer Datei, auf die kein Betreiber mehr verweist und die seit einem Tag niemand abgelegt hat, nimmt die Anwendung einmal am Tag aus dem Speicher, dazu Reste abgebrochener Schreibvorgänge (opengewerk#657); eine Sicherung, die eine solche Datei noch enthält, bringt sie mit ihrer Zeile zurück, und eine ohne Zeile geht am nächsten Tag wieder. Eine geschlossene Instanz räumt nicht auf.

Die Sicherung läuft jede Nacht von selbst, zu der Uhrzeit, die der Bereich der Instanz festlegt, und holt eine verpasste nach. Von Hand, etwa vor einem Update, und zum Rückspielen:

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup backup.sh
docker compose -f docker/compose.yaml --profile backup run --rm backup restore.sh latest
docker compose -f docker/compose.yaml --profile backup run --rm backup verify.sh latest
```

Wie ein Archiv verschlüsselt wird und wohin es gehört, steht in `docker/.env.example`. Die Archive heißen nach der Datenbank (`haustechnik-<zeit>.tar.gz`), ein Ziel lässt sich also mit einer Installation von OpenGewerk teilen: jede Anwendung findet, behält und löscht nur ihre eigenen. Das gilt auch für ein Archiv, das statt `latest` mit seinem Namen genannt wird: eines der anderen Anwendung lehnen `restore.sh` und `verify.sh` ab, bevor sie die Datenbank fragen.

Zurückgespielt wird nur ein Archiv, das diese Instanz selbst geschrieben hat: jede Sicherung hält Name und Prüfsumme ihres Archivs im Volume `backup-status` fest, und `restore.sh` und `verify.sh` prüfen ein Archiv dagegen, bevor sie es lesen. Ist eine Installation verschlüsselt, lehnen sie ein unverschlüsseltes Archiv ab. Auf einer neuen Maschine, die dieses Verzeichnis nicht hat, und für Archive von vor dieser Fassung steht der Schalter `--skip-origin-check` vor dem Archiv; er hebt beide Prüfungen auf, also nur für ein Archiv, dessen Herkunft man kennt:

```bash
docker compose -f docker/compose.yaml --profile backup run --rm backup restore.sh --skip-origin-check <archiv>
```

Einzelheiten in der Anleitung zum Betrieb des Fundaments, Abschnitt [„Sicherung und Rückspielen“](https://github.com/opengewerk/opengewerk/blob/main/docs/betrieb.md#sicherung-und-rückspielen).

**Speicher.** Die Anwendung hat eine Speichergrenze von 4 GB, ihr Heap endet bei drei Vierteln davon. Läuft sie voll, startet Docker die Anwendung neu, statt dass der Kernel irgendeinen Prozess beendet, womöglich die Datenbank. Auf einer kleineren Maschine gehört die Grenze unter ihren Speicher, mit Platz für Datenbank und Renderer, in `docker/.env`, etwa `HAUSTECHNIK_MEMORY_LIMIT=2g`. Jeder Dienst gibt dazu die Rechte von root ab, die Docker sonst lässt; wo einer etwas behält, steht der Grund an ihm in `docker/compose.yaml`.

**Neben OpenGewerk auf einem Server.** Die Haustechnik hat ein eigenes Compose-Projekt (`opengewerk-haustechnik`), einen eigenen Port (23800 statt 23700), eine eigene Datenbank in einem eigenen PostgreSQL-Container und eigene Volumes, und ihre Variablen beginnen mit `HAUSTECHNIK_`. Davor gehört ein eigener Hostname: ein Browser hält Cookies je Hostname und nicht je Port, zwei Anwendungen unter einem Namen meldeten sich gegenseitig ab.

Die Kommandozeile ist der Rückweg, wenn sich jemand ausgesperrt hat, und der einzige Weg auf einem Rechner ohne Browser. Das Passwort eines neuen Kontos fragt jeder Befehl verdeckt ab; aus einem Skript kommt es aus `HAUSTECHNIK_PASSWORD`, nie aus einem Argument, denn ein Argument steht in der Prozessliste und im Verlauf der Shell.

```bash
docker compose -f docker/compose.yaml exec app node dist/add-staff.js <kennung-des-betreibers> <e-mail> "<name>" technician
docker compose -f docker/compose.yaml exec app node dist/reset-password.js <e-mail>
docker compose -f docker/compose.yaml exec app node dist/appoint-operator.js <e-mail>
docker compose -f docker/compose.yaml exec app node dist/add-tenant.js "<name des betreibers>" <e-mail> "<name der leitung>"
```

Der Lauf der Fristen läuft in der Anwendung, zehn Sekunden nach dem Start und danach jede Minute, und führt die Termine der Pflichten (#25); im Büro sagt `GET /deadlines/run`, wann er einen Betreiber zuletzt durchgegangen ist. Die Dienste für Dateien, PDFs, E-Mail und Push liegen seit #23 im Fundament; E-Mail und Push sind seit #126 gebunden (Abschnitt [Benachrichtigungen](entwicklung.md#benachrichtigungen) der Entwicklung), ihre Jobs laufen wie der Lauf der Fristen jede Minute. Dateispeicher und Renderer sind seit #96 gebunden: der Server nimmt den Inhalt einer Datei unter `PUT /files/<prüfsumme>` von dem an, der Dokumente ablegen darf, und reicht den Renderer an alles, was druckt; die Dokumente, die Etiketten und das PDF eines Nachweises bauen darauf auf. Mailserver, E-Mail und Push kommen mit den Benachrichtigungen, ebenfalls in Phase 1 und mit ihren Zeilen in der `.env`. Bis dahin geht eine Einladung als Link hinaus.

## Reverse Proxy

Vor die Anwendung gehört ein Reverse Proxy mit TLS; sie lauscht absichtlich nur auf `127.0.0.1:23800`. Zwei Vorlagen liegen unter `docker/proxy/`, auch im Installationspaket: [`apache.conf`](../docker/proxy/apache.conf) für Apache 2.4 und [`nginx.conf`](../docker/proxy/nginx.conf) für nginx. Jede ist für sich vollständig, mit der Weiterleitung von HTTP auf HTTPS, dem Zertifikat unter dem Pfad, den certbot anlegt, dem Proxy samt Host, Protokoll und `X-Forwarded-For`, den Grenzen je Pfad und einer Zeitgrenze für lange Drucke. Wie sie eingesetzt wird, steht in ihrem Kopf, und jede Zeile, die zur eigenen Instanz passen muss, trägt einen Kommentar. Der Name darin ist `haustechnik.example.org`: neben OpenGewerk braucht die Haustechnik einen eigenen Hostnamen (siehe oben). Die Gründe stehen ausführlich in der Anleitung zum Betrieb des Fundaments, Abschnitt [„Reverse Proxy“](https://github.com/opengewerk/opengewerk/blob/main/docs/betrieb.md#reverse-proxy); hier steht, was man beim Einrichten wissen muss.

**`X-Forwarded-For` wird ergänzt, nicht durchgereicht.** Die Grenzen je Adresse, etwa für falsche Passwörter, zählen nach dem letzten Eintrag dieses Headers, und das ist der, den der Proxy selbst anhängt. Reicht er den Header nur weiter, wählt ein Client seine Adresse selbst, und alle Anfragen ohne den Header teilen sich einen Zähler: dann sperren wenige Fehlversuche eines Fremden die Anmeldung für alle. Apache mit `ProxyPass` und Caddy hängen von sich aus an, nginx nur mit `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. Die Vorlage für nginx hat die Zeile im `server`-Block; bekommt dort ein `location`-Block ein eigenes `proxy_set_header`, erbt er sie nicht mehr. Ob es stimmt, zeigt nach einer Anmeldung „Konto“ unter „Angemeldete Geräte“: dort steht beim eigenen Gerät die Netzadresse, von der es kam.

**Der Proxy begrenzt Anfragen je Pfad.** Überall reichen 2 MB, groß wird es nur, wo eine Datei kommt. Dort setzt die Anwendung die eigentliche Grenze selbst, mit einem Satz dazu, und liest eine Datei erst, wenn feststeht, wer sie schickt:

| Pfad | Anwendung | Proxy |
| --- | --- | --- |
| `/files/`, Dokumente und andere Dateien der Ablage | 25 MB | 50 MB |
| `POST /sync`, der Postausgang eines Geräts | 8 MB je Übertragung | 50 MB |
| `/imports/`, Import aus Tabellen | 10 MB die Tabelle, 16 MB mit ihrer Zuordnung | 50 MB |
| `PUT /fault-reports/photos/<prüfsumme>`, das Foto einer Meldung | 25 MB | 50 MB |
| `PUT /qualifications/certificates/<prüfsumme>`, der Nachweis einer Qualifikation | 25 MB | 50 MB |
| `PUT /fault-reports/by-label/<code>/photo/<beleg>`, das Foto einer Meldung über ein Etikett | 10 MB | 12 MB |

Das Foto über ein Etikett kommt ohne Anmeldung; die Anwendung nimmt es nur zu einer Meldung an, die gerade angekommen ist, und der Proxy lässt dort nur knapp mehr durch als sie. Was der Proxy ablehnt, kommt als 413 ohne Satz an, und ein Postausgang, der daran scheitert, bleibt hängen, bis der Proxy es durchlässt. nginx nimmt ohne Angabe nur 1 MB an. Apache wendet `LimitRequestBody` auf eine Anfrage, die es mit `ProxyPass` weiterreicht, gar nicht an; die Vorlage vergleicht deshalb mit mod_rewrite die Länge, die eine Anfrage angibt.

**Ein Druck darf dauern.** Der Renderer bekommt für ein PDF bis zu 60 Sekunden, und das Buch einer Anlage oder das Verzeichnis mit den Nachweisen dahinter druckt jeden Nachweis, der noch keinen Druck hat. nginx bricht ohne Angabe nach 60 Sekunden mit 504 ab, Apache nach seinem `Timeout`, von Haus aus ebenfalls 60 Sekunden; die Vorlagen warten 600.

**Sicherheits-Header und Cache sind Sache der Anwendung.** Sie setzt `Strict-Transport-Security`, `Content-Security-Policy` und die übrigen Sicherheits-Header selbst, ein zweiter aus dem Proxy wäre falsch und nicht strenger. Der Proxy setzt keinen davon ein zweites Mal, ersetzt `Cache-Control` nicht und speichert keine Antwort zwischen; setzt er über eine globale Vorgabe Header, nimmt er sie für diese Instanz heraus. Ob jeder genau einmal ankommt, zeigt `curl -sI https://<adresse>/`.
