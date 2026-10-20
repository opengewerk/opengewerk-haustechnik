Die Sicherung zu [OpenGewerk Haustechnik](https://hub.docker.com/r/opengewerk/opengewerk-haustechnik), der self-hosted Software für Betreiber von Gebäuden und ihre Haustechnik. Sie sichert jede Nacht Datenbank und Dateispeicher einer Installation in ein Archiv, auf Wunsch mit [age](https://age-encryption.org/) verschlüsselt, prüft ein Archiv und spielt es zurück.

Einzeln ist dieses Abbild nicht gedacht: das Paket von der [Release-Seite](https://github.com/opengewerk/opengewerk-haustechnik/releases) startet es mit, und wie man damit sichert und zurückspielt, steht in der Anleitung zum [Betrieb](https://github.com/opengewerk/opengewerk-haustechnik/blob/main/docs/betrieb.md).

Fassungen und Signaturen wie bei `opengewerk/opengewerk-haustechnik`: jede Fassung unter ihrer Nummer, für x86_64 und ARM64, `latest` für die neueste, ein Spiegel von `ghcr.io/opengewerk/opengewerk-haustechnik-backup` mit denselben Digests und denselben Signaturen. Lizenz: AGPL-3.0.
