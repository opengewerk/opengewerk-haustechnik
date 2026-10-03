#!/bin/sh
# Starts OpenGewerk Haustechnik: the first time, every time after, and after an
# update.
#
#   sh docker/start.sh
#
# The script that does it is the foundation's (upstream/opengewerk/docker,
# ADR 0010 in the repository opengewerk), the same for every application of
# the organisation: the .env first, then the images, then the migration on its
# own, and only after it the containers. This one names the folder it works
# on, the one it lies in, with application.env, .env.example and compose.yaml.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
foundation="$here/../upstream/opengewerk/docker"

if [ ! -f "$foundation/start.sh" ]; then
  printf '%s\n' 'OpenGewerk Haustechnik: Das Fundament fehlt unter upstream/opengewerk. Nachgeholt wird es mit "git submodule update --init", beim Klonen gleich mit "git clone --recurse-submodules".' >&2
  exit 1
fi

APPLICATION_DIRECTORY=$here
export APPLICATION_DIRECTORY

exec sh "$foundation/start.sh" "$@"
