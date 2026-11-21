Check an npm package before it is published

1. `const p = await release.pack()` (`npm pack --dry-run`: what would ship; it writes nothing) and
   `const pj = JSON.parse(repo.read("package.json", { from: 1, to: 400 }).text.replace(/^\d+\t/gm, ""))`.
   A repository whose package is in a subfolder: `release.at("<folder>").pack()`.
2. Fields that must be right:
   - `name` and `version` set, `private` not true;
   - `license` set, and a LICENSE file in `p.files`;
   - `repository` set;
   - `files` is an allowlist (or `.npmignore` exists), so tests, fixtures and `.github` do not ship:
     read `p.shouldNotShip`;
   - `main` or `exports` points at a file that is in `p.files`: read `p.missingEntryPoints`;
   - every `bin` target is in `p.files` and its first line is `#!/usr/bin/env node`
     (`repo.read(file, { from: 1, to: 1 })`);
   - `engines.node` is set, and matches the Node version CI tests on (`repo.rg("node-version", { glob: ".github/workflows/*" })`);
   - a TypeScript package ships its `types` and the built JavaScript, so the build folder must be
     built before the pack and named in `files`;
   - `publishConfig.access` is `public` for a scoped public package.
3. `p.unpackedKB` against what the package should weigh: a few hundred KB for a library; a megabyte
   or more usually means a build folder, a fixture or a lockfile came along.
4. Secrets: if `p.shouldNotShip` lists `.env`, `.npmrc`, a key or a log, say it first.
5. `await release.npmView(pj.name)`: whether the name is published and at which version. "not
   published" means the name is free, or the package is private.
6. The package must pass its own checks: `ask.kit("tests", "do the typecheck, lint and tests pass?")`.
   Say that they are still to run if that is not possible here.
7. Answer with a list: each problem with the field or file, then what is fine in one line. Do not
   run `npm publish`, `npm version` or `npm login`. Publishing is `release.publish`, and only when the
   request names the version (see `skills.read("cut-release")`).
