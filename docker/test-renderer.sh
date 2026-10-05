#!/bin/sh
# The renderer of a running stack (opengewerk-haustechnik#96), the way the CI
# job "Betrieb über Docker Compose" asks it once the stack is up:
#
#   sh test-renderer.sh
#
# The renderer belongs to the default stack: COMPOSE_PROFILES in the template
# of the .env switches it on, and nobody has to remember it. A PDF is asked
# for from inside the application container, through the function of the
# foundation the application prints with, so the address and the token come
# from the environment of that container and appear in no log. Chromium takes
# a few seconds after its container is up, hence the retries.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

here=$(cd "$(dirname "$0")" && pwd)

compose() {
  docker compose -f "$here/compose.yaml" "$@"
}

# Into a variable first: behind a pipe a failure of "ps" would vanish, and an
# empty list would read like a renderer that is merely not there.
running=$(compose ps --status running --services)

if ! printf '%s\n' "$running" | grep -qx renderer; then
  printf 'Laufende Dienste: %s\n' "$(printf '%s' "$running" | tr '\n' ' ')" >&2
  echo 'Der Renderer läuft nicht, obwohl die Vorlage der .env ihn einschaltet (COMPOSE_PROFILES=renderer).' >&2
  exit 1
fi

echo 'Der Renderer läuft mit dem Stapel.'

compose exec -T app node --input-type=module -e '
  const { readRendererConfiguration, rendererFor } = await import("@opengewerk/platform-server")
  const render = rendererFor(readRendererConfiguration())
  let pdf = null
  for (let attempt = 1; pdf === null; attempt++) {
    try {
      pdf = await render({ html: "<h1>OpenGewerk Haustechnik</h1><p>Prüfprotokoll</p>" })
    } catch (error) {
      if (attempt === 30) {
        console.error(`Der Renderer hat nach 30 Versuchen kein PDF geliefert: ${error.message}`)
        process.exit(1)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  const head = new TextDecoder().decode(pdf.subarray(0, 5))
  if (head !== "%PDF-") {
    console.error(`Der Renderer hat kein PDF geliefert, die Antwort beginnt mit: ${head}`)
    process.exit(1)
  }
  console.log(`PDF vom Renderer: ${pdf.byteLength} Bytes`)
'
