"""The page of a release (#136): the section of CHANGELOG.md for the version, how
the kit is installed and how the signatures are checked.

Read by the workflow "Release" with VERSION, APP_DIGEST and BACKUP_DIGEST set,
and by its test with whatever it hands in. Prints the page.
"""

import os
import re
import sys

# GitHub takes at most 125000 characters for a release page. The first version
# carries everything since the start of the repository, about 190000 on
# 14.10.2026, so the limit is real and not a margin.
LONGEST = 110_000

REPOSITORY = 'https://github.com/opengewerk/opengewerk-haustechnik'

# The changelog is wrapped for an editor, and GitHub shows every line end on a
# release page as a break, in the middle of a sentence. A line that continues
# a paragraph or a list item is joined to it; headings, new items, quotes,
# tables and code blocks stay as they are. The patterns follow Markdown, as in
# the workflow of OpenGewerk: "#78." is no heading, a heading needs a space
# after its hashes, and only "1." can start a numbered list in the middle of a
# paragraph. Inside a numbered list every number starts the next item.
BLOCK = re.compile(r'\s*(#{1,6}(\s|$)|[-*+]\s|>|\||1[.)]\s)')
NUMBERED = re.compile(r'\s*\d+[.)]\s')
STAYS_ALONE = re.compile(r'\s*(#{1,6}(\s|$)|\|)')


def section(changelog, version):
    """The text under the heading of a version, up to the next version."""
    start = changelog.index(f'## [{version}]')
    following = re.search(r'^## \[', changelog[start + 4 :], re.MULTILINE)
    text = changelog[start : start + 4 + following.start()] if following else changelog[start:]

    return text.split('\n', 1)[1].strip()


def unwrapped(markdown):
    lines = []
    fenced = False

    for line in markdown.split('\n'):
        if line.lstrip().startswith('```'):
            fenced = not fenced
            lines.append(line)
            continue

        previous = lines[-1] if lines else ''
        next_item = NUMBERED.match(line) and NUMBERED.match(previous)

        if (
            not fenced
            and line.strip()
            and not BLOCK.match(line)
            and not next_item
            and previous.strip()
            and not previous.lstrip().startswith('```')
            and not STAYS_ALONE.match(previous)
        ):
            lines[-1] = previous.rstrip() + ' ' + line.strip()
        else:
            lines.append(line)

    return '\n'.join(lines)


def body_of(changelog, version):
    """What the version brings, whole, or its introduction where the whole is too long."""
    body = unwrapped(section(changelog, version))

    if len(body) <= LONGEST:
        return body

    # Past the limit the introduction stays, what the release PR wrote above
    # the first list of the section, and the rest is a link to the changelog
    # of the tag. OpenGewerk wrote only the link and lost the introduction
    # with it.
    introduction = re.split(r'^### ', body, maxsplit=1, flags=re.MULTILINE)[0].strip()
    link = (
        'Was diese Fassung im Einzelnen bringt, ist für eine Release-Seite zu lang und steht im '
        f'[CHANGELOG]({REPOSITORY}/blob/v{version}/CHANGELOG.md).'
    )

    return f'{introduction}\n\n{link}' if introduction else link


def page(changelog, version, app_digest, backup_digest):
    body = body_of(changelog, version)

    # A version that closes a vulnerability starts its page with a hint, so
    # that nobody has to read to the end of the changelog to learn that the
    # update matters. The section "Sicherheit" in the changelog marks it.
    hint = ''
    if re.search(r'^### Sicherheit\s*$', section(changelog, version), re.MULTILINE):
        hint = (
            '> **Diese Fassung enthält eine Sicherheitskorrektur.** Was betroffen war, '
            'steht im Abschnitt „Sicherheit“ und im '
            f'[Advisory]({REPOSITORY}/security/advisories). '
            'Wer OpenGewerk Haustechnik betreibt, aktualisiert bitte bald.\n\n'
        )

    # The signature is checked against the exact identity of the run for this
    # tag, not against a pattern (opengewerk#212): Git Bash rewrites the
    # backslashes of a pattern before a Windows program sees them.
    identity = f'{REPOSITORY}/.github/workflows/release.yml@refs/tags/v{version}'

    return f"""{hint}{body}

## Installieren und aktualisieren

Das Paket `opengewerk-haustechnik-{version}.tar.gz` enthält den Ordner `opengewerk-haustechnik` mit `docker` und den Skripten des Fundaments, mit denen er startet. Zum Installieren entpacken, mit `tar --no-same-owner -xzf opengewerk-haustechnik-{version}.tar.gz`, und im Ordner `opengewerk-haustechnik` `sh docker/start.sh` aufrufen. Für ein Update das neue Paket genauso an dieselbe Stelle entpacken, die `.env` bleibt, und derselbe Befehl. Gebaut wird dabei nichts, geholt werden die Abbilder dieser Fassung, für x86_64 und ARM64:

- `ghcr.io/opengewerk/opengewerk-haustechnik:{version}` (`{app_digest}`)
- `ghcr.io/opengewerk/opengewerk-haustechnik-backup:{version}` (`{backup_digest}`)

Gebraucht werden Docker und Docker Compose ab 2.22. Neben OpenGewerk auf demselben Server läuft die Haustechnik mit eigenem Port, eigenem Hostnamen, eigener Datenbank und eigenem Namen des Compose-Projekts. Beide Abbilder sind ohne Schlüssel über Sigstore signiert. Prüfen:

```bash
cosign verify ghcr.io/opengewerk/opengewerk-haustechnik:{version} \\
  --certificate-identity {identity} \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify ghcr.io/opengewerk/opengewerk-haustechnik-backup:{version} \\
  --certificate-identity {identity} \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
"""


def main():
    changelog = open('CHANGELOG.md', encoding='utf-8').read()
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdout.write(
        page(
            changelog,
            os.environ['VERSION'],
            os.environ['APP_DIGEST'],
            os.environ['BACKUP_DIGEST'],
        )
    )


if __name__ == '__main__':
    main()
