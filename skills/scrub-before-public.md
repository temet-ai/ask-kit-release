Scrub a repository before it goes public: secrets, personal traces, private words
1. `scripts.run("secrets", { history: true })` for token shapes, home paths, emails and the git email in
   the tree and in the lines the newest commits added. `scripts.run("private-words", { history: true })`
   for the list.
2. Without a word list `private-words` returns `ran: false`: report "not run" and that it blocks. The
   list is the file named by the setting `PRIVATE_WORDS`. Never create, read, print or copy it.
3. Report counts and `path:line` with the kind only. Never paste a value, a word or a matched line.
4. Also look, with `repo.rg`, at what a pattern scan cannot see and say you did or did not: screenshots
   and fixtures (read them: a recording can hold a name), plans and handoffs, session links
   (`claude.ai/`), private repository names, ticket keys. Real captures never belong in the source repo,
   not even under `artifacts/`.
5. A hit in history stays in history until it is rewritten. The answer is not a rewrite of the
   private repository: export squashed history to a new public repository. Say that, and that moving
   content out comes before any rewrite.
6. Fix in the tree (with `act`): replace each value with a placeholder (`user@example.com`, `/home/user`,
   `<token>`) or made-up data, and run the scan again. A found secret is rotated by the owner; do not
   handle the real value.
7. `.gitleaks.toml` allowlists literal entries only, never a broad pattern, because the file ships in the
   public tree.
8. Answer with the counts by kind, the files, and what the scan did not cover (`notCovered`).
