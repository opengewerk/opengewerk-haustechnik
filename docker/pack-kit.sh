#!/bin/sh
# Packs the installation kit of a version (#136): the folder docker/ of this
# application and what the start of the foundation needs beside it, without
# tests, no .env and nothing built, under the root opengewerk-haustechnik/. The
# version stands in place of "source" at every image of this project, so that
# "sh docker/start.sh" and every docker compose command in it pull that version
# instead of building, and every entry belongs to root. With the digests the
# release pushed, each image is named "<image>:<version>@sha256:..." (#687 in
# the repository opengewerk), and start.sh checks its signature before it pulls
# it; kit-images.sh of the foundation writes both.
#
#   sh docker/pack-kit.sh <version> <folder for the kit> [<image>@sha256:<digest> ...]
#
# The workflow "Release" packs with it for a tag, with the digests; the CI packs
# with it for every pull request, without, and starts what comes out, without
# the source beside it.
# Leaves opengewerk-haustechnik-<version>.tar.gz and its .sha256 in the folder.

set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

version=${1:-}
out=${2:-}

[ -n "$version" ] || fail 'Die Fassung fehlt, etwa: sh docker/pack-kit.sh 0.1.0 paket'
[ -n "$out" ] || fail 'Der Ordner für das Paket fehlt, etwa: sh docker/pack-kit.sh 0.1.0 paket'
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
  fail "Die Fassung $version hat nicht die Form 1.2.3."
shift 2

root=$(git rev-parse --show-toplevel)
name=opengewerk-haustechnik
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/$name/upstream/opengewerk"

# The folder as committed, without its tests and without this script.
git -C "$root" archive HEAD -- docker LICENSE \
  ':(exclude)docker/test-*.sh' ':(exclude)docker/compose.test.yaml' \
  ':(exclude)docker/pack-kit.sh' |
  tar -x -C "$work/$name"

# What docker/start.sh hands on to (ADR 0010 in the repository opengewerk):
# the start and the setup of the foundation, the initialisation of the
# database the compose file mounts, and the folder of the backup image, which
# the compose file names for a build. The compose file, the names and the
# tests of the foundation belong to the other application and stay out.
git -C "$root/upstream/opengewerk" archive HEAD -- \
  docker/start.sh docker/setup.sh docker/postgres-init docker/backup |
  tar -x -C "$work/$name/upstream/opengewerk"

sh "$root/upstream/opengewerk/docker/kit-images.sh" "$work/$name/docker/compose.yaml" HAUSTECHNIK "$version" "$@"

mkdir -p "$out"
kit="$name-$version.tar.gz"

# Every entry belongs to root, by number and without a name. tar otherwise
# writes down the account that packs, and whoever unpacks as root gets exactly
# that: every file and folder handed to the local account with the same id
# (opengewerk#214).
tar --owner=0 --group=0 --numeric-owner -czf "$out/$kit" -C "$work" "$name"

# Read back from the archive rather than trusted to the options. An empty
# listing has no foreign owner in it either, so it fails too.
listing=$(tar --numeric-owner -tvzf "$out/$kit")
foreign=$(printf '%s\n' "$listing" | awk '$2 != "0/0"')

if [ -z "$listing" ] || [ -n "$foreign" ]; then
  printf '%s\n' "Im Paket gehört nicht jeder Eintrag root (0/0):" "$foreign" >&2
  exit 1
fi

(cd "$out" && sha256sum "$kit" > "$kit.sha256")
printf '%s\n' "$out/$kit"
