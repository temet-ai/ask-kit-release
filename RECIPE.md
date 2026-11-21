# Recipe: release kit

## What it answers

How close a repository is to a public release, and where a release stands: the readiness audit (licence, notices, README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CI,
release workflow, secret and private-word scans, `.gitignore`, public/private split, hooks, versions,
tag, changelog, packaging, GitHub settings), whether the version agrees in every manifest, the newest
tag, what is published on npm, crates.io and GitHub, and what is unreleased since the last tag. It
prepares a release when asked: add a missing template, set the version, write the changelog entry,
create the tag, and (with the version confirmed) push the tag, publish or create the GitHub release.

## What it needs

- `git` and `node` on PATH. `gh` for the Remote checks; without it they are reported as not run.
- `npm` for `npm view` and `npm pack --dry-run`, and `cargo` for `cargo search`, when the repository has those manifests.
- A templates folder (setting `TEMPLATES`) and optionally a scaffold script (setting `SCAFFOLD`, needs
  `python3`), only for the changing calls and the scaffold dry run.
- A private-word list at `PRIVATE_WORDS`, only for that check.

## What it reads and runs

- Runs `git` (reading subcommands), `gh` (`repo view`, `release list|view`, `run list|view`,
  `workflow list|view`, `api` GET), `npm view`, `npm pack --dry-run`, `cargo search`, with an argument array and a timeout.
  The git history scan reads `git log -p` inside the module and returns only commit, file, line and kind.
- Reads the tracked files of the repository. Files named like credential files (`.env*`, `.npmrc`,
  `.netrc`, keys, `credentials*`) are never read. Output masks URL passwords and token shapes.
- Changing calls (`addFile`, `scaffold` without dry run, `setVersion`, `writeChangelog`, `tag`,
  `setReleaseNotes`) need `act`. `pushTag`, `publish` and `githubRelease` need `act` and `confirm`
  equal to the version, and refuse a tag that exists on the remote.

## Rebuild it from an empty folder

`ask-kit.toml` with a `module` source `release` (`release.mjs`, `api.d.ts`) and a `folder` source `repo`
on `${REPO_ROOT}` (detected by `git rev-parse --show-toplevel`; credentials, lockfiles and build output
excluded). `acts` lists the changing functions as `release.<function>` and `repo.edit|write|run`.
Settings `PRIVATE_WORDS` and `TEMPLATES`.

`release.mjs` exports `make({settings, push, cwd, act})` and returns the `release` global:
`repo()`, `project()`, `versions()` (places by file and line for package.json, package-lock.json,
Cargo.toml and workspace crates, Cargo.lock, plugin manifests, server.json, gemini-extension.json,
ask-kit.toml, pyproject.toml, Homebrew formulas; tags sorted by semver with pre-releases first;
npm, crates.io and GitHub release), `unreleased()`, `status()`, `secrets()`, `privateWords()`,
`audit()`, `pack()` (`npm pack --dry-run --json --ignore-scripts`: the files, sizes, entry points
missing from them and files that should not ship), and the changing calls. Read-only `git` and `gh` wrappers classify every call; changing
git calls are refused and the typed calls are the only way to change anything. `audit.mjs` holds the
checks as `chk(id, group, severity, title, reason, fix, acceptance, run)`; each `reason` says why the check
exists.

Scripts: `audit`, `versions`, `unreleased`, `status`, `secrets`, `private-words`. Skills in `skills/`:
make-release-ready, cut-release, public-private-split, homebrew-and-mise, scrub-before-public, and
publish-check (an npm package before it is published, from the npm kit's skill of that name, which
this kit took over on 2026-11-21 with the npm kit's `publisher` role folded into `auditor`). Roles in
`roles/`: auditor, releaser. `instructions.md`: start from a script, give times in the `TIMEZONE` zone, report NOT RUN
as not run, never print a secret or a private word, pass `confirm` only when the request names the
version, never move a tag.

## Bench

`bench/questions.json`: three questions of kinds agents handle by hand around releases (versions
across manifests, changelog, secrets), put to the fixture `bench/fixture/ankh-cli`, and two script
runs. Questions about what is published, tags, GitHub settings and CI need a repository on GitHub and
are not in the bench.
