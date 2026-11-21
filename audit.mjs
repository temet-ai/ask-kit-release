// A release-readiness audit as checks that need no model. Each check carries its own reason. Evidence is file:line; secrets and private
// words appear as file, line and kind, never as text.
const SAFE_SEV = { P0: 0, P1: 1, P2: 2 };

export async function runAudit(api, I, o = {}) {
  const { history = true, commits = 300, remote = true } = o;
  const { files, read, tryRead, lineOf, json } = I;
  const fl = await files();
  const p = await I.project();
  const rp = await I.repo();
  const ver = await api.versions({ published: remote });
  const tg = await I.tags();
  const has = (re) => fl.filter((f) => (re instanceof RegExp ? re.test(f) : f === re));
  const first = (re) => has(re)[0] ?? null;
  const at = (f, line, note) => `${f}${line ? ":" + line : ""}${note ? " " + note : ""}`;
  const npm = p.npm;
  const cargo = p.cargo;
  const crates = cargo?.crates ?? [];

  let meta = null;
  let metaErr = null;
  const slug = rp.slug;
  if (remote && slug) {
    try {
      meta = await I.ghJson("repo", "view", slug, "--json", "visibility,description,repositoryTopics,licenseInfo,defaultBranchRef,homepageUrl,isPrivate,url");
    } catch (e) {
      metaErr = e.message.slice(0, 200);
    }
  }
  const visibility = meta?.visibility ?? null;
  const isPublic = visibility === "PUBLIC";
  const wf = fl.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).map((f) => ({ file: f, text: tryRead(f) ?? "" }));
  const readme = first(/^README(\.md)?$/i);
  const readmeText = readme ? tryRead(readme) : null;
  const defaultBranch = rp.defaultBranch ?? "main";
  const noGh = (why) => ({ status: "unknown", evidence: [why ?? metaErr ?? (slug ? "GitHub could not be read from this account (a 404 means not reachable, not absent)" : "origin is not a GitHub repository")] });

  const checks = [];
  const chk = (id, group, sev, title, reason, fix, accept, run) => checks.push({ id, group, sev, title, reason, fix, accept, run });
  const pass = (evidence = []) => ({ status: "pass", evidence });
  const fail = (evidence) => ({ status: "fail", evidence });
  const na = (why) => ({ status: "na", evidence: [why] });

  // ---- licence ----
  const licFile = first(/^(LICEN[CS]E|COPYING)(\.\w+)?$/i);
  const licText = licFile ? tryRead(licFile) : null;
  const spdxOf = (t) => (!t ? null : /MIT License|Permission is hereby granted, free of charge/i.test(t) ? "MIT" : /Apache License/i.test(t) ? "Apache-2.0" : /GNU GENERAL PUBLIC LICENSE/i.test(t) ? "GPL" : /BSD/i.test(t) ? "BSD" : /ISC License/i.test(t) ? "ISC" : null);
  const spdx = spdxOf(licText);
  chk("licence-file", "Licence", "P0", "A LICENSE file is committed", "A public repository carries a licence file that names its holder and year", "Copy templates/LICENSE with the copyright holder (release.addFile('LICENSE', {holder}))", "LICENSE is tracked and names its holder and year", async () =>
    licFile ? pass([at(licFile, 1, spdx ? `(${spdx})` : "(licence not recognised)")]) : fail(["no LICENSE, LICENCE or COPYING in the tracked files"]));
  chk("licence-fields", "Licence", "P0", "The licence field in every manifest agrees with LICENSE", "`license` in every manifest", "Set license to the SPDX id of LICENSE in each manifest listed", "Every manifest's license equals LICENSE's", async () => {
    if (!npm && !cargo) return na("no package.json or Cargo.toml");
    const bad = [];
    const good = [];
    const want = spdx;
    if (npm) {
      const t = read("package.json");
      const l = lineOf(t, /^\s*"license"\s*:/);
      if (npm.license == null) bad.push(at("package.json", null, "has no license field"));
      else if (want && npm.license !== want) bad.push(at("package.json", l, `license "${npm.license}", LICENSE is ${want}`));
      else good.push(at("package.json", l, `"${npm.license}"`));
    }
    if (cargo) {
      const ws = cargo.workspace;
      if (ws?.license) {
        if (want && ws.license !== want) bad.push(at("Cargo.toml", null, `workspace license "${ws.license}", LICENSE is ${want}`));
        else good.push(at("Cargo.toml", null, `workspace "${ws.license}"`));
      }
      for (const c of crates) {
        if (!c.licenseKey && !ws?.license) bad.push(at(c.file, null, `crate ${c.name} has no license`));
      }
    }
    for (const f of p.plugins) {
      const j = json(f);
      if (j && "license" in j && want && j.license !== want) bad.push(at(f, lineOf(read(f), /"license"/), `license "${j.license}", LICENSE is ${want}`));
    }
    if (!licFile) bad.push("there is no LICENSE to agree with");
    return bad.length ? fail(bad) : pass(good);
  });
  chk("licence-default", "Licence", "P2", "The licence is the settled default (MIT)", "The licence is MIT; confirm the copyright holder per repository", "Confirm with the owner before changing; nothing to fix if intended", "LICENSE is MIT or the difference is recorded", async () =>
    !licFile ? na("no LICENSE") : spdx === "MIT" ? pass([at(licFile, 1, "MIT")]) : fail([at(licFile, 1, spdx ? `licence is ${spdx}` : "licence not recognised")]));
  chk("notices", "Licence", "P1", "THIRD-PARTY-NOTICES.md is committed, generated and shipped", "Generated, committed, shipped in every archive and the formula's prefix; a bundled dependency can require its notice to travel with it", "Run scripts/notices (cargo-about) or scripts/notices-npm.mjs and commit the output; add it to npm `files`", "THIRD-PARTY-NOTICES.md is tracked, matches the dependencies, and is in the package or archive", async () => {
    const hasDeps = (npm && Object.keys(json("package.json")?.dependencies ?? {}).length > 0) || cargo;
    if (!hasDeps && !npm) return na("no dependencies manifest");
    if (npm && !cargo && !hasDeps) return na("package.json has no dependencies");
    const f = first(/^THIRD-PARTY-NOTICES(\.md)?$/i);
    if (!f) return fail(["no THIRD-PARTY-NOTICES.md in the tracked files"]);
    const ev = [at(f, 1)];
    const gen = first(/^scripts\/(notices|notices-npm\.mjs|notices\.mjs)$/) ?? first(/(^|\/)about\.toml$/);
    ev.push(gen ? at(gen, null, "generator") : "no generator script (scripts/notices or scripts/notices-npm.mjs)");
    if (npm?.files && !npm.files.some((x) => /THIRD-PARTY-NOTICES/i.test(x))) return fail([...ev, at("package.json", lineOf(read("package.json"), /"files"/), "`files` does not list THIRD-PARTY-NOTICES.md, so the package does not ship it")]);
    return gen ? pass(ev) : { status: "fail", evidence: ev };
  });
  chk("deny-toml", "Licence", "P1", "deny.toml and about.toml exist (Rust)", "`deny.toml` from the first dependency; `about.toml`/`about.hbs`", "Copy templates/deny.toml, about.toml, about.hbs", "cargo deny check passes in CI", async () => {
    if (!cargo) return na("no Cargo.toml");
    const miss = ["deny.toml", "about.toml"].filter((f) => !fl.includes(f));
    return miss.length ? fail(miss.map((m) => `no ${m}`)) : pass(["deny.toml", "about.toml"]);
  });

  // ---- public files ----
  chk("readme", "Public files", "P1", "README with install and usage", "README for a cold reader: what it is, install, first run, status, privacy, contributing, licence; two cold readers must be able to install and start it", "Write the README for a cold reader; add an Install and a Usage section", "A reader given only the README can say what it is and install and start it", async () => {
    if (!readme) return fail(["no README"]);
    const heads = readmeText.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => /^#{1,4}\s/.test(l));
    const inst = heads.find(([l]) => /install|set ?up|set it up|getting started|quick ?start|try it/i.test(l));
    let use = heads.find(([l]) => /usage|use\b|quick ?start|getting started|first run|example|run\b|commands?/i.test(l));
    if (!use) {
      const fences = readmeText.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => /^\s*```/.test(l));
      if (fences.length >= 4) use = [`(code blocks, no usage heading; inferred)`, fences[2][1]];
    }
    const ev = [at(readme, 1, `${readmeText.split("\n").length} lines`)];
    if (inst) ev.push(at(readme, inst[1], inst[0].trim()));
    if (use) ev.push(at(readme, use[1], use[0].trim()));
    const miss = [];
    if (!inst) miss.push("no Install heading");
    if (!use) miss.push("no usage heading");
    return miss.length ? fail([...ev, ...miss]) : pass(ev);
  });
  const doc = (names) => first(new RegExp(`^(\\.github/|docs/)?(${names})(\\.md)?$`, "i"));
  chk("security", "Public files", "P1", "SECURITY.md", "SECURITY.md once anything is stored, sent, or listens; enable private vulnerability reporting", "Copy templates/SECURITY.md and fill it", "SECURITY.md is tracked and names a reporting route", async () => {
    const f = doc("SECURITY");
    return f ? pass([at(f, 1)]) : fail(["no SECURITY.md (root, .github/ or docs/)"]);
  });
  chk("contributing", "Public files", "P1", "CONTRIBUTING.md", "CONTRIBUTING says licence by PR and carries the fake test-data rule", "Copy templates/CONTRIBUTING.md", "CONTRIBUTING.md is tracked", async () => {
    const f = doc("CONTRIBUTING");
    return f ? pass([at(f, 1)]) : fail(["no CONTRIBUTING.md"]);
  });
  chk("code-of-conduct", "Public files", "P1", "CODE_OF_CONDUCT.md", "Public-facing files: README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and PR templates", "Copy templates/CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.md is tracked", async () => {
    const f = doc("CODE_OF_CONDUCT");
    return f ? pass([at(f, 1)]) : fail(["no CODE_OF_CONDUCT.md"]);
  });
  chk("templates", "Public files", "P2", "Issue and pull request templates", "Public-facing files include issue and PR templates", "Copy templates/.github/ISSUE_TEMPLATE/* and pull_request_template.md", "Both exist under .github/", async () => {
    const iss = has(/^\.github\/ISSUE_TEMPLATE\//);
    const pr = first(/^\.github\/pull_request_template\.md$/i) ?? first(/^\.github\/PULL_REQUEST_TEMPLATE\//);
    const miss = [];
    if (!iss.length) miss.push("no .github/ISSUE_TEMPLATE/");
    if (!pr) miss.push("no .github/pull_request_template.md");
    return miss.length ? fail(miss) : pass([iss[0], pr]);
  });
  chk("privacy-doc", "Public files", "P2", "A page saying what it stores and sends", "A 'what it stores and sends' page from the first feature that stores or sends anything; no telemetry", "Add docs/privacy.md (templates/docs/privacy.md) or a README section", "A page lists what is stored and what is sent, in the code's terms", async () => {
    const f = first(/(^|\/)privacy(\.md)?$/i) ?? first(/^docs\/.*privacy.*\.md$/i);
    if (f) return pass([at(f, 1)]);
    const l = readmeText && lineOf(readmeText, /^#{1,4}\s.*(stores and sends|privacy)/i);
    return l ? pass([at(readme, l)]) : fail(["no privacy page and no README section on privacy"]);
  });
  chk("agents-md", "Public files", "P2", "A public AGENTS.md with no private pointers", "Public AGENTS.md (map, build, rules); a public file never names a private path; the public tree pointed at private docs", "Add AGENTS.md; move private pointers to .claude/CLAUDE.md", "AGENTS.md exists and links to nothing that is left out of the public tree", async () => {
    const f = first(/^AGENTS\.md$/);
    if (!f) return fail(["no AGENTS.md"]);
    const t = read(f);
    const bad = [];
    t.split("\n").forEach((l, i) => {
      if (/\]\((?:\.\/)?(?:\.claude|docs\/(?:plans|handoffs)|\.mike)\//.test(l) || /(?:^|[\s`(])~\/\.claude\//.test(l) || /\/home\/[a-z]/.test(l)) bad.push(at(f, i + 1, "names a private path"));
    });
    return bad.length ? fail(bad.slice(0, 10)) : pass([at(f, 1)]);
  });
  chk("releasing-doc", "Public files", "P2", "A release checklist document", "docs/RELEASING.md holds each release's checklist", "Copy templates/docs/RELEASING.md and fill it", "A document lists the release steps", async () => {
    const f = first(/(^|\/)RELEASING(\.md)?$/i) ?? first(/^docs\/.*releas.*\.md$/i);
    if (f) return pass([at(f, 1)]);
    const c = doc("CONTRIBUTING");
    const l = c && lineOf(read(c), /^#{1,4}\s.*releas/i);
    return l ? pass([at(c, l)]) : fail(["no docs/RELEASING.md and no release section in CONTRIBUTING"]);
  });

  // ---- CI ----
  const runsOf = (text) => text.split("\n").map((l, i) => [l.trim(), i + 1]).filter(([l]) => /^(-\s*)?run:/.test(l) || /^\s*-\s*(npm|cargo|node|pnpm|yarn|make)\b/.test(l));
  chk("ci-exists", "CI", "P1", "A CI workflow runs the tests", "CI on every PR and push to main, Linux: format check, lint with warnings denied, tests, licence and advisory check", "Copy templates/.github/workflows/ci.yml and adapt", "A workflow triggered by pull_request or push runs the tests", async () => {
    if (!wf.length) return fail(["no .github/workflows/*.yml"]);
    const ev = [];
    for (const w of wf) {
      if (!/(pull_request|push)\s*:/.test(w.text) && !/on:\s*\[?(push|pull_request)/.test(w.text)) continue;
      for (const [l, n] of runsOf(w.text)) if (/test|lint|clippy|fmt|check|deny|build|tsc/.test(l)) ev.push(at(w.file, n, l.slice(0, 90)));
    }
    return ev.some((e) => /test/.test(e)) ? pass(ev.slice(0, 12)) : fail(ev.length ? [...ev.slice(0, 8), "no step runs the tests"] : ["no workflow on pull_request or push runs anything that looks like tests"]);
  });
  chk("ci-linux-pr", "CI", "P2", "PR CI runs on Linux only; the platform matrix is for tags", "Actions minutes are billed per platform and a macOS or Windows run costs several times a Linux one; PR CI is Linux only and the full matrix runs on tags", "Move the macOS and Windows jobs to the tag-triggered workflow", "No pull_request workflow names a macOS or Windows runner", async () => {
    const bad = [];
    for (const w of wf) {
      if (!/pull_request/.test(w.text)) continue;
      w.text.split("\n").forEach((l, i) => {
        if (/(runs-on|os)\s*:.*(macos|windows)|\b(macos|windows)-(latest|\d+)/i.test(l)) bad.push(at(w.file, i + 1, l.trim().slice(0, 70)));
      });
    }
    return !wf.length ? na("no workflows") : bad.length ? fail(bad.slice(0, 8)) : pass(["no pull_request workflow names a macOS or Windows runner"]);
  });
  chk("ci-gates", "CI", "P1", "CI runs the language's gates", "Rust: fmt --check, clippy with warnings denied, tests, deny, `--locked` everywhere; Node: lockfile committed, `npm ci`", "Add the missing steps to the CI workflow", "CI runs each gate listed", async () => {
    const all = wf.map((w) => w.text).join("\n");
    const miss = [];
    if (cargo) {
      if (!/cargo fmt[^\n]*--check|cargo fmt --check/.test(all)) miss.push("no `cargo fmt --check`");
      if (!/clippy[^\n]*-D warnings|clippy[^\n]*--deny warnings/.test(all)) miss.push("no `cargo clippy ... -D warnings`");
      if (!/cargo (nextest|test)/.test(all)) miss.push("no `cargo test`");
      if (!/cargo[- ]deny/.test(all)) miss.push("no `cargo deny check`");
      if (/cargo (build|test|clippy)(?![^\n]*--locked)/.test(all) && !/--locked/.test(all)) miss.push("no `--locked`");
    }
    if (npm) {
      if (/npm install\b/.test(all) && !/npm ci/.test(all)) miss.push("uses `npm install`, not `npm ci`");
      if (!/npm (run )?test|node (--test|test\/)/.test(all)) miss.push("no `npm test`");
    }
    if (!cargo && !npm) return na("no npm or cargo project");
    if (!wf.length) return fail(["no workflows"]);
    return miss.length ? fail(miss) : pass(["every gate named above appears in a workflow"]);
  });
  const relWf = wf.filter((w) => /tags\s*:/.test(w.text) || /on:\s*\n?\s*release/.test(w.text));
  chk("release-workflow", "Release", "P1", "A tag-triggered release workflow", "Release workflow is tag-only; build per target natively, smoke the binary, archive with LICENSE and notices, assert the archive count, checksums.txt by basename", "Copy templates/.github/workflows/release.yml and adapt", "A workflow runs on `v*` tags", async () =>
    relWf.length ? pass(relWf.map((w) => at(w.file, lineOf(w.text, /tags\s*:/)))) : fail(["no workflow triggered by tags"]));
  chk("release-tag-check", "Release", "P1", "The release workflow refuses a tag that disagrees with the manifest", "Tag `v<version>` must equal the manifest; the workflow validates tag == version", "Add a step comparing $GITHUB_REF_NAME with the manifest version", "A tag that disagrees fails before anything is published", async () => {
    if (!relWf.length) return na("no release workflow");
    for (const w of relWf) {
      const ws = w.text.split("\n");
      const l = ws.findIndex((x, i) => /GITHUB_REF(_NAME)?|github\.ref/.test(x) && ws.slice(Math.max(0, i - 8), i + 9).some((y) => /(version|package\.json|Cargo\.toml)/i.test(y) && /(!==|!=|\bne\b|mismatch|not (the )?tag|differ|exit 1|::error)/i.test(ws.slice(Math.max(0, i - 8), i + 12).join("\n"))));
      if (l >= 0) return pass([at(w.file, l + 1, "compares the tag with the manifest version")]);
    }
    return fail(relWf.map((w) => at(w.file, null, "no line compares the tag with the manifest version")));
  });
  chk("release-verify-tag", "Release", "P2", "gh release create uses --verify-tag", "release `--verify-tag`", "Add --verify-tag to gh release create", "The release is created only for an existing tag", async () => {
    const w = relWf.filter((x) => /gh release create/.test(x.text));
    if (!w.length) return na("no workflow runs `gh release create`");
    const bad = w.filter((x) => !/--verify-tag/.test(x.text));
    return bad.length ? fail(bad.map((x) => at(x.file, lineOf(x.text, /gh release create/), "no --verify-tag"))) : pass(w.map((x) => at(x.file, lineOf(x.text, /--verify-tag/))));
  });

  // ---- secrets and privacy ----
  chk("gitleaks-config", "Privacy", "P2", ".gitleaks.toml with literal allowlist entries", "`.gitleaks.toml` with literal allowlist entries only", "Copy templates/.gitleaks.toml", ".gitleaks.toml is tracked", async () =>
    fl.includes(".gitleaks.toml") ? pass([".gitleaks.toml"]) : fail(["no .gitleaks.toml"]));
  chk("gitignore", "Privacy", "P1", ".gitignore covers local files", "`.gitignore` covers `.env`, captures, local state, build output", "Add the missing patterns", "Each probe path below is ignored", async () => {
    if (!fl.includes(".gitignore")) return fail(["no .gitignore"]);
    const probes = [".env", ".env.local"];
    if (npm) probes.push("node_modules/x/index.js");
    if (cargo) probes.push("target/debug/x");
    const miss = [];
    for (const pr of probes) {
      const r = await I.git(["-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "-q", pr]);
      if (r.code !== 0) miss.push(`${pr} is not ignored`);
    }
    return miss.length ? fail([at(".gitignore", 1), ...miss]) : pass([at(".gitignore", 1, `ignores ${probes.join(", ")}`)]);
  });
  chk("tracked-credentials", "Privacy", "P0", "No credential file is tracked", "Real captures and credentials never enter the source repo", "git rm --cached the file, ignore it, rotate whatever it held, and rewrite history before going public", "No tracked file is named like a credential file", async () => {
    const bad = fl.filter((f) => I.SECRET_FILE.test(f));
    return bad.length ? fail(bad.slice(0, 10).map((f) => at(f, null, "named like a credential file (not read)"))) : pass(["no tracked .env, .npmrc, key, pem or credentials file"]);
  });
  const sec = await I.secrets({ history, commits });
  const tokenKinds = new Set(["github token", "gitlab token", "slack token", "api key", "aws key", "google key", "npm token", "private key", "jwt", "bearer", "token field", "npmrc token", "db url"]);
  chk("secrets-tree", "Privacy", "P0", "No secret-shaped value in the tracked files", "Secret scan; counts and file names only, never a value", "Replace each with a placeholder (user@example.com, <token>), rotate the real value, scan again", "The scan finds none", async () => {
    const hits = sec.tree.hits.filter((h) => tokenKinds.has(h.kind));
    const n = Object.entries(sec.tree.byKind).filter(([k]) => tokenKinds.has(k)).reduce((a, [, c]) => a + c, 0);
    return n ? fail([`${n} hits: ${Object.entries(sec.tree.byKind).filter(([k]) => tokenKinds.has(k)).map(([k, c]) => `${c} ${k}`).join(", ")}`, ...hits.slice(0, 12).map((h) => at(h.file, h.line, h.kind))]) : pass([`${sec.scanned} files scanned`]);
  });
  chk("secrets-history", "Privacy", "P0", "No secret-shaped value in the history", "Scrub review of tree and history; GitHub keeps refs/pull/*, so commits from a cleaned history stay fetchable; never flip a private repo public", "Export a squashed history to a new public repo (scripts/export-public); rotate what leaked", "The history scan finds none", async () => {
    if (!sec.history) return { status: "unknown", evidence: ["history scan not run (history: false)"] };
    const h = sec.history;
    const cov = `${h.commitsScanned} of ${h.commitsTotal} commits scanned`;
    return h.count ? fail([cov, ...h.hits.slice(0, 10).map((x) => at(x.file, x.line, `${x.kind} in ${x.commit}`))]) : pass([cov + (h.complete ? "" : " (the older commits were not scanned)")]);
  });
  chk("personal-traces", "Privacy", "P1", "No home path, personal email or machine name in the tracked files", "Scrub: home paths, emails, session links, private repo names; the scan looks for the home path, the git email and the hostname", "Replace each with a placeholder (/home/user, user@example.com)", "The scan finds none", async () => {
    const kinds = ["home path", "email", "git email", "hostname"];
    const hits = sec.tree.hits.filter((h) => kinds.includes(h.kind));
    const n = Object.entries(sec.tree.byKind).filter(([k]) => kinds.includes(k)).reduce((a, [, c]) => a + c, 0);
    return n ? fail([`${n} hits: ${Object.entries(sec.tree.byKind).filter(([k]) => kinds.includes(k)).map(([k, c]) => `${c} ${k}`).join(", ")}`, ...hits.slice(0, 12).map((h) => at(h.file, h.line, h.kind))]) : pass(["none"]);
  });
  const pw = await I.privateWords({ history: !!history, commits });
  chk("private-words", "Privacy", "P0", "No private word in the tree or the commit messages", "One list outside every repo; a derived leak (a colleague's name in a test, a real repository name or ticket key in a fixture or plan, a commit message) is what a secret scan misses", "Replace each with made-up test data; reword the commit before the repo goes public", "The word list matches nothing in the tracked files, file names and commit messages", async () => {
    if (!pw.ran) return { status: "unknown", evidence: [`NOT RUN: ${pw.reason}`, "a required NOT RUN blocks the audit"] };
    const n = pw.tree.lines + pw.pathHits + pw.commitMessages.count + (pw.history?.commitsTouching ?? 0);
    const ev = [`list: ${pw.words} words`];
    for (const [f, ls] of Object.entries(pw.tree.byFile)) ev.push(at(f, ls[0], `private word on lines ${ls.join(",")}`));
    for (const f of pw.paths.slice(0, 5)) ev.push(at(f, null, "file name matches"));
    if (pw.commitMessages.count) ev.push(`${pw.commitMessages.count} commit messages match: ${pw.commitMessages.commits.slice(0, 8).join(" ")}`);
    if (pw.history?.commitsTouching) ev.push(`${pw.history.commitsTouching} commits changed a line that matches (history)`);
    return n ? fail(ev) : pass([`list: ${pw.words} words, nothing matched`]);
  });
  chk("raw-captures", "Privacy", "P1", "No raw capture or oversized file is tracked", "Real captures never enter the source repo, not even under artifacts/; they are found only at the readiness audit, after they are in the history", "Move them out, use synthetic fixtures, rewrite history before going public", "No tracked file is a capture, dump or over 1 MB", async () => {
    const fsx = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const bad = [];
    for (const f of fl) {
      if (/(^|\/)(fixtures?|__snapshots__|test|tests|docs\/assets|assets|site)\//i.test(f) && !/(^|\/)(captures?|recordings?|dumps?)\//i.test(f)) continue;
      let size = 0;
      try {
        size = fsx.statSync(path.join(rp.root, f)).size;
      } catch {}
      if (/(^|\/)(captures?|recordings?|dumps?)\//i.test(f) || /\.(har|pcap|sqlite3?|db)$/i.test(f)) bad.push(at(f, null, "capture-style file"));
      else if (size > 1_000_000 && !/\.(png|jpe?g|gif|webp|mp4|mov|webm|pdf|woff2?|svg|lock)$/i.test(f) && !/lock/.test(f)) bad.push(at(f, null, `${(size / 1e6).toFixed(1)} MB`));
    }
    return bad.length ? fail(bad.slice(0, 10)) : pass(["no capture-style or oversized tracked file"]);
  });
  chk("public-private-split", "Privacy", "P1", "The public/private split is in place", "The source goes to a new public repository as squashed commits, filled by an export script; the private repository keeps `.claude/`, plans and handoffs; a public tree never carries them", "Private repo: copy templates/scripts/export-public and its .conf and list what never goes public. Public repo: git rm --cached the private paths", "Public: none of .claude, docs/plans, docs/handoffs is tracked. Private: export-public and its .conf exist", async () => {
    const priv = fl.filter((f) => /^(\.claude\/|docs\/(plans|handoffs)\/|\.mike\/)/.test(f));
    if (isPublic) return priv.length ? fail([`the repository is public and ${priv.length} private-looking paths are tracked`, ...priv.slice(0, 6).map((f) => at(f, null, "tracked in a public repo"))]) : pass(["public repo tracks no .claude/, docs/plans, docs/handoffs"]);
    if (visibility === "PRIVATE") {
      const exp = fl.includes("scripts/export-public") && fl.includes("scripts/export-public.conf");
      return exp ? pass(["scripts/export-public and scripts/export-public.conf"]) : fail(["the repository is private and has no scripts/export-public with its .conf, which the first public release goes through"]);
    }
    return priv.length ? { status: "unknown", evidence: ["visibility not readable from this account", `${priv.length} private-looking paths are tracked: ${priv.slice(0, 3).join(", ")}; fine in a private repo, blocking in a public one`] } : noGh();
  });
  chk("hooks", "Privacy", "P1", "Private-word hooks are wired", "Private-word hooks: `git config core.hooksPath scripts/hooks`, then scripts/hooks/test-hooks; hooks refuse a commit without the list", "Copy templates/scripts/hooks, then `git config core.hooksPath scripts/hooks`", "core.hooksPath points at a folder with a pre-commit hook", async () => {
    const hp = (await I.gitTry("config", "--get", "core.hooksPath")) ?? null;
    const pre = first(/^scripts\/hooks\/pre-commit$/) ?? first(/^\.(githooks|husky)\/pre-commit$/);
    if (!pre) return fail(["no scripts/hooks/pre-commit"]);
    return hp ? pass([at(pre, 1), `core.hooksPath = ${hp}`]) : fail([at(pre, 1, "exists"), "core.hooksPath is not set in this clone"]);
  });
  chk("sandbox", "Quality", "P2", "Tests are hermetic: a sandbox variable and TZ=UTC", "A <NAME>_SANDBOX env var and `TZ=UTC` in .cargo/config.toml; a test that reaches the real network or reads the local time zone behaves differently on another machine", "Copy templates/.cargo/config.toml and honour the variable in code", ".cargo/config.toml sets both", async () => {
    if (!cargo) return na("no Cargo.toml");
    const t = tryRead(".cargo/config.toml");
    if (t == null) return fail(["no .cargo/config.toml"]);
    const miss = [];
    if (!/_SANDBOX\s*=/.test(t)) miss.push("no *_SANDBOX variable");
    if (!/TZ\s*=\s*"?UTC/.test(t)) miss.push("no TZ=UTC");
    return miss.length ? fail([at(".cargo/config.toml", 1), ...miss]) : pass([at(".cargo/config.toml", lineOf(t, /_SANDBOX/))]);
  });

  // ---- versions ----
  chk("versions-agree", "Version", "P0", "The version is the same everywhere it is written", "One workspace SemVer; bump version and lockfile together; tag `v<version>` must equal the manifest", "release.setVersion(<version>) rewrites every place; then commit", "versions().agree is true", async () => {
    if (!ver.places.length) return na("no version found in any manifest");
    const ev = ver.places.slice(0, 14).map((x) => at(x.file, x.line, `${x.key} = ${x.value}`));
    return ver.agree ? pass([`${ver.places.length} places carry ${ver.primary}`, ...ev.slice(0, 6)]) : fail([`${ver.mismatched.length} of ${ver.places.length} places differ from ${ver.primary} (${ver.primaryFrom})`, ...ver.mismatched.map((x) => at(x.file, x.line, `${x.key} = ${x.value}`))]);
  });
  chk("lockfile", "Version", "P1", "A lockfile is committed", "[N] lockfile committed, `npm ci`; [R] `--locked` everywhere", "Commit package-lock.json or Cargo.lock", "The lockfile is tracked", async () => {
    const miss = [];
    if (npm && !fl.some((f) => /^(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(f))) miss.push("no lockfile next to package.json");
    if (cargo && !fl.includes("Cargo.lock")) miss.push("no Cargo.lock");
    return !npm && !cargo ? na("no package manager") : miss.length ? fail(miss) : pass(["lockfile tracked"]);
  });
  chk("tag-format", "Version", "P0", "Tags are v<semver> and agree with the manifest", "Tag `v<version>` must equal the manifest; never move a tag or replace assets: publish the next one", "Create the tag from the version (release.tag) or fix the manifest; never move a tag", "The newest tag equals the manifest version, or the manifest is ahead of it", async () => {
    if (!tg.length) return { status: "pass", evidence: ["no release tag yet (a first release)"] };
    const bad = tg.filter((t) => !/^v\d/.test(t.name));
    const lt = ver.latestTag;
    const ev = [`latest tag ${lt.name} (${lt.date?.slice(0, 10)})`, `manifest ${ver.primary}`];
    if (bad.length) return fail([...ev, `tags without the v prefix: ${bad.slice(0, 5).map((t) => t.name).join(", ")}`]);
    if (lt.atHead && !lt.matchesPrimary) return fail([...ev, "HEAD is the tagged commit but the manifest carries another version"]);
    const [a, b] = [lt.version, ver.primary].map((x) => (x ?? "0.0.0").split(/[.-]/).slice(0, 3).map(Number));
    if (ver.primary && b.some((n, i) => (n ?? 0) !== (a[i] ?? 0)) && (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2]))))) return fail([...ev, "the manifest version is older than the newest tag"]);
    return pass([...ev, ver.manifestAheadOfTag ? "manifest is ahead of the tag: a release is pending" : "manifest equals the tag"]);
  });
  chk("changelog", "Version", "P1", "A changelog entry exists for the version", "A reader of a release needs to know what changed in it; the changelog entry or the release notes say so", "release.writeChangelog(<version>) writes the entry from the commits since the last tag", "A heading for the manifest version exists in the changelog, or the GitHub release carries notes", async () => {
    const c = ver.changelog;
    if (!c.file) return fail(["no CHANGELOG file (CHANGELOG.md, docs/CHANGELOG.md)"]);
    if (ver.primary && c.hasEntryForPrimary) return pass([at(c.file, c.line, `top entry ${c.topVersion}`)]);
    return fail([at(c.file, c.line, `top entry is ${c.topVersion ?? "none"}; the manifest is ${ver.primary}`)]);
  });

  // ---- packaging ----
  chk("npm-package", "Packaging", "P1", "The npm package is complete", "[N] packaging: `files`, `bin`, `exports` point at things that exist; notices and LICENSE ship", "Fix package.json: add the missing fields, correct the listed paths", "Every file listed under files, bin, main and exports exists", async () => {
    if (!npm) return na("no package.json");
    if (npm.private) return na("package.json is private: npm is not a channel");
    const pj = json("package.json");
    const t = read("package.json");
    const bad = [];
    for (const k of ["name", "version", "description", "license", "repository", "bugs", "homepage", "engines"]) if (pj[k] == null) bad.push(at("package.json", null, `no ${k}`));
    if (!pj.files && !fl.includes(".npmignore")) bad.push(at("package.json", null, "no `files` and no .npmignore: the whole tree ships"));
    const exists = (rel) => fl.some((f) => f === rel || f.startsWith(rel.replace(/\/$/, "") + "/"));
    for (const e of pj.files ?? []) {
      if (/[*!?]/.test(e)) continue;
      if (!exists(e.replace(/^\.\//, ""))) bad.push(at("package.json", lineOf(t, new RegExp(`"${e.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"`)), `files entry ${e} does not exist`));
    }
    const bins = typeof pj.bin === "string" ? [pj.bin] : Object.values(pj.bin ?? {});
    for (const b of bins) {
      const rel = b.replace(/^\.\//, "");
      if (!exists(rel)) bad.push(at("package.json", lineOf(t, /"bin"/), `bin target ${b} does not exist`));
      else {
        const first = (tryRead(rel) ?? "").split("\n")[0];
        if (!first.startsWith("#!")) bad.push(at(rel, 1, "bin file has no shebang"));
      }
    }
    const targets = [];
    const walk = (x) => (typeof x === "string" ? targets.push(x) : x && typeof x === "object" ? Object.values(x).forEach(walk) : null);
    walk(pj.exports);
    if (pj.main) targets.push(pj.main);
    for (const x of targets) if (x.startsWith("./") && !/[*]/.test(x) && !exists(x.slice(2))) bad.push(at("package.json", lineOf(t, /"(exports|main)"/), `${x} does not exist`));
    if (pj.files && bins.some((b) => !pj.files.some((e) => b.replace(/^\.\//, "").startsWith(e.replace(/^\.\//, "").replace(/\/$/, ""))))) bad.push(at("package.json", lineOf(t, /"files"/), "a bin target is outside `files`"));
    return bad.length ? fail(bad.slice(0, 12)) : pass([at("package.json", lineOf(t, /"files"/), `files: ${(pj.files ?? []).join(", ") || "(all)"}`), `bin: ${bins.join(", ") || "none"}`]);
  });
  chk("cargo-metadata", "Packaging", "P1", "Cargo metadata is complete for publishable crates", "[R] cargo metadata: description, license and repository in each publishable crate", "Add description, license and repository to each publishable crate", "Each crate with publish != false has description, license and repository", async () => {
    if (!cargo) return na("no Cargo.toml");
    const pub = crates.filter((c) => c.publish !== "false" && cargo.workspace?.publish !== "false");
    if (!pub.length) return na("every crate has publish = false (crates.io is not a channel; archives are)");
    const bad = [];
    for (const c of pub) {
      if (!c.description) bad.push(at(c.file, null, `${c.name} has no description`));
      if (!c.licenseKey && !cargo.workspace?.license) bad.push(at(c.file, null, `${c.name} has no license`));
      if (!c.repository) bad.push(at(c.file, null, `${c.name} has no repository`));
    }
    return bad.length ? fail(bad.slice(0, 10)) : pass(pub.map((c) => c.file));
  });
  const ships = cargo && crates.some((c) => c.bin) && (relWf.length > 0 || fl.includes("scripts/export-public"));
  chk("homebrew-tap", "Packaging", "P2", "A Homebrew tap and formula renderer exist", "A Homebrew tap `<org>/homebrew-<name>`, installed by full name `brew install <org>/<name>/<name>`; HOMEBREW_TAP_TOKEN as a secret on the public repository", "Create <org>/homebrew-<name> and copy templates/scripts/render-homebrew-formula (only when the owner says to: outward-facing)", "scripts/render-homebrew-formula exists and the tap repository is readable", async () => {
    if (!ships) return na("not a shipped binary yet (no Rust binary with a release workflow or export script)");
    const name = (crates.find((c) => c.bin)?.name ?? "").replace(/^@[^/]+\//, "");
    const ev = [];
    const bad = [];
    if (fl.includes("scripts/render-homebrew-formula")) ev.push("scripts/render-homebrew-formula");
    else bad.push("no scripts/render-homebrew-formula");
    if (remote && slug) {
      const org = slug.split("/")[0];
      const r = await I.gh("repo", "view", `${org}/homebrew-${name}`, "--json", "name");
      if (r.code === 0) ev.push(`${org}/homebrew-${name} exists`);
      else bad.push(`${org}/homebrew-${name} is not reachable from this account (a 404 is not proof it does not exist)`);
    }
    return bad.length ? fail([...ev, ...bad]) : pass(ev);
  });
  chk("mise-install", "Packaging", "P2", "The README documents the mise install", "mise `github:<org>/<name>` with `prerelease = true, minimum_release_age = \"0s\"`", "Add the mise stanza from templates/docs/RELEASING.md to the README", "README shows the mise install line", async () => {
    if (!ships) return na("not a shipped binary yet");
    const l = readmeText && lineOf(readmeText, /mise/i);
    return l ? pass([at(readme, l)]) : fail(["README does not mention mise"]);
  });

  // ---- remote ----
  chk("repo-metadata", "Remote", "P2", "The GitHub repository has a description and topics", "Remote state is read from GitHub, not inferred from YAML", "gh repo edit --description ... --add-topic ...", "description and at least one topic are set", async () => {
    if (!meta) return noGh();
    const topics = meta.repositoryTopics ?? [];
    const bad = [];
    if (!meta.description) bad.push("no description");
    if (!topics.length) bad.push("no topics");
    return bad.length ? fail([`${meta.url}: ${bad.join(", ")}`]) : pass([`${visibility}, ${topics.length} topics, licence ${meta.licenseInfo?.key ?? "none detected"}`]);
  });
  chk("branch-protection", "Remote", "P1", "The default branch is protected", "Enable private vulnerability reporting and branch protection on the public repo", "Enable branch protection or a ruleset on the default branch", "A protection rule or ruleset applies to the default branch", async () => {
    if (!meta) return noGh();
    const r = await I.gh("api", `repos/${slug}/rules/branches/${defaultBranch}`);
    let rules = [];
    try {
      rules = JSON.parse(r.out);
    } catch {}
    if (r.code === 0 && rules.length) return pass([`${rules.length} ruleset rules apply to ${defaultBranch}`]);
    const b = await I.gh("api", `repos/${slug}/branches/${defaultBranch}/protection`);
    if (b.code === 0) return pass([`branch protection on ${defaultBranch}`]);
    if (/not protected/i.test(b.out + b.err)) return fail([`${slug}: ${defaultBranch} has no protection rule and no ruleset`]);
    if (/upgrade|403|private/i.test(b.out + b.err)) return { status: "unknown", evidence: [`protection could not be read for ${visibility} ${slug}: ${(b.out + b.err).split("\n")[0].slice(0, 120)}`] };
    return { status: "unknown", evidence: [(b.err || b.out).split("\n")[0].slice(0, 160)] };
  });
  chk("vulnerability-reporting", "Remote", "P1", "Private vulnerability reporting is on", "Enable private vulnerability reporting", "Settings > Security > Private vulnerability reporting", "The API reports enabled: true", async () => {
    if (!meta) return noGh();
    const r = await I.gh("api", `repos/${slug}/private-vulnerability-reporting`);
    if (r.code !== 0) return { status: "unknown", evidence: [(r.err || r.out).split("\n")[0].slice(0, 160)] };
    try {
      return JSON.parse(r.out).enabled ? pass(["enabled"]) : fail([`${slug}: private vulnerability reporting is off`]);
    } catch {
      return { status: "unknown", evidence: ["unreadable reply"] };
    }
  });
  chk("ci-green", "Remote", "P1", "The latest CI run on the default branch passed", "A billing or 'Actions allowed' refusal shows as a run that fails before any step; say so rather than calling CI green", "Open the run and fix its first failing step", "The newest completed run on the default branch concluded success", async () => {
    if (!slug) return noGh();
    let runs;
    try {
      runs = await I.ghJson("run", "list", "-R", slug, "--branch", defaultBranch, "--limit", "8", "--json", "conclusion,status,workflowName,url,createdAt,databaseId,event");
    } catch (e) {
      return { status: "unknown", evidence: [e.message.slice(0, 160)] };
    }
    const done = runs.filter((r) => r.status === "completed" && r.event !== "dynamic");
    if (!done.length) return { status: "unknown", evidence: ["no completed run on " + defaultBranch] };
    const last = done[0];
    const ev = [`${last.workflowName}: ${last.conclusion} (${last.url})`, `last ${done.length} completed: ${done.map((r) => r.conclusion).join(" ")}`];
    if (last.conclusion === "success") return pass(ev);
    try {
      const j = await I.ghJson("run", "view", String(last.databaseId), "-R", slug, "--json", "jobs");
      const noSteps = (j.jobs ?? []).length > 0 && j.jobs.every((x) => !x.steps?.length);
      if (noSteps) ev.push("every job failed before running a step: a billing or Actions-allowed refusal, not a test failure");
    } catch {}
    return fail(ev);
  });
  chk("release-published", "Remote", "P1", "The latest tag has a published GitHub release with its assets", "A tag without a release ships nothing; four archives, checksums.txt and the formula for a binary", "Run the release workflow for the tag or release.githubRelease(<version>) when asked", "A non-draft release exists for the newest tag", async () => {
    if (!slug) return noGh();
    if (!tg.length) return na("no tag yet");
    const name = tg[0].name;
    try {
      const rel = await I.ghJson("release", "view", name, "-R", slug, "--json", "tagName,publishedAt,isDraft,isPrerelease,assets,body");
      if (rel.isDraft) return fail([`${name} is a draft release`]);
      const ev = [`${name} published ${api.localTime(rel.publishedAt)}, ${rel.assets.length} assets, notes ${rel.body?.length ?? 0} chars`];
      if (ships && rel.assets.length < 5) return fail([...ev, "a binary release should carry four archives and checksums.txt"]);
      return pass(ev);
    } catch (e) {
      return /not found|404/i.test(e.message) ? fail([`${name} has no GitHub release`]) : { status: "unknown", evidence: [e.message.slice(0, 160)] };
    }
  });
  chk("published-matches", "Remote", "P1", "The published version matches the manifest", "Install from the channel before saying released", "Publish through the release workflow (push the tag) when asked", "npm view and the GitHub release show the manifest's version", async () => {
    const pub = ver.published ?? {};
    const ev = [];
    const bad = [];
    for (const [k, x] of Object.entries(pub)) {
      if (x.status && x.status !== "published") ev.push(`${k}: ${x.status}${x.error ? " (" + x.error + ")" : ""}`);
      else if (x.matchesPrimary === false) bad.push(`${k} is at ${x.version ?? x.tagName}, the manifest is ${ver.primary}`);
      else if (x.matchesPrimary) ev.push(`${k} ${x.version ?? x.tagName} = manifest`);
    }
    if (!remote) return { status: "unknown", evidence: ["remote: false"] };
    if (!Object.keys(pub).length) return na("nothing to compare");
    if (bad.length) return fail([...bad, ...ev]);
    return ev.some((e) => /unreadable/.test(e)) ? { status: "unknown", evidence: ev } : pass(ev);
  });
  chk("stale-blockers", "Remote", "P2", "Docs do not name a blocker that has cleared", "A blocker has an owner and a date and is re-checked at every status update; delete the explanation when it clears", "Compare each line below with the current state and delete or date it", "Each listed line is true today", async () => {
    const hits = [];
    for (const f of fl.filter((x) => /\.md$/i.test(x) && !/(^|\/)(CHANGELOG|THIRD-PARTY|node_modules)/i.test(x) && !/^(docs\/(plans|decisions|measurements)|\.claude)\//.test(x)).slice(0, 400)) {
      const t = tryRead(f);
      t?.split("\n").forEach((l, i) => {
        if (/\b(waiting (on|for)|blocked (on|by)|CI (is )?(frozen|refus)|pending approval|billing (limit|refus|fail)\w*)\b/i.test(l) && l.length < 300) hits.push(at(f, i + 1, l.trim().slice(0, 80)));
      });
    }
    return hits.length ? { status: "unknown", evidence: [`${hits.length} lines say something is waiting or blocked; check each against today`, ...hits.slice(0, 8)] } : pass(["none found"]);
  });

  const results = [];
  for (const c of checks) {
    let r;
    try {
      r = await c.run();
    } catch (e) {
      r = { status: "unknown", evidence: [`the check itself failed: ${String(e.message).slice(0, 200)}`] };
    }
    results.push({ id: c.id, group: c.group, severity: c.sev, title: c.title, status: r.status, evidence: r.evidence, reason: c.reason, fix: c.fix, acceptance: c.accept });
  }

  const count = (s) => results.filter((r) => r.status === s).length;
  const order = (a, b) => SAFE_SEV[a.severity] - SAFE_SEV[b.severity];
  const blocking = results.filter((r) => (r.severity === "P0" || r.severity === "P1") && (r.status === "fail" || (r.status === "unknown" && r.group !== "Remote"))).sort(order);
  const other = results.filter((r) => r.status === "fail" && r.severity === "P2");
  const unknownOther = results.filter((r) => r.status === "unknown" && !blocking.includes(r));
  const brief = (r) => ({ id: r.id, severity: r.severity, status: r.status === "unknown" ? "NOT RUN / unreadable" : "FAIL", title: r.title, evidence: r.evidence, reason: r.reason, fix: r.fix, acceptance: r.acceptance });
  const groups = {};
  for (const r of results) (groups[r.group] ??= []).push(`${r.status === "pass" ? "pass" : r.status === "fail" ? "FAIL" : r.status === "na" ? "n/a" : "NOT RUN"} ${r.id}`);
  const commit = rp.head;
  const out = {
    repo: slug ?? rp.root, commit, branch: rp.branch, dirtyTrackedFiles: rp.dirty, visibility, projectKinds: p.kinds, version: ver.primary,
    headline: blocking.map((r) => `${r.severity} ${r.id}: ${r.status === "fail" ? "FAIL" : "NOT RUN"} - ${r.evidence.slice(0, 2).join("; ").slice(0, 200)}`),
    decision: blocking.length ? "not ready" : "ready (to the extent these checks cover)",
    counts: { pass: count("pass"), fail: count("fail"), notRun: count("unknown"), notApplicable: count("na"), total: results.length, blocking: blocking.length },
    blocking: blocking.map(brief),
    otherFailures: other.map(brief),
    notRun: unknownOther.map((r) => ({ id: r.id, severity: r.severity, status: "NOT RUN / unreadable", title: r.title, evidence: r.evidence })),
    byGroup: groups,
    notCertified: [
      "no install journey was run on a machine that is not the maintainer's",
      "no storage or lifecycle journey (lane C) and no fresh-clone test run (lane D)",
      "no release artifact was built or inspected, and no visibility was changed",
      "screenshots, fixtures and plans were not read; the secret and private-word scans are pattern matches (a value with no recognisable shape is not found)",
      "a GitHub 404 means not reachable from this account, not absent",
      history ? `history scans cover the newest ${commits} commits` : "history was not scanned",
    ],
    pinned: `commit ${commit}`,
  };
  if (o.detail) out.checks = results;
  else out.passed = results.filter((r) => r.status === "pass").map((r) => r.id);
  out.notApplicable = results.filter((r) => r.status === "na").map((r) => `${r.id}: ${r.evidence[0]}`);
  return out;
}
