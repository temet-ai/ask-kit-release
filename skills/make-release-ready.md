Make a repository release-ready: run the audit, then add what is missing from the templates folder (setting `TEMPLATES`)
1. `const a = await scripts.run("audit")`. Keep `a.blocking`, `a.otherFailures` and `a.notRun`.
2. `const dry = await release.scaffold()` (a dry run: it lists every template that is missing and the
   `__PLACEHOLDER__` values it could not fill; it writes nothing). Its list and the audit's failures are the work.
3. Without `act: true` stop here: answer with the decision, the blocking checks, and the files the
   scaffold would add. Say that adding them needs `ask` with `act: true`.
4. With `act`, add only what the request covers. One file: `release.addFile("SECURITY.md", { desc })`. All of
   it: `release.scaffold({ dryRun: false, name, desc, holder, author, privateRepo })`. It never overwrites a
   file; it lists the ones it skipped (merge those by hand) and the placeholders left.
5. Values the templates need, and where they come from:
   - `holder` for LICENSE: the copyright holder of the repository (a person or a company). If the
     request does not say, do not add LICENSE and ask.
   - `author`: a GitHub noreply address, never a personal one.
   - `privateRepo`: `owner/repo` of the private repository, only for a public/private split.
   Never invent these; leave the placeholder and say so.
6. Things the templates do not do for you, to name in the answer when the audit failed them:
   - hooks: `git config core.hooksPath scripts/hooks`, then `scripts/hooks/test-hooks`. The word list is
     the file named by the setting `PRIVATE_WORDS`; never read, copy or write it. If it is
     missing, say the owner creates it or links an existing one.
   - CI: push and read the first real run. A run that fails before any step is a billing or "Actions
     allowed" refusal; do not call CI green.
   - the sandbox variable honoured in code, one `sandboxed()` check before any browser, clipboard,
     notifier, editor, terminal or third-party CLI (Rust projects).
   - README: for a cold reader, no slogans; two cold readers must be able to install and start it.
   - public AGENTS.md: map, build, rules, the Discworld test-data rule, no private paths.
7. Run the audit again with `scripts.run("audit", { history: false })` and report what moved from fail to
   pass. Do not commit unless the request says to.
8. Defaults you do not ask again: MIT, org `temet-ai`, one SemVer `0.1.0-alpha.N`, tag `v<version>`,
   PR CI on Linux only and the platform matrix on tags, Homebrew tap and mise, test data from Discworld.
