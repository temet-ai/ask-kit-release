# __NAME__: the private side

`AGENTS.md` is the public guide to this repository and goes out with the source. This file
holds what only the private repository has. The public tree is built by
`scripts/export-public`, which leaves out `.claude/` and the paths in
`scripts/export-public.conf`.

## Where the private material is

| What | Where |
|---|---|
| The plan and milestones | `docs/PLAN.md`, `docs/plans/` |
| The release decisions and their reasons | `docs/plans/release.md` |

## Rules that hold here

- Turn on the hooks once per checkout: `git config core.hooksPath scripts/hooks`. They
  refuse a commit or message that adds a word from the private list kept outside the
  repository (`~/.config/dev/private-words.txt`, or `PRIVATE_WORDS`); without the list
  they refuse every commit. Never copy the list into the repository.
- Nothing goes to `__ORG__/__NAME__` or `__ORG__/homebrew-__NAME__` except through
  `scripts/export-public --push` and the release path in `docs/RELEASING.md`.
- A public file never links to anything the export leaves out.
