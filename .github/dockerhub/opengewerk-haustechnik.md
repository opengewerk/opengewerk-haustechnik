![OpenGewerk](https://raw.githubusercontent.com/opengewerk/.github/main/brand/opengewerk-logo@2x.png)

**Self-hosted Software für Betreiber von Gebäuden und ihre Haustechnik.** Pflichten und Fristen, Prüfungen und Wartungen mit Nachweis, Mängel und Störmeldungen, im Büro und vor Ort, dort auch ohne Netz. Die Daten bleiben beim Betreiber. Open Source unter AGPL-3.0, durchgehend auf Deutsch, gebaut auf dem Fundament von [OpenGewerk](https://hub.docker.com/r/opengewerk/opengewerk).

## Installieren

Dieses Abbild allein ist noch keine Installation. Dazu gehören PostgreSQL, der Lauf der Migrationen, die nächtliche Sicherung und ein Renderer für die PDFs, und all das bringt das Paket von der [Release-Seite](https://github.com/opengewerk/opengewerk-haustechnik/releases) mit:

```bash
tar --no-same-owner -xzf opengewerk-haustechnik-<fassung>.tar.gz
cd opengewerk-haustechnik && sh docker/start.sh
```

Danach wird die Instanz im Browser eingerichtet. Wie sie betrieben, gesichert und aktualisiert wird, steht in der Anleitung zum [Betrieb](https://github.com/opengewerk/opengewerk-haustechnik/blob/main/docs/betrieb.md).

## Fassungen

Jede Fassung steht unter ihrer Nummer, etwa `opengewerk/opengewerk-haustechnik:0.2.0`, für x86_64 und ARM64, und `latest` zeigt auf die neueste. Die Abbilder hier sind ein Spiegel von `ghcr.io/opengewerk/opengewerk-haustechnik`, mit denselben Digests und denselben Signaturen. Das Paket holt sie aus ghcr.io.

## Signatur prüfen

Jedes Abbild ist ohne Schlüssel über Sigstore signiert, vom Release-Workflow des Repositorys:

```bash
cosign verify opengewerk/opengewerk-haustechnik:<fassung> \
  --certificate-identity https://github.com/opengewerk/opengewerk-haustechnik/.github/workflows/release.yml@refs/tags/v<fassung> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Mehr

- Quelltext, Releases und Konzept: [github.com/opengewerk/opengewerk-haustechnik](https://github.com/opengewerk/opengewerk-haustechnik)
- Website: [opengewerk.de](https://opengewerk.de/)
- Lizenz: AGPL-3.0
