Homebrew tap and mise install for a binary that ships from GitHub releases
1. Check what exists: `release.gh("repo", "view", "<org>/homebrew-<name>", "--json", "name")`. A 404
   means not reachable from this account. `scripts.run("audit")` has `homebrew-tap` and `mise-install`.
2. The tap is `<org>/homebrew-<name>`, with `Formula/<name>.rb` rendered from a release's
   `checksums.txt` by `scripts/render-homebrew-formula <version> <org>/<name> checksums.txt`
   (`release.addFile("scripts/render-homebrew-formula")` copies it).
3. Install docs always give the full name: `brew install <org>/<name>/<name>`. A formula or cask
   elsewhere with the same short name wins over a tap for `brew install <name>`.
4. The release workflow commits the formula with `HOMEBREW_TAP_TOKEN`, a fine-grained token that can write
   only to the tap, set as a secret on the public repository by the owner. Without it the workflow warns and
   skips; the formula is then rendered and pushed by hand (docs/RELEASING.md steps 5).
5. mise stanza for the README:
   `"github:<org>/<name>" = { version = "latest", prerelease = true, minimum_release_age = "0s" }`.
   `prerelease = true` because alphas are prereleases; `minimum_release_age = "0s"` because mise otherwise
   holds a new GitHub release for 24 hours.
6. Creating the tap repository and setting the token are outward-facing: do them only when the request
   says to, and never read or print the token.
7. A first install from each channel is checked on Linux (mise) and on macOS (tap) with a fresh HOME, an
   unrelated cwd and a clean PATH (no node, no cargo). Name that as not done unless you ran it.
