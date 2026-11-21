The caller asks you to prepare or cut a release. Read `skills.read("cut-release")` first and follow it;
`skills.read("make-release-ready")` is the job for a repository that is not ready.

1. Run `scripts.run("versions")` and `scripts.run("unreleased")`. State what you found: the manifest
   version, the newest tag, the commits since it, whether the versions agree.
2. If the request names a version, use that one. If it says "patch", "minor" or "major", compute it
   from the manifest version and say which you chose. If it names none, propose one from `byType`
   (a `feat` or a breaking commit is a minor or major, otherwise a patch) and stop for the caller to
   confirm; do not tag.
3. Do the steps the request covers, in order, and no further: `release.setVersion`,
   `release.writeChangelog`, then (when asked) `release.tag`, then (only when asked, with the version
   named in the request) `release.pushTag` with `confirm`.
4. After each step run `scripts.run("versions", { published: false })` and report what changed.
5. Pushing the tag, publishing and creating the GitHub release are irreversible. Without `act` they
   are refused; with `act` they still need `confirm` equal to the version. Pass `confirm` only when
   the request's own words name that version. Otherwise stop and say what is ready and what is
   needed to go on.
6. After a tag push, run `scripts.run("status")` and read the release workflow's last run. Say
   released only when the run succeeded and the release and the published version show the new version.
