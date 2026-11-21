The public/private split: what stays private, and how the public repository is filled
1. Read the rule: the source goes to a new public repository under `temet-ai`, filled by
   `scripts/export-public` as squashed commits. The private repository keeps the full history, plans,
   `.claude/` and handoffs. Never flip the private repository public: GitHub keeps `refs/pull/*`, so
   commits from a cleaned history stay fetchable in the old one.
2. Check the state: `const a = await scripts.run("audit")`; read the `public-private-split`, `agents-md`,
   `hooks` and `private-words` checks.
3. What belongs in `scripts/export-public.conf`: `NAME`, `AUTHOR` (a noreply address),
   `EXCLUDE` (`.claude`, `docs/PLAN.md`, `docs/plans`, `docs/handoffs`, scratch, deploy scripts) and
   `PERSONAL` (an extended regex for the private repository's name and other machines' paths). The
   conf and the script are private and are left out of the export.
4. A public file never names a private path. `repo.rg("\\.claude/|docs/(plans|handoffs)", { glob: ["*.md"] })`
   in the public docs finds links the export would refuse.
5. Add the scripts with `release.addFile("scripts/export-public")` and
   `release.addFile("scripts/export-public.conf", { name, author, privateRepo })` (needs `act`).
   `scripts/export-public` needs `gitleaks` on PATH.
6. The dry run is the export script's, not yours: `scripts/export-public <scratch folder>` into a scratch folder
   and a local bare repo. A planted private word must be refused with nothing pushed; a clean tree is one
   commit; an unchanged second export pushes nothing. Name these as the steps for the caller; running
   the export with `--push` creates the public repository's content and is done only when the owner says to.
7. Test data in a public tree uses Discworld names (`Sam Vimes`, `ankh-morpork/watch`, `WATCH-12`) and
   the hosts `example.com` or `.invalid`.
