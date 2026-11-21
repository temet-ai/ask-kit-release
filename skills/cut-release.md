Cut a release: bump, notes, tag, and (only when the request names the version) push
1. `scripts.run("versions")` and `scripts.run("unreleased")`. If `versions.agree` is false, fix that
   first with `release.setVersion(<current primary>)`; a release never starts from a mismatch.
2. Decide the version: the one the request names, else compute patch, minor or major from the manifest
   version and say which. Pre-releases look like `0.1.0-alpha.N`. Never reuse a version that has a tag.
3. `release.setVersion(version)` rewrites package.json, package-lock.json, Cargo.toml and Cargo.lock
   (workspace crates), plugin manifests and server.json in one call. Check `agree: true` in its answer.
4. `release.writeChangelog(version)` writes the entry from the commits since the last tag, grouped by
   conventional type. Read `entry` and fix wording with `release.writeChangelog(version, { text })` only
   if a line is wrong. If the repository has no CHANGELOG file this creates one.
5. Lockfile and notices: for Rust run the repository's `scripts/notices`, tests, clippy and `cargo deny
   check`; for Node `npm test`. Those are other kits' jobs (rust for Rust, tests for everything
   else: `ask.kit("tests", "do all the checks pass?")`): say they are still to run if you do not
   run them. For an npm package, `skills.read("publish-check")` before the tag.
6. Commit the bump and the notes (only when the request says to commit), matching the repository's
   commit style, one commit, no attribution lines.
7. `release.tag(version)` creates the annotated tag `v<version>` locally. It refuses a tag that exists,
   a dirty tree, a HEAD off the default branch and manifests that do not carry the version.
8. STOP here unless the request names the version in its own words ("push v0.4.0", "publish 0.4.0").
   Pushing a tag and publishing are irreversible. Then:
   `release.pushTag(version, { confirm: version })`. Where the repository's tag-triggered workflow
   publishes (npm or archives), this is the whole release: do not also run `release.publish`.
   `release.publish` is for a package with no such workflow, and it refuses otherwise.
9. After the push: `scripts.run("status")`. Read `releaseWorkflow.lastRuns`; wait for the run to
   finish by running `status` again later. Report released only when the run concluded success, the
   GitHub release lists its assets, and `published` shows the new version.
10. Release notes that are wrong on an existing release: `release.setReleaseNotes(version, text)`.
11. Never move a tag, delete one, or replace assets. If something is wrong after the push, publish the
    next version.
12. Private repository with a public one: the release goes through the repository's `scripts/export-public`
    into the public repository and the tag is created there. That script and
    the public repo are outward-facing: do not run them unless the request says to.
