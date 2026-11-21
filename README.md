# ask-kit-release

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool say
how close a repository is to a public release and where its last release stands. It runs a
release-readiness audit with no model for the checks, reads the version, tags, GitHub release
and published packages, and prepares a release when asked: version bump, changelog entry, tag.

Questions from its bench, of the kinds agents answer by hand around releases:

- Is the version the same everywhere it is written, and is it all released: newest tag, npm version, GitHub release?
- Is this repository release-ready, and what blocks it from going public?
- Does anything in the repository look like a secret, such as a database URL with a password? Which file and line?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up), `git` and `node`. `gh` is used for
GitHub's side when it is installed and signed in; without it those checks are reported as not run.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-release
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-release        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-release --yes  # installs and enables it
```

Restart your agents so `ask` lists `release`. The kit answers about the repository your agent works
in; a question that names another folder is answered there.

Settings, all optional. The kit carries its own release files in `templates/` and the script that
copies them in `bin/scaffold` (Python 3); the two settings below only replace them. `PRIVATE_WORDS` is a file of words for the private-word check (one extended
regex per line, kept outside every repository; without it that check reports "not run", which
blocks the audit decision). `TEMPLATES` is a folder of release files (LICENSE, SECURITY.md, CI
workflows and the like) that missing files are copied from; default `templates/` in the kit. `SCAFFOLD`
is a script that adds every missing template at once; default `bin/scaffold` in the kit, which reads the
`templates/` folder beside it, so a different `TEMPLATES` applies to single files only. `TIMEZONE` is the zone dates are given in (default: the machine's).

## What it carries

| | |
|---|---|
| Scripts | `audit` (45 checks, each with the file and line, its reason, the smallest fix and what closes it), `versions` (every place a version is written, the newest tag, npm, crates.io and GitHub release), `unreleased` (commits since the last tag by type, files changed, changelog state, a draft entry), `status` (the last release, its assets and workflow runs, what is ahead), `secrets` (token shapes and personal traces in the tree and, with `history: true`, in added lines of the newest commits), `private-words` (the word list against paths, lines and commit messages) |
| Skills | `make-release-ready`, `cut-release`, `public-private-split`, `homebrew-and-mise`, `scrub-before-public`, `publish-check` (an npm package before it is published, with `release.pack()`: what `npm pack --dry-run` would ship and which entry points are missing): playbooks the investigator loads when the job calls for one |
| Roles | `auditor` for questions about readiness and release state; `releaser` for requests to prepare or cut a release |

Each script also runs with no model: `ask-kit run release audit`, or `ask(do: "release.audit")` from an
agent. Pass `path=<folder>` to run one on another repository.

The audit groups its checks as Licence, Public files, CI, Release, Privacy, Quality, Version,
Packaging and Remote. Failures are listed with P0 and P1 first; a P0 or P1 check that could not run
(for example the private-word check without a list) is listed as not run and blocks; the Remote checks, when GitHub cannot be read, are listed as not run and do not block. The
output also lists what the audit does not certify: no install journey on another machine, no artifact
built, patterns only for secrets.

## What it can change

When the request asks for a change it can add a missing file from the bundled templates (or those named by `TEMPLATES`; never
overwriting), run the scaffold script, write the version into every manifest, lockfile and plugin
manifest, write the changelog entry from the commits since the last tag, create an annotated tag
locally, and replace the notes of an existing GitHub release.

Pushing a tag, publishing to npm or crates.io and creating a GitHub release are irreversible. They
are held unless the ask may change things and the call passes `confirm` equal to the version string;
the instructions tell the investigator to pass it only when the request names that version. A tag that
exists is never moved, and `publish` refuses a repository whose tag-triggered workflow publishes, so
the tag push is the release there. A question never changes anything.

What it reads is limited. It never reads `.env` files, `.npmrc`, key files or anything named like a
credential file; a tracked one is reported by name. The secret scan reports file, line and kind and
never the matched text. The private-word list is read inside the kit and no word appears in any
output. Every program runs without a shell and with a timeout. `gh` is limited to `repo view`,
`release list|view`, `run list|view`, `workflow list|view` and `api` GET calls.

## How well it works

`bench/questions.json` holds three questions and two script runs against the fixture in
`bench/fixture/ankh-cli`, each with patterns its answer must hold. It has not been run on a model yet;
`ask-kit kit test release` runs it from the kit's folder. The scripts were run on `ask-kit` and on the
fixture, and the changing calls were run in a scratch repository with a local bare remote.
