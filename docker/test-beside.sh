#!/bin/sh
# This application beside an OpenGewerk on one machine (opengewerk-haustechnik
# #15), step by step as the CI job "Neben OpenGewerk auf einem Server" takes
# them:
#
#   sh test-beside.sh <step>
#
# Both stacks run at once, each with its project, port, database and volumes;
# a session of the one is none at the other; and taking this one down with its
# volumes leaves the other as it was. OpenGewerk comes from the submodule,
# built from the commit it points at and started with its own scripts, without
# its renderer, which this check does not need. This application starts the
# way an installation does, its renderer included (opengewerk-haustechnik#96),
# so that taking it down is taking all of it down.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
trades=$(cd "$here/../upstream/opengewerk/docker" && pwd)
temp=${STACK_TEMP:-${RUNNER_TEMP:-/tmp}}
step=${1:-}

ours_port=23800
theirs_port=23700

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

ours() {
  docker compose -f "$here/compose.yaml" "$@"
}

theirs() {
  docker compose -f "$trades/compose.yaml" "$@"
}

healthy() {
  answer=$(curl --silent --fail "http://127.0.0.1:$1/health") ||
    fail "Auf Port $1 antwortet keine Instanz."
  echo "Port $1: ${answer}"
}

# Waits until the application on a port answers again, after a restart.
answers_again() {
  for attempt in $(seq 1 20); do
    if curl --silent --fail "http://127.0.0.1:$1/health" | grep -q bereit; then
      return 0
    fi
    sleep 3
  done

  fail "Die Anwendung auf Port $1 wird nach dem Neustart nicht gesund."
}

# The volumes a project owns, one name per line, sorted.
volumes_of() {
  docker volume ls --quiet --filter "label=com.docker.compose.project=$1" | sort
}

# The project names Compose takes from the two files.
ours_project=$(ours config --no-interpolate --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')
theirs_project=$(theirs config --no-interpolate --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')

# An account of this application with a password, for the session.
probe_tenant='01931c00-0000-7000-8000-0000000000b1'
probe_email='nebeneinander@probe.example.de'
probe_password='ein-ordentlich-langes-probepasswort'

case "$step" in

theirs)
  # OpenGewerk the way an installation starts, from its own folder, with its
  # .env made first so that the renderer can be switched off in it, the way
  # its template says: an empty COMPOSE_PROFILES, not a deleted line.
  APPLICATION_DIRECTORY=$trades OPENGEWERK_ADDRESS="http://127.0.0.1:$theirs_port" sh "$trades/setup.sh"
  sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$trades/.env"
  APPLICATION_DIRECTORY=$trades sh "$trades/start.sh"
  ;;

ours)
  HAUSTECHNIK_ADDRESS="http://127.0.0.1:$ours_port" sh "$here/start.sh"
  ;;

apart)
  healthy "$theirs_port"
  healthy "$ours_port"

  echo "Projekte: ${theirs_project} und ${ours_project}"
  test "${theirs_project}" != "${ours_project}"

  volumes_of "$theirs_project" > "$temp/theirs-volumes.txt"
  volumes_of "$ours_project" > "$temp/ours-volumes.txt"
  echo "Volumes von ${theirs_project}: $(tr '\n' ' ' < "$temp/theirs-volumes.txt")"
  echo "Volumes von ${ours_project}: $(tr '\n' ' ' < "$temp/ours-volumes.txt")"
  test -s "$temp/theirs-volumes.txt"
  test -s "$temp/ours-volumes.txt"

  shared=$(comm -12 "$temp/theirs-volumes.txt" "$temp/ours-volumes.txt")
  [ -z "$shared" ] || fail "Beide Stapel teilen sich ein Volume: ${shared}"
  echo 'Beide antworten, jeder auf seinem Port, mit eigenen Volumes.'
  ;;

session)
  # A Betreiber written with SQL gets its roles when the application starts
  # again, and add-staff checks the role against them.
  ours exec -T postgres psql --username postgres --dbname haustechnik --quiet \
    --command "insert into tenants (id, name) values ('$probe_tenant', 'Nebeneinander GmbH') on conflict do nothing"
  ours restart app
  answers_again "$ours_port"
  HAUSTECHNIK_PASSWORD=$probe_password ours exec -T -e HAUSTECHNIK_PASSWORD app \
    node dist/add-staff.js "$probe_tenant" "$probe_email" 'Nora Nebeneinander' technician

  status=$(curl --silent --output /dev/null --dump-header "$temp/sign-in-headers.txt" --write-out '%{http_code}' \
    --header 'Content-Type: application/json' --header "Origin: http://127.0.0.1:$ours_port" \
    --data "{\"email\":\"$probe_email\",\"password\":\"$probe_password\"}" \
    "http://127.0.0.1:$ours_port/api/auth/sign-in/email")
  echo "Anmeldung bei der Haustechnik: ${status}"
  test "${status}" = 200

  # The cookie of the session belongs to the host name it came from and to no
  # other: without a Domain attribute a browser sends it to exactly that name.
  # Two applications under two host names therefore never see each other's
  # session, whatever their cookies are called.
  # Assigned before it is checked: behind the pipe a grep that found nothing
  # would not stop the step.
  cookie=$(grep -i '^set-cookie: [^=]*session_token=' "$temp/sign-in-headers.txt" | head -n 1 | tr -d '\r')
  [ -n "$cookie" ] || fail 'Die Anmeldung hat kein Sitzungs-Cookie gesetzt.'
  echo "Cookie: $(printf '%s' "$cookie" | sed 's/=[^;]*;/=…;/')"
  if printf '%s' "$cookie" | grep -qi 'domain='; then
    fail 'Das Sitzungs-Cookie nennt eine Domain und gälte damit auch für andere Hostnamen.'
  fi

  # And handed to OpenGewerk, the session is none: each application keeps its
  # sessions in its own database.
  pair=$(printf '%s' "$cookie" | sed 's/^[Ss]et-[Cc]ookie: //; s/;.*//')
  theirs_session=$(curl --silent --header "Cookie: $pair" "http://127.0.0.1:$theirs_port/api/auth/get-session")
  ours_session=$(curl --silent --header "Cookie: $pair" "http://127.0.0.1:$ours_port/api/auth/get-session")
  echo "Dieselbe Sitzung bei OpenGewerk: ${theirs_session}"
  test "${theirs_session}" = 'null'
  printf '%s' "$ours_session" | grep -q "$probe_email" ||
    fail 'Die Haustechnik erkennt ihre eigene Sitzung nicht wieder.'
  echo 'Die Sitzung gilt bei der Haustechnik und nicht bei OpenGewerk.'
  ;;

remove-ours)
  before=$(theirs ps --quiet | sort | tr '\n' ' ')
  # Every profile, so that the renderer goes with the rest: a profile named on
  # the command line stands in place of the one the .env switches on, and
  # "down" with the profile of the backup alone would leave the renderer
  # running, on a network that cannot be removed under it.
  ours --profile '*' down --volumes --remove-orphans

  remaining=$(volumes_of "$ours_project")
  [ -z "$remaining" ] || fail "Vom Stapel der Haustechnik sind Volumes geblieben: ${remaining}"

  left=$(docker ps --all --quiet --filter "label=com.docker.compose.project=$ours_project")
  [ -z "$left" ] || fail "Vom Stapel der Haustechnik sind Container geblieben: ${left}"

  volumes_of "$theirs_project" > "$temp/theirs-volumes-after.txt"
  diff "$temp/theirs-volumes.txt" "$temp/theirs-volumes-after.txt"
  test "$(theirs ps --quiet | sort | tr '\n' ' ')" = "${before}"
  healthy "$theirs_port"
  echo 'Die Haustechnik ist samt Renderer und Volumes entfernt, OpenGewerk läuft unverändert weiter.'
  ;;

*)
  fail "Unbekannter Schritt: \"${step}\". Die Schritte stehen in $0."
  ;;
esac
