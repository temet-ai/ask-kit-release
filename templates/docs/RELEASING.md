# Releasing __NAME__

## Version and artifacts

One workspace SemVer version, `0.1.0-alpha.1`, then the last number goes up for each
alpha. Commit the version and the lockfile together. An annotated `v<version>` tag on
`main` of `__ORG__/__NAME__` runs `.github/workflows/release.yml`: it refuses a tag that
disagrees with Cargo, tests, builds each target, checks `__NAME__ --version`, and
publishes a GitHub release (a prerelease while the version has `-alpha`) with SHA-256
checksums. Never move a released tag or replace its assets; publish the next version.

Targets: macOS Apple Silicon and Intel, Linux arm64 and x64 (glibc, built on Ubuntu
22.04, so glibc 2.35 or later). Each archive holds `__NAME__`, LICENSE and
THIRD-PARTY-NOTICES.md. Not built: Windows (WSL2 meanwhile), older glibc, other
architectures. macOS binaries are unsigned; Homebrew and mise are the supported routes.

## Distribution

The source is public at [`__ORG__/__NAME__`](https://github.com/__ORG__/__NAME__), and its
releases are the one source for package managers. It is developed in a private
repository; `scripts/export-public <new folder> --push git@github.com:__ORG__/__NAME__.git`
builds the public tree from its `main`, checks it (gitleaks, the private word list,
personal paths, links to what is left out) and pushes it as one commit.

Homebrew: the tap `__ORG__/homebrew-__NAME__` holds `Formula/__NAME__.rb`, rendered from a
release's `checksums.txt` by `scripts/render-homebrew-formula`. Install docs always give
the full name, `brew install __ORG__/__NAME__/__NAME__`: a formula or cask elsewhere with
the same short name wins over a tap for `brew install __NAME__`.

mise:

```toml
[tools]
"github:__ORG__/__NAME__" = { version = "latest", prerelease = true, minimum_release_age = "0s" }
```

`prerelease = true` because alphas are prereleases; `minimum_release_age = "0s"` because
mise otherwise holds a new GitHub release for 24 hours.

## Publishing checklist

1. On the private `main`: bump the version, run `scripts/notices`, the tests, clippy with
   `-D warnings` and `cargo deny check`. Commit and push.
2. `scripts/export-public <new folder> --push git@github.com:__ORG__/__NAME__.git`.
3. In a clone of `__ORG__/__NAME__`, create and push an annotated tag `v<version>` on that commit.
4. Wait for the build jobs and the publish job to succeed; four archives and `checksums.txt`.
5. With `HOMEBREW_TAP_TOKEN` set on `__ORG__/__NAME__` (a fine-grained token that can write
   only to `__ORG__/homebrew-__NAME__`) the publish job commits the formula. Without it:
   download `checksums.txt`, run `scripts/render-homebrew-formula <version> __ORG__/__NAME__
   checksums.txt > Formula/__NAME__.rb` in a clone of the tap, commit and push.
6. Upgrade through brew on the Mac and mise on Linux, from a shell with a clean `PATH`, and
   run it: `__NAME__ --version` shows the new version, LICENSE and the notices are in the prefix.

The release workflow needs only `contents: write` on its own repository;
`HOMEBREW_TAP_TOKEN` is the one other credential.
