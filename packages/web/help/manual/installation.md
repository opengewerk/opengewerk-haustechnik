# Installation

OpenGewerk Haustechnik läuft auf einem eigenen Server in Docker. Gebraucht werden Docker mit Compose, ein Checkout des Repositorys mit seinem Submodul und ein Hostname, unter dem die Instanz im Browser erreichbar ist.

## Schritt für Schritt

1. Das Repository mit Submodul holen: `git clone --recurse-submodules https://github.com/opengewerk/opengewerk-haustechnik.git`
2. Im Ordner des Repositorys starten: `sh docker/start.sh`
3. Beim ersten Mal legt das Skript `docker/.env` an, erzeugt jeden Schlüssel selbst und fragt nach der Adresse, unter der die Instanz geöffnet wird. Es gibt nur Namen aus, nie einen Wert.
4. Danach baut es das Abbild, spielt die Migrationen ein und startet die Anwendung. Sie ist nur auf dem Server selbst erreichbar, auf Port 23800.
5. Davor gehört ein Webserver mit TLS, der den Hostnamen an diesen Port weiterreicht.
6. Im Browser zeigt eine leere Instanz die Ersteinrichtung. Sie fragt nach dem Einrichtungscode aus `docker/.env` und legt den ersten Betreiber, das erste Konto und dessen zweiten Faktor an.

## Was dazugehört

- PDFs druckt ein eigener Container, der Renderer. Er braucht rund 340 MB Arbeitsspeicher und knapp 4 GB auf der Platte. Wer nie ein PDF braucht, schaltet ihn in `docker/.env` mit einem leeren `COMPOSE_PROFILES=` ab.
- Läuft auf demselben Server schon eine andere Anwendung der Familie, braucht die Haustechnik einen eigenen Hostnamen: ein Browser hält Cookies je Hostname und nicht je Port.
- Die `docker/.env` enthält die Schlüssel der Instanz. Sie gehört in die Sicherung des Servers und in keine Hände, die die Instanz nicht verwalten.
