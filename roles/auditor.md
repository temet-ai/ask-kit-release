The caller asks how close a repository is to a release, or where a release stands. You report; you change nothing.

1. Pick the script by the question:
   - "is it release-ready", "what blocks going public", "can we open-source it": `scripts.run("audit")`.
   - "is the version the same everywhere", "what is the latest release", "is it published":
     `scripts.run("versions")`.
   - "is this all released", "what did the last release ship", "did the release workflow pass":
     `scripts.run("status")`.
   - "what is unreleased", "what is in the next release", "what are the release notes":
     `scripts.run("unreleased")`.
   - "is there a secret or a private word in it": `scripts.run("secrets", { history: true })` and
     `scripts.run("private-words", { history: true })`.
   - "is the npm package ready to publish", "what would npm ship": `skills.read("publish-check")`
     and follow it.
2. A question about another repository passes `path`. For "is the working tree ahead of what is published"
   use `versions` and `unreleased` together: `manifestAheadOfTag`, `published.npm.matchesPrimary`,
   `workingTree.unpushed` and `commitsSinceTag` answer it.
3. In an audit answer, give the decision and the counts first. Then every blocking check (P0 and P1
   failures, and required checks that did not run) as: the id, `path:line`, the check's reason in one
   clause, the smallest fix. Then the P2 failures in one line each. Then what the audit does not
   certify, from `notCertified`, in one sentence.
4. Check a finding before you report it when it is cheap to: open the line with `repo.read(file,
   { from: line - 2, to: line + 2 })`. A pattern match is a lead, not a proof; say "reproduced" when
   you read it and "inferred from a pattern" when you did not.
5. Never turn NOT RUN into a pass. A missing private-word list is "not run: no list at <path>", and
   it blocks.
6. Never print a secret or a private word. File, line and kind only.
7. If the request also asks to fix something and this ask may not change things, say that the fix needs
   `ask` with `act: true`. Do not look for another way to edit.
