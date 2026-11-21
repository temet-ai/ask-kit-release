// A client for a repository's release state: where its version is written, what is unreleased,
// what is published, what looks like a secret or a private word, and the readiness audit of the
// release-readiness audit. It reads. When the caller asked for a change (`act`) it can also add
// a missing file from the templates folder (setting TEMPLATES, default the kit's templates folder), set the version, write the changelog entry, create a
// tag, and, only with `confirm` equal to the version, push the tag, publish or create the release.
//
// Checks: a call that changes a file, a tag or a remote needs `act`; pushing a tag, publishing and
// creating a GitHub release need `act` and `confirm` equal to the version string; what the
// investigator reads goes to a cloud model, so files that hold credentials are never read, a secret
// scan reports the file, the line and the kind and never the text, and the private-word list is
// read here and never printed; every program runs with an argument array (no shell) and a timeout.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./audit.mjs";

// The kit's own folder: the bundled templates and scaffold script live here when the settings do not name others.
const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));

const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};
const refuse = (why) => {
  throw new Error(`refused: ${why}`);
};

// Files that hold credentials: never read, never searched, never printed.
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$|dist$)[^/]*)?|\.npmrc|\.yarnrc(\.yml)?|\.netrc|\.pypirc|credentials[^/]*|auth\.json|id_rsa[^/]*|id_ed25519[^/]*|[^/]*\.(pem|key|p12|pfx|keystore))$/i;
const SKIP_SCAN = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock|Cargo\.lock|[^/]*\.min\.(js|css)|[^/]*\.map|[^/]*\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|webm|wasm|so|dylib|node)|THIRD-PARTY-NOTICES\.md)$/i;
const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// Token shapes and where a scan looks for them. The kinds a secret-scanning script usually looks for.
const TOKENS = [
  ["github token", /\bgh[opusr]_[A-Za-z0-9]{20,}/],
  ["github token", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["gitlab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["api key", /\bsk-(?:ant-|proj-|or-v1-)?[A-Za-z0-9_-]{20,}/],
  ["aws key", /\bAKIA[0-9A-Z]{16}\b/],
  ["google key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ["bearer", /\b[Bb]earer [A-Za-z0-9._~+/-]{20,}/],
  ["token field", /"(?:access|refresh|id|auth|api)_?(?:[Tt]oken|[Kk]ey)"\s*:\s*"[^"]{8,}"/],
  ["npmrc token", /_authToken\s*=\s*(?!\$\{)[A-Za-z0-9._~+/=-]{10,}/],
  ["db url", /\b(?:postgres|postgresql|mysql|mongodb)(?:\+srv)?:\/\/[^:/@\s]+:(?<pw>[^@\s]{3,})@/],
];
// A match that is plainly a stand-in is not a finding.
const PLACEHOLDER = /:(pass|password|secret|pw|changeme|hunter2|\*+)@|example|placeholder|x{4,}|\*{3,}|your[_-]|<[^>]+>|\$\{|\{\{|fake|dummy|redacted|\.\.\.|0{8,}|abcdefgh/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const OK_EMAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.github\.com|localhost)$|^(noreply|git|no-reply)@|^(?:[a-z]+)@(?:v?\d)/i;

const mask = (s) =>
  String(s ?? "")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1***@")
    .replace(/\bgh[opusr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bnpm_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9_-]{20,}/g, "***")
    .replace(/(_authToken\s*=\s*)\S+/g, "$1***");

const ENV = {
  GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_ASKPASS: "true", SSH_ASKPASS: "true", GCM_INTERACTIVE: "never",
  GIT_OPTIONAL_LOCKS: "0", NO_COLOR: "1", LC_ALL: "C", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GH_NO_UPDATE_NOTIFIER: "1", GH_SPINNER_DISABLED: "1",
  npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false", CARGO_TERM_COLOR: "never", CI: "1",
};

function exec(cmd, args, { cwd, timeoutMs = 60_000, input, maxBuffer = 64 << 20, raw = false } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer, encoding: "utf8", env: { ...process.env, ...ENV } }, (err, stdout, stderr) => {
      if (err?.code === "ENOENT") resolve({ code: 127, out: "", err: `${cmd} is not installed` });
      else resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: raw ? stdout : mask(stdout), err: mask(stderr).slice(0, 4000), ...(err?.killed ? { timedOut: true } : {}) });
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

/** "2026-11-20T09:19:02Z" -> "2026-11-20 10:19 GMT+1" for timeZone "Europe/Paris". timeZone is an IANA name; without one the machine's zone is used. */
export const makeLocalTime = (timeZone) => (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  try {
    const f = new Intl.DateTimeFormat("en-ZA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
};

export function make({ settings, push, cwd, act }) {
  const start = settings?.REPO_ROOT || cwd || process.cwd();
  return makeRelease({ cwd: start, push, act: !!act, settings: settings ?? {} });
}

export function makeRelease({ cwd, push = () => {}, act = false, settings = {} }) {
  const localTime = makeLocalTime(settings.TIMEZONE);
  const tilde = (p) => (p ? String(p).replace(/^~(?=\/|$)/, os.homedir()) : p);
  const trace = (kind, detail, started, r) => push({ kind, detail: String(detail).slice(0, 200), ms: Date.now() - started, ...(r ? { code: r.code, size: r.out.length } : {}) });
  const needAct = (what) => {
    if (!act) notInThisAsk(what);
  };
  const needConfirm = (what, version, confirm) => {
    needAct(what);
    if (!version || String(confirm) !== String(version)) refuse(`${what} is irreversible: pass confirm equal to the version string ${JSON.stringify(version)}, and only when the request names that version`);
  };

  // ---- programs -----------------------------------------------------------------------------
  const rawGit = async (args, o = {}) => {
    const t = Date.now();
    const r = await exec("git", ["--no-pager", "-c", "color.ui=false", "-c", "core.quotepath=false", ...args], { cwd, ...o });
    trace("git", `git ${args.join(" ")}`, t, r);
    return r;
  };
  const gitText = async (...args) => {
    const r = await rawGit(args);
    if (r.code !== 0) throw new Error(`git ${args.slice(0, 3).join(" ")}: ${(r.err || r.out).trim().slice(0, 300)}`);
    return r.out.replace(/\n+$/, "");
  };
  const gitTry = async (...args) => {
    const r = await rawGit(args);
    return r.code === 0 ? r.out.replace(/\n+$/, "") : null;
  };
  const lines = (s) => (s ? s.split("\n").filter(Boolean) : []);

  const GIT_READS = new Set(["status", "log", "show", "diff", "rev-parse", "rev-list", "ls-files", "ls-tree", "ls-remote", "cat-file", "describe", "shortlog", "merge-base", "name-rev", "for-each-ref", "show-ref", "check-ignore", "diff-tree", "grep", "blame", "version", "cherry", "count-objects", "var"]);
  /** Read-only git: any reading subcommand; tags, branches, remotes and config only as lists or single reads. */
  async function git(...args) {
    const a = args.map(String);
    const sub = a[0];
    const pos = a.slice(1).filter((x) => !x.startsWith("-"));
    const has = (...f) => a.some((x) => f.some((n) => x === n || x.startsWith(n + "=")));
    let ok = GIT_READS.has(sub);
    if (sub === "tag") ok = has("-l", "--list", "--points-at", "--contains", "--merged", "--no-merged", "-n", "--sort") || pos.length === 0;
    if (sub === "branch") ok = has("-l", "--list", "--contains", "--merged", "--no-merged", "--show-current", "-r", "-a", "-vv", "--points-at") || pos.length === 0;
    if (sub === "remote") ok = pos.length === 0 || pos[0] === "get-url";
    if (sub === "config") ok = has("--get", "--get-all") && !pos.some((k) => /credential|token|passw|secret|\.key$|extraheader|proxy/i.test(k));
    if (!ok || has("--output", "--ext-diff", "--exec", "--textconv", "-c") || a.includes("-c")) refuse(`git ${a.slice(0, 3).join(" ")} is not a reading call here. Use the typed calls (release.tag, release.pushTag, ...) when the caller asked for a change.`);
    return rawGit(a);
  }

  const GH_READ = [["repo", "view"], ["release", "list"], ["release", "view"], ["run", "list"], ["run", "view"], ["workflow", "list"], ["workflow", "view"]];
  /** Read-only gh: repo view, release list and view, run list and view, workflow list and view, and `api` GET calls. */
  async function gh(...args) {
    const a = args.map(String);
    const isApi = a[0] === "api";
    const okRead = GH_READ.some(([x, y]) => a[0] === x && a[1] === y);
    if (!isApi && !okRead) refuse(`gh ${a.slice(0, 2).join(" ")} is not a reading call here`);
    if (isApi) {
      const bad = a.some((x, i) => /^(-f|-F|--field|--raw-field|--input)$/.test(x) || /^(-X|--method)$/.test(x) && String(a[i + 1]).toUpperCase() !== "GET" || /^--method=(?!GET$)/i.test(x));
      if (bad) refuse("gh api is allowed for GET only");
      if (a.some((x) => /^\/?(user|app|authorizations|applications)\b/.test(x))) refuse("not a repository fact");
    }
    const t = Date.now();
    const r = await exec("gh", a, { cwd, timeoutMs: 60_000 });
    trace("gh", `gh ${a.join(" ")}`, t, r);
    return r;
  }
  const ghJson = async (...args) => {
    const r = await gh(...args);
    if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")}: ${(r.err || r.out).trim().slice(0, 300)}`);
    try {
      return JSON.parse(r.out);
    } catch {
      throw new Error(`gh ${args.slice(0, 3).join(" ")}: output is not JSON`);
    }
  };

  const npmView = async (name, field = "version") => {
    if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) refuse("not a package name");
    const t = Date.now();
    const r = await exec("npm", ["view", name, field, "--json"], { cwd: os.tmpdir(), timeoutMs: 40_000 });
    trace("npm", `npm view ${name} ${field}`, t, r);
    if (r.code !== 0) return /E404|404 Not Found/.test(r.err + r.out) ? { status: "not published" } : { status: "unreadable", error: (r.err || r.out).trim().split("\n")[0].slice(0, 160) };
    try {
      return { status: "published", value: JSON.parse(r.out) };
    } catch {
      return { status: "unreadable", error: "output is not JSON" };
    }
  };

  // ---- files ----------------------------------------------------------------------------------
  const root = cwd;
  let _files = null;
  const files = async () => (_files ??= (await gitText("ls-files", "-z")).split("\0").filter(Boolean));
  const has = async (re) => (await files()).filter((f) => (re instanceof RegExp ? re.test(f) : f === re));
  const abs = (f) => {
    const p = path.resolve(root, f);
    if (p !== root && !p.startsWith(root + path.sep)) refuse(`${f} is outside the repository`);
    return p;
  };
  const read = (f) => {
    if (SECRET_FILE.test(f)) refuse(`${f} can hold credentials and is never read`);
    return fs.readFileSync(abs(f), "utf8");
  };
  const tryRead = (f) => {
    try {
      return read(f);
    } catch {
      return null;
    }
  };
  const lineOf = (text, re) => {
    if (text == null) return null;
    const ls = text.split("\n");
    for (let i = 0; i < ls.length; i++) if (re.test(ls[i])) return i + 1;
    return null;
  };
  const json = (f) => {
    try {
      return JSON.parse(read(f));
    } catch {
      return null;
    }
  };

  // ---- the repository -------------------------------------------------------------------------
  const slugOf = (url) => {
    const m = String(url ?? "").match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  };
  async function repo() {
    const top = await gitText("rev-parse", "--show-toplevel");
    const remote = await gitTry("remote", "get-url", "origin");
    const head = await gitTry("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    let base = head;
    if (!base) for (const b of ["origin/main", "origin/master", "main", "master"]) if ((await gitTry("rev-parse", "--verify", "--quiet", b)) != null) { base = b; break; }
    const branch = await gitTry("symbolic-ref", "--short", "HEAD");
    const st = lines(await gitText("status", "--porcelain=v1", "--untracked-files=no"));
    return {
      root: top, branch, head: await gitTry("rev-parse", "--short", "HEAD"), defaultRef: base, defaultBranch: base ? base.replace(/^origin\//, "") : null,
      remote: remote ? mask(remote) : null, slug: slugOf(remote), dirty: st.length, tracked: (await files()).length,
    };
  }

  const tomlTable = (text, header) => {
    const ls = text.split("\n");
    const start = ls.findIndex((l) => l.trim() === `[${header}]`);
    if (start < 0) return null;
    const body = [];
    for (let i = start + 1; i < ls.length && !/^\s*\[/.test(ls[i]); i++) body.push([i + 1, ls[i]]);
    return { line: start + 1, body };
  };
  const tomlKey = (t, key) => {
    if (!t) return null;
    for (const [n, l] of t.body) {
      const m = l.match(new RegExp(`^\\s*${key.replace(/\./g, "\\.")}\\s*=\\s*(.+?)\\s*(#.*)?$`));
      if (m) return { line: n, raw: m[1], value: m[1].replace(/^"|"$/g, "") };
    }
    return null;
  };

  /** What kind of project this is and where its manifests are. */
  async function project() {
    const fl = await files();
    const out = { root, kinds: [], npm: null, cargo: null, plugins: [], formulas: [] };
    if (fl.includes("package.json")) {
      const pj = json("package.json");
      if (pj) {
        out.kinds.push("npm");
        out.npm = { name: pj.name ?? null, version: pj.version ?? null, private: !!pj.private, bin: pj.bin ?? null, files: pj.files ?? null, license: pj.license ?? null };
      }
    }
    const cargoFiles = fl.filter((f) => /(^|\/)Cargo\.toml$/.test(f) && f.split("/").length <= 4 && !f.startsWith("target/"));
    if (fl.includes("Cargo.toml") || cargoFiles.length) {
      out.kinds.push("cargo");
      const crates = [];
      let ws = null;
      for (const f of cargoFiles) {
        const text = tryRead(f);
        if (!text) continue;
        const wsPkg = tomlTable(text, "workspace.package");
        if (f === "Cargo.toml" && (tomlTable(text, "workspace") || wsPkg)) {
          ws = { file: f, version: tomlKey(wsPkg, "version")?.value ?? null, versionLine: tomlKey(wsPkg, "version")?.line ?? null, license: tomlKey(wsPkg, "license")?.value ?? null, publish: tomlKey(wsPkg, "publish")?.raw ?? null };
        }
        const pkg = tomlTable(text, "package");
        if (pkg) {
          const name = tomlKey(pkg, "name")?.value;
          const v = tomlKey(pkg, "version");
          const pub = tomlKey(pkg, "publish");
          const lic = tomlKey(pkg, "license") || tomlKey(pkg, "license.workspace") || tomlKey(pkg, "license-file");
          const bin = /\[\[bin\]\]/.test(text) || fl.includes(path.posix.join(path.posix.dirname(f), "src/main.rs"));
          crates.push({ name, file: f, version: v ? (v.raw === "true" ? null : v.value) : null, versionLine: v?.line ?? null, versionWorkspace: !!tomlKey(pkg, "version.workspace"), publish: pub?.raw ?? null, licenseKey: lic ? lic.raw : null, licenseLine: lic?.line ?? null, description: !!(tomlKey(pkg, "description") || tomlKey(pkg, "description.workspace")), repository: !!(tomlKey(pkg, "repository") || tomlKey(pkg, "repository.workspace")), bin });
        }
      }
      out.cargo = { workspace: ws, crates };
    }
    for (const f of fl) {
      const b = path.posix.basename(f);
      if (["plugin.json", "marketplace.json", "server.json", "gemini-extension.json", "mod.json"].includes(b) && !/(^|\/)(node_modules|test|tests|fixtures?)\//.test(f)) out.plugins.push(f);
      if (/(^|\/)Formula\/[^/]+\.rb$/.test(f)) out.formulas.push(f);
    }
    return out;
  }

  // ---- versions -------------------------------------------------------------------------------
  let _tags = null;
  async function tags() {
    if (_tags) return _tags;
    const fmt = "%(refname:short)%09%(objecttype)%09%(objectname:short)%09%(*objectname:short)%09%(creatordate:iso-strict)";
    const out = await gitTry("-c", "versionsort.suffix=-", "tag", "--list", "--sort=-v:refname", `--format=${fmt}`);
    return (_tags = lines(out).map((l) => {
      const [name, type, o, deref, date] = l.split("\t");
      return { name, annotated: type === "tag", sha: deref || o, date };
    }).filter((t) => SEMVER_TAG.test(t.name)));
  }
  const tagVersion = (name) => name.replace(/^v/, "");

  async function changelogFile() {
    const hit = (await files()).find((f) => /^(docs\/)?(CHANGELOG|CHANGES|HISTORY|NEWS)(\.[a-z]+)?$/i.test(f));
    return hit ?? null;
  }
  /** Version headings of a changelog: [{version, line, heading}], and an "Unreleased" heading when there is one. */
  function changelogEntries(file) {
    const text = file ? tryRead(file) : null;
    if (text == null) return { file, entries: [], unreleased: null };
    const entries = [];
    let unreleased = null;
    text.split("\n").forEach((l, i) => {
      const m = l.match(/^#{1,3}\s*\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/);
      if (m) entries.push({ version: m[1], line: i + 1, heading: l.trim().slice(0, 80) });
      else if (/^#{1,3}\s*\[?unreleased\]?/i.test(l)) unreleased = i + 1;
    });
    return { file, entries, unreleased };
  }

  /** Every place a version is written, whether they agree, the latest tag, and what is published. */
  async function versions({ published = true } = {}) {
    const p = await project();
    const places = [];
    const add = (file, line, key, value, kind) => places.push({ file, line, key, value, kind });
    if (p.npm?.version != null) {
      const text = read("package.json");
      add("package.json", lineOf(text, /^\s*"version"\s*:/), "version", p.npm.version, "manifest");
      if ((await files()).includes("package-lock.json")) {
        const lock = json("package-lock.json");
        const ltext = read("package-lock.json");
        const vl = ltext.split("\n").map((l, i) => (/^\s*"version"\s*:\s*"/.test(l) ? i + 1 : 0)).filter(Boolean);
        if (lock?.version != null) add("package-lock.json", vl[0] ?? null, "version", lock.version, "lock");
        if (lock?.packages?.[""]?.version != null) add("package-lock.json", vl[1] ?? null, 'packages[""].version', lock.packages[""].version, "lock");
      }
    }
    if (p.cargo) {
      const { workspace: ws, crates } = p.cargo;
      if (ws?.version) add("Cargo.toml", ws.versionLine, "workspace.package.version", ws.version, "manifest");
      for (const c of crates) if (c.version) add(c.file, c.versionLine, `${c.name}.version`, c.version, "manifest");
      if ((await files()).includes("Cargo.lock")) {
        const text = read("Cargo.lock").split("\n");
        const names = new Set(crates.map((c) => c.name));
        for (let i = 0; i < text.length; i++) {
          const m = text[i].match(/^name = "([^"]+)"$/);
          const v = text[i + 1]?.match(/^version = "([^"]+)"$/);
          if (m && v && names.has(m[1]) && !text.slice(i + 2, i + 4).some((l) => l.startsWith("source ="))) add("Cargo.lock", i + 2, `${m[1]}`, v[1], "lock");
        }
      }
    }
    for (const f of p.plugins) {
      const text = tryRead(f);
      text?.split("\n").forEach((l, i) => {
        const m = l.match(/^\s*"version"\s*:\s*"([^"]*)"/);
        if (m) add(f, i + 1, "version", m[1], "plugin");
      });
    }
    for (const f of ["ask-kit.toml", "pyproject.toml"]) {
      if (!(await files()).includes(f)) continue;
      const ls = (tryRead(f) ?? "").split("\n");
      let table = "";
      for (let i = 0; i < ls.length; i++) {
        const t = ls[i].match(/^\s*\[+([^\]]+)\]+\s*$/);
        if (t) table = t[1];
        const m = ls[i].match(/^version\s*=\s*"([^"]+)"/);
        if (m && (table === "" || table === "project" || table === "tool.poetry")) {
          add(f, i + 1, "version", m[1], "manifest");
          break;
        }
      }
    }
    for (const f of p.formulas) {
      const text = tryRead(f);
      text?.split("\n").forEach((l, i) => {
        const m = l.match(/^\s*version\s+"([^"]+)"/);
        if (m) add(f, i + 1, "version", m[1], "formula");
      });
    }
    const primary = p.npm?.version ?? p.cargo?.workspace?.version ?? p.cargo?.crates.find((c) => c.version)?.version ?? places[0]?.value ?? null;
    const mismatched = places.filter((x) => x.value !== primary);
    const cl = changelogEntries(await changelogFile());
    const tg = await tags();
    const latest = tg[0] ?? null;
    const rp = await repo();
    const out = {
      primary, primaryFrom: primary == null ? null : p.npm?.version === primary ? "package.json" : places.find((x) => x.value === primary)?.file,
      places, agree: places.length > 0 && mismatched.length === 0, mismatched,
      changelog: { file: cl.file, topVersion: cl.entries[0]?.version ?? null, line: cl.entries[0]?.line ?? null, hasEntryForPrimary: cl.entries.some((e) => e.version === primary), unreleasedLine: cl.unreleased },
      latestTag: latest ? { name: latest.name, version: tagVersion(latest.name), sha: latest.sha, annotated: latest.annotated, date: latest.date } : null,
    };
    if (latest) {
      const headSha = await gitTry("rev-parse", "--short", "HEAD");
      const tagCommit = await gitTry("rev-parse", "--short", `${latest.name}^{commit}`);
      out.latestTag.atHead = headSha != null && headSha === tagCommit;
      out.latestTag.matchesPrimary = tagVersion(latest.name) === primary;
      out.manifestAheadOfTag = primary != null && tagVersion(latest.name) !== primary;
    }
    out.hasTagForPrimary = tg.some((t) => tagVersion(t.name) === primary);
    if (published) {
      const pub = {};
      if (p.npm && !p.npm.private && p.npm.name) {
        const r = await npmView(p.npm.name);
        pub.npm = r.status === "published" ? { name: p.npm.name, version: r.value, matchesPrimary: r.value === primary } : { name: p.npm.name, ...r };
      }
      const crates = (p.cargo?.crates ?? []).filter((c) => c.name && c.publish !== "false");
      const wsNoPublish = p.cargo?.workspace?.publish === "false";
      if (p.cargo && (wsNoPublish || !crates.length)) pub.crate = { status: "not a channel: publish = false" };
      else if (crates[0]) {
        const t = Date.now();
        const r = await exec("cargo", ["search", crates[0].name, "--limit", "1"], { cwd: os.tmpdir(), timeoutMs: 30_000 });
        trace("cargo", `cargo search ${crates[0].name}`, t, r);
        const m = r.out.match(new RegExp(`^${crates[0].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} = "([^"]+)"`, "m"));
        pub.crate = r.code !== 0 ? { name: crates[0].name, status: "unreadable", error: (r.err || r.out).split("\n")[0].slice(0, 160) } : m ? { name: crates[0].name, status: "published", version: m[1], matchesPrimary: m[1] === primary } : { name: crates[0].name, status: "not published" };
      }
      if (rp.slug) {
        try {
          const rel = await ghJson("release", "list", "-R", rp.slug, "--limit", "1", "--json", "tagName,publishedAt,isLatest,isDraft,isPrerelease");
          pub.githubRelease = rel[0] ? { ...rel[0], publishedAtLocal: localTime(rel[0].publishedAt), matchesPrimary: tagVersion(rel[0].tagName) === primary } : { status: "no releases" };
        } catch (e) {
          pub.githubRelease = { status: "unreadable", error: e.message.slice(0, 160) };
        }
      }
      out.published = pub;
    }
    return out;
  }

  // ---- unreleased -----------------------------------------------------------------------------
  const CONV = /^(\w+)(\([^)]*\))?(!)?:\s/;
  async function unreleased({ max = 60 } = {}) {
    const rp = await repo();
    const tg = await tags();
    const latest = tg[0] ?? null;
    const tip = rp.defaultRef ?? "HEAD";
    const range = latest ? `${latest.name}..${tip}` : tip;
    const total = +(await gitText("rev-list", "--count", "--no-merges", range));
    const raw = lines(await gitText("log", "--no-merges", `--max-count=${Math.min(max, 200)}`, "--format=%h%x1f%cI%x1f%s", range));
    const commits = raw.map((l) => {
      const [short, date, subject] = l.split("\x1f");
      const m = subject.match(CONV);
      return { short, date, subject, type: m ? m[1].toLowerCase() : null, breaking: !!m?.[3] || /BREAKING CHANGE/.test(subject) };
    });
    const typed = commits.filter((c) => c.type).length;
    const conventional = commits.length > 0 && typed / commits.length >= 0.5;
    const byType = {};
    for (const c of commits) byType[c.type ?? "other"] = (byType[c.type ?? "other"] ?? 0) + 1;
    const stat = lines((await gitTry("diff", "--numstat", latest ? `${latest.name}...${tip}` : "4b825dc642cb6eb9a060e54bf8d69288fbee4904", ...(latest ? [] : [tip]))) ?? "");
    const folders = {};
    let ins = 0;
    let del = 0;
    for (const l of stat) {
      const [a, d, f] = l.split("\t");
      ins += +a || 0;
      del += +d || 0;
      const top = f.includes("/") ? f.split("/")[0] + "/" : "(root)";
      folders[top] = (folders[top] ?? 0) + 1;
    }
    const v = await versions({ published: false });
    const wt = await gitText("status", "--porcelain=v1", "--untracked-files=no");
    const upstream = await gitTry("rev-list", "--left-right", "--count", `${rp.branch ?? "HEAD"}...@{upstream}`);
    const [ahead, behind] = upstream ? upstream.split("\t").map(Number) : [null, null];
    const draft = buildChangelog(commits, conventional, null, null);
    return {
      lastTag: latest ? { name: latest.name, sha: latest.sha, date: latest.date, dateLocal: localTime(latest.date) } : null, base: tip, commitsSinceTag: total,
      commits: commits.slice(0, max), truncated: total > commits.length ? total - commits.length : 0, conventional, byType,
      files: { changed: stat.length, insertions: ins, deletions: del, byFolder: Object.fromEntries(Object.entries(folders).sort((a, b) => b[1] - a[1]).slice(0, 12)) },
      manifestVersion: v.primary, manifestAheadOfTag: v.manifestAheadOfTag ?? null, changelog: v.changelog,
      workingTree: { branch: rp.branch, dirtyTrackedFiles: lines(wt).length, unpushed: ahead, unpulled: behind },
      draft,
    };
  }

  const TYPE_TITLES = [["feat", "Added"], ["fix", "Fixed"], ["perf", "Changed"], ["refactor", "Changed"], ["docs", "Documentation"], ["revert", "Reverted"]];
  function buildChangelog(commits, conventional, version, date, style = "plain") {
    const rows = commits.filter((c) => !/^(Merge |Release |chore\(release\))/.test(c.subject));
    if (!rows.length) return null;
    const strip = (c) => (c.type ? c.subject.replace(CONV, "") : c.subject);
    const heading = style === "keep" ? `## [${version ?? "Unreleased"}]${date ? ` - ${date}` : ""}` : `## ${version ?? "Unreleased"}${date ? ` (${date})` : ""}`;
    const out = [heading, ""];
    if (!conventional) {
      for (const c of rows) out.push(`- ${strip(c)} (${c.short})`);
    } else {
      const seen = new Set();
      for (const [type, title] of TYPE_TITLES) {
        if (seen.has(title)) continue;
        const group = rows.filter((c) => TYPE_TITLES.filter(([, t]) => t === title).some(([ty]) => ty === c.type));
        if (!group.length) continue;
        seen.add(title);
        out.push(`### ${title}`, "", ...group.map((c) => `- ${strip(c)} (${c.short})`), "");
      }
      const rest = rows.filter((c) => !TYPE_TITLES.some(([ty]) => ty === c.type));
      if (rest.length) out.push("### Other", "", ...rest.map((c) => `- ${strip(c)} (${c.short})`), "");
    }
    return out.join("\n").replace(/\n+$/, "\n");
  }

  // ---- status ---------------------------------------------------------------------------------
  async function status() {
    const rp = await repo();
    const v = await versions();
    const u = await unreleased({ max: 15 });
    const out = { repo: rp.slug, version: v.primary, lastTag: u.lastTag, published: v.published ?? {}, aheadOfLastTag: { commits: u.commitsSinceTag, files: u.files.changed, byType: u.byType }, manifestAheadOfTag: v.manifestAheadOfTag ?? null, workingTree: u.workingTree };
    if (rp.slug && u.lastTag) {
      try {
        const rel = await ghJson("release", "view", u.lastTag.name, "-R", rp.slug, "--json", "tagName,name,publishedAt,isDraft,isPrerelease,url,assets,body");
        out.release = { tag: rel.tagName, name: rel.name, publishedAt: rel.publishedAt, publishedAtLocal: localTime(rel.publishedAt), draft: rel.isDraft, prerelease: rel.isPrerelease, url: rel.url, assets: rel.assets.map((a) => a.name), notesChars: (rel.body ?? "").length };
      } catch (e) {
        out.release = { status: /not found|404/i.test(e.message) ? `no GitHub release for ${u.lastTag.name}` : "unreadable", error: e.message.slice(0, 160) };
      }
      try {
        const wfs = (await files()).filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
        const relWf = wfs.find((f) => /tags:/.test(tryRead(f) ?? "") && /(publish|release)/i.test(tryRead(f) ?? ""));
        if (relWf) {
          const runs = await ghJson("run", "list", "-R", rp.slug, "--workflow", path.posix.basename(relWf), "--limit", "3", "--json", "status,conclusion,headBranch,createdAt,url,displayTitle");
          out.releaseWorkflow = { file: relWf, lastRuns: runs.map((r) => ({ status: r.status, conclusion: r.conclusion, ref: r.headBranch, createdAtLocal: localTime(r.createdAt), url: r.url })) };
        } else out.releaseWorkflow = { status: "no tag-triggered release workflow found" };
      } catch (e) {
        out.releaseWorkflow = { status: "unreadable", error: e.message.slice(0, 160) };
      }
    }
    return out;
  }

  // ---- secrets and private words --------------------------------------------------------------
  async function scanLines(text, file, kinds, personal, hits) {
    const arr = text.split("\n");
    arr.forEach((l, i) => {
      if (l.length > 4000) return;
      for (const [kind, re] of kinds) {
        const m = l.match(re);
        if (!m || PLACEHOLDER.test(m[0])) continue;
        if (kind === "private key" && !/-----BEGIN[^-]*-----\s*[A-Za-z0-9+/=]{20,}/.test(l) && !/^[A-Za-z0-9+/=]{40,}\s*$/.test(arr[i + 1] ?? "")) continue;
        hits.push({ file, line: i + 1, kind });
      }
      if (personal) {
        for (const [kind, test] of personal) if (test(l, file)) hits.push({ file, line: i + 1, kind });
      }
    });
  }
  async function personalTests() {
    const home = os.homedir();
    const gitEmail = (await gitTry("config", "--get", "user.email")) ?? "";
    const host = os.hostname();
    const t = [
      ["home path", (l) => (home.length > 4 && l.includes(home)) || /(?:^|[\s"'(=:])\/home\/(?!user\b|runner\b|me\b|\$|<|\{|node\b|vscode\b|ubuntu\b|\*)[a-z_][a-z0-9_-]*\//.test(l) || /\/Users\/(?!runner\b|Shared\b|user\b|me\b|\$|<|\{|\*)[A-Za-z_][\w.-]*\//.test(l)],
      ["email", (l, f) => !/(^|\/)(OFL|LICEN[CS]E|COPYING|NOTICE|AUTHORS|CONTRIBUTORS)[^/]*$/i.test(f ?? "") && [...l.matchAll(EMAIL)].some((m) => !OK_EMAIL.test(m[0]))],
    ];
    if (gitEmail && !/noreply/i.test(gitEmail)) t.push(["git email", (l) => l.includes(gitEmail)]);
    if (host.length >= 5) t.push(["hostname", (l) => new RegExp(`(?<![\\w.-])${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(l)]);
    return t;
  }

  /**
   * Token shapes (and with personal: home paths, emails, the git email, this machine's name) in the tracked files; with history, in the
   * lines added by the newest `commits` commits. Reports file, line and kind; never the matched text.
   */
  async function secrets({ history = false, commits = 300, personal = true } = {}) {
    const fl = await files();
    const tree = [];
    const trackedSecretFiles = [];
    const skipped = { binaryOrLarge: 0, lockOrGenerated: 0 };
    const pers = personal ? await personalTests() : null;
    for (const f of fl) {
      if (SECRET_FILE.test(f)) {
        trackedSecretFiles.push(f);
        continue;
      }
      if (SKIP_SCAN.test(f)) {
        skipped.lockOrGenerated++;
        continue;
      }
      let buf;
      try {
        const st = fs.statSync(abs(f));
        if (!st.isFile() || st.size > 1_500_000) {
          skipped.binaryOrLarge++;
          continue;
        }
        buf = fs.readFileSync(abs(f));
      } catch {
        continue;
      }
      if (buf.includes(0)) {
        skipped.binaryOrLarge++;
        continue;
      }
      await scanLines(buf.toString("utf8"), f, TOKENS, pers, tree);
    }
    const kindsCount = {};
    for (const h of tree) kindsCount[h.kind] = (kindsCount[h.kind] ?? 0) + 1;
    const out = {
      scanned: fl.length - skipped.binaryOrLarge - skipped.lockOrGenerated - trackedSecretFiles.length, skipped,
      trackedSecretFiles, tree: { count: tree.length, byKind: kindsCount, hits: tree.slice(0, 60), truncated: Math.max(0, tree.length - 60) },
      covers: "token shapes (github, gitlab, slack, aws, google, npm, api keys, private keys, jwt, bearer, db urls with a password)" + (personal ? ", home paths, emails other than example and noreply, the git email, this machine's name" : ""),
      notCovered: "passwords or tokens with no recognisable shape, secrets in binary files, files over 1.5 MB, lockfiles, and files named like credential files (listed in trackedSecretFiles, never read)",
    };
    if (history) {
      const hh = [];
      const total = +(await gitText("rev-list", "--count", "--no-merges", "--all"));
      const t = Date.now();
      const r = await rawGit(["log", "--all", "--no-merges", "-p", "-U0", "--no-color", "--no-ext-diff", `--max-count=${commits}`, "--format=@@COMMIT %h"], { timeoutMs: 150_000, maxBuffer: 512 << 20, raw: true });
      trace("git", `history scan of ${commits} commits`, t, r);
      let commit = null;
      let file = null;
      let skip = false;
      let ln = 0;
      let pendingKey = null;
      const seen = new Set();
      const scanned = new Set();
      for (const l of r.out.split("\n")) {
        if (l.startsWith("@@COMMIT ")) {
          commit = l.slice(9);
          scanned.add(commit);
        } else if (l.startsWith("+++ ")) {
          file = l.slice(4).replace(/^b\//, "");
          skip = file === "/dev/null" || SKIP_SCAN.test(file);
        } else if (l.startsWith("@@ ")) ln = +(l.match(/\+(\d+)/)?.[1] ?? 0) - 1;
        else if (l.startsWith("+") && !skip) {
          ln++;
          if (SECRET_FILE.test(file ?? "")) {
            const key = `${commit}|${file}|file`;
            if (!seen.has(key)) (seen.add(key), hh.push({ commit, file, line: null, kind: "credential-style file added" }));
            continue;
          }
          const body = l.slice(1);
          if (body.length > 4000) continue;
          if (pendingKey && /^[A-Za-z0-9+/=]{40,}\s*$/.test(body)) {
            const key = `${pendingKey.commit}|${pendingKey.file}|private key`;
            if (!seen.has(key)) (seen.add(key), hh.push({ commit: pendingKey.commit, file: pendingKey.file, line: pendingKey.ln, kind: "private key" }));
          }
          pendingKey = null;
          for (const [kind, re] of TOKENS) {
            const m = body.match(re);
            if (m && kind === "private key" && !/-----BEGIN[^-]*-----\s*[A-Za-z0-9+/=]{20,}/.test(body)) { pendingKey = { commit, file, ln }; continue; }
            const key = `${commit}|${file}|${kind}`;
            if (m && !PLACEHOLDER.test(m[0]) && !seen.has(key)) (seen.add(key), hh.push({ commit, file, line: ln, kind }));
          }
        }
      }
      out.history = { commitsScanned: Math.min(commits, total), commitsTotal: total, complete: commits >= total, count: hh.length, hits: hh.slice(0, 40), truncated: Math.max(0, hh.length - 40), timedOut: !!r.timedOut, note: "lines added in those commits, newest first, including ones a later commit removed; a hit here stays in the history until it is rewritten" };
    }
    return out;
  }

  function wordList() {
    const candidates = [tilde(settings.PRIVATE_WORDS), tilde(process.env.PRIVATE_WORDS)].filter(Boolean);
    const p = candidates.find((c) => {
      try {
        return fs.statSync(c).size > 0;
      } catch {
        return false;
      }
    });
    return { tried: candidates[0] ?? candidates.at(-1), path: p ?? null };
  }
  /**
   * The private-word check: the list (setting PRIVATE_WORDS) is one extended regex per line, matched
   * without case, against tracked file paths, file lines and commit messages, plus (history: true) the lines commits added or removed.
   * Reports files, lines and commits; the words are never printed.
   */
  async function privateWords({ history = false, commits = 400 } = {}) {
    const wl = wordList();
    if (!wl.path) return { ran: false, listPath: wordList().tried, reason: "no private word list: set PRIVATE_WORDS to a file with one extended regex per line, kept outside every repository. Ask the owner to create it or link an existing one; do not write words anywhere." };
    const pats = fs.readFileSync(wl.path, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
    const res = [];
    let bad = 0;
    for (const p of pats) {
      try {
        res.push(new RegExp(p, "i"));
      } catch {
        bad++;
      }
    }
    if (!res.length) return { ran: false, listPath: wl.path, reason: "the list has no usable words" };
    const any = (s) => res.some((r) => r.test(s));
    const fl = await files();
    const out = { ran: true, listPath: wl.path, words: res.length, unparsable: bad, paths: [], lines: [], messages: [] };
    for (const f of fl) {
      if (any(f)) out.paths.push(f);
      if (SECRET_FILE.test(f) || SKIP_SCAN.test(f)) continue;
      let buf;
      try {
        const st = fs.statSync(abs(f));
        if (!st.isFile() || st.size > 1_500_000) continue;
        buf = fs.readFileSync(abs(f));
      } catch {
        continue;
      }
      if (buf.includes(0)) continue;
      buf.toString("utf8").split("\n").forEach((l, i) => {
        if (l.length < 4000 && any(l)) out.lines.push({ file: f, line: i + 1 });
      });
    }
    const msgs = await gitTry("log", "--all", `--max-count=${commits}`, "--format=%h%x1f%B%x1e");
    for (const rec of (msgs ?? "").split("\x1e")) {
      const [sha, ...body] = rec.replace(/^\n+/, "").split("\x1f");
      if (sha && any(body.join(" "))) out.messages.push(sha.trim());
    }
    const filesHit = new Set(out.lines.map((h) => h.file));
    out.tree = { files: filesHit.size, lines: out.lines.length, byFile: Object.fromEntries([...filesHit].slice(0, 40).map((f) => [f, out.lines.filter((h) => h.file === f).slice(0, 8).map((h) => h.line)])) };
    delete out.lines;
    out.pathHits = out.paths.length;
    out.commitMessages = { count: out.messages.length, commits: out.messages.slice(0, 40) };
    delete out.messages;
    if (history) {
      const alt = res.map((r) => r.source).join("|");
      const r = await rawGit(["log", "--all", `--max-count=${commits}`, "-i", "-E", `-G${alt}`, "--format=@@%h", "--name-only"], { timeoutMs: 120_000 });
      const hits = [];
      let cur = null;
      for (const l of r.out.split("\n")) {
        if (l.startsWith("@@")) (cur = { commit: l.slice(2), files: [] }, hits.push(cur));
        else if (l && cur) cur.files.push(l);
      }
      out.history = { commitsChecked: commits, commitsTouching: hits.length, hits: hits.slice(0, 30).map((h) => ({ commit: h.commit, files: h.files.slice(0, 5), moreFiles: Math.max(0, h.files.length - 5) })), truncated: Math.max(0, hits.length - 30), note: "commits whose diff added or removed a line matching the list" };
    }
    return out;
  }

  // ---- the audit ------------------------------------------------------------------------------
  const internals = { files, has, read, tryRead, lineOf, json, git: rawGit, gitText, gitTry, gh, ghJson, npmView, project, versions, tags, changelogEntries, changelogFile, repo, secrets, privateWords, wordList, tomlTable, tomlKey, SECRET_FILE, mask };
  const audit = (o) => runAudit(api, internals, o ?? {});

  // ---- acting ---------------------------------------------------------------------------------
  const templatesDir = () => tilde(settings.TEMPLATES) || path.join(KIT_DIR, "templates");
  const fillTemplate = async (text, o = {}) => {
    const p = await project();
    const rp = await repo();
    const name = o.name ?? (p.npm?.name ?? p.cargo?.crates?.[0]?.name ?? path.basename(root)).replace(/^@[^/]+\//, "");
    const vals = {
      __NAME__: name, __ORG__: o.org ?? rp.slug?.split("/")[0] ?? "__ORG__", __DESC__: o.desc ?? "__DESC__", __HOLDER__: o.holder ?? "__HOLDER__",
      __YEAR__: String(new Date().getFullYear()), __AUTHOR__: o.author ?? "__AUTHOR__", __PRIVATE_REPO__: o.privateRepo ?? "__PRIVATE_REPO__", __SANDBOX__: name.toUpperCase().replace(/-/g, "_") + "_SANDBOX",
    };
    let t = text;
    for (const [k, v] of Object.entries(vals)) t = t.split(k).join(v);
    return t;
  };
  /** The templates in the TEMPLATES folder (default: the kit's templates folder), as paths relative to it. */
  function templates() {
    const out = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name), path.posix.join(rel, e.name));
        else out.push(path.posix.join(rel, e.name));
      }
    };
    try {
      walk(templatesDir(), "");
    } catch {
      return [];
    }
    return out.map((f) => f.replace(/^\//, ""));
  }
  /** Copy one template into the repository, filling its names. Never overwrites. */
  async function addFile(name, o = {}) {
    needAct(`adding ${name} to the repository`);
    const have = templates();
    if (!have.includes(name)) refuse(`no template ${name}; the templates folder has: ${have.join(", ") || "nothing (the TEMPLATES setting names a folder with no files)"}`);
    const dest = abs(name);
    if (fs.existsSync(dest)) return { file: name, created: false, note: "already exists; merge by hand" };
    if (name === "LICENSE" && !o.holder) refuse("LICENSE needs the copyright holder: pass { holder } (confirm it with the owner)");
    const text = await fillTemplate(fs.readFileSync(path.join(templatesDir(), name), "utf8"), o);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    try {
      if (fs.statSync(path.join(templatesDir(), name)).mode & 0o111) fs.chmodSync(dest, 0o755);
    } catch {}
    _files = null;
    const placeholders = [...new Set(text.match(/__[A-Z_]+__/g) ?? [])];
    return { file: name, created: true, placeholdersLeft: placeholders };
  }
  /** The scaffold script (setting SCAFFOLD, default: bin/scaffold in the kit), which adds every missing template and never overwrites. dryRun (default true) only lists. */
  async function scaffold(o = {}) {
    const dry = o.dryRun !== false;
    if (!dry) needAct("scaffolding the missing release files");
    const script = tilde(settings.SCAFFOLD) || path.join(KIT_DIR, "bin", "scaffold");
    if (!fs.existsSync(script)) refuse(`no scaffold script at ${script}: set SCAFFOLD to a script that takes the repository folder, --name and --dry-run (use addFile for single templates)`);
    const p = await project();
    const name = o.name ?? (p.npm?.name ?? p.cargo?.crates?.[0]?.name ?? path.basename(root)).replace(/^@[^/]+\//, "");
    const args = [script, root, "--name", name];
    for (const [k, f] of [["desc", "--desc"], ["author", "--author"], ["holder", "--holder"], ["privateRepo", "--private-repo"], ["org", "--org"]]) if (o[k]) args.push(f, String(o[k]));
    if (p.npm && o.node !== false) args.push("--node");
    if (dry) args.push("--dry-run");
    const r = await exec("python3", args, { cwd: root, timeoutMs: 60_000 });
    _files = null;
    return { dryRun: dry, code: r.code, out: r.out.slice(0, 6000), err: r.err.slice(0, 1000) };
  }

  /** Write `version` into every place versions() found (manifests, locks, plugin manifests), one line each. */
  async function setVersion(version) {
    needAct(`setting the version to ${version}`);
    if (!SEMVER.test(version)) refuse(`${version} is not a semantic version`);
    const v = await versions({ published: false });
    if (!v.places.length) refuse("no version places found");
    const changed = [];
    const byFile = {};
    for (const pl of v.places) (byFile[pl.file] ??= []).push(pl);
    for (const [f, pls] of Object.entries(byFile)) {
      const ls = read(f).split("\n");
      for (const pl of pls) {
        if (!pl.line || pl.value === version) continue;
        const i = pl.line - 1;
        const next = ls[i].replace(`"${pl.value}"`, `"${version}"`);
        if (next === ls[i]) continue;
        ls[i] = next;
        changed.push({ file: f, line: pl.line, from: pl.value, to: version });
      }
      if (changed.some((c) => c.file === f)) fs.writeFileSync(abs(f), ls.join("\n"));
    }
    const after = await versions({ published: false });
    return { changed, agree: after.agree, mismatched: after.mismatched, note: "files are written, not committed" };
  }
  /** Write the changelog entry for `version` from the commits since the last tag, at the top of the changelog. Creates CHANGELOG.md when there is none. */
  async function writeChangelog(version, o = {}) {
    needAct(`writing the changelog entry for ${version}`);
    if (!SEMVER.test(version)) refuse(`${version} is not a semantic version`);
    const u = await unreleased({ max: 200 });
    const file = (await changelogFile()) ?? "CHANGELOG.md";
    const existing = tryRead(file);
    const cl = changelogEntries(existing == null ? null : file);
    if (cl.entries.some((e) => e.version === version)) return { file, written: false, note: `${file} already has an entry for ${version} at line ${cl.entries.find((e) => e.version === version).line}` };
    const keep = existing != null && /^#{1,3}\s*\[\d/m.test(existing);
    const date = o.date ?? new Date().toISOString().slice(0, 10);
    const entry = o.text ?? buildChangelog(u.commits, u.conventional, version, date, keep ? "keep" : "plain");
    if (!entry) refuse("no commits since the last tag to write an entry from; pass { text }");
    let next;
    if (existing == null) next = `# Changelog\n\n${entry}`;
    else {
      const ls = existing.split("\n");
      let at = ls.findIndex((l) => /^#{2,3}\s/.test(l));
      if (cl.unreleased) at = cl.unreleased; // after the Unreleased heading
      if (at < 0) at = ls.length;
      const insertAt = cl.unreleased ? ls.findIndex((l, i) => i >= cl.unreleased && /^#{2,3}\s/.test(l) && !/unreleased/i.test(l)) : at;
      const idx = insertAt < 0 ? ls.length : insertAt;
      ls.splice(idx, 0, ...entry.split("\n"), "");
      next = ls.join("\n");
    }
    fs.writeFileSync(abs(file), next);
    return { file, written: true, line: next.split("\n").findIndex((l) => l.includes(version)) + 1, entry };
  }
  /** Create the annotated tag v<version> on HEAD. Refuses a tag that exists, a version the manifests do not carry, a dirty tree and a HEAD that is not the default branch. Local only. */
  async function tag(version) {
    needAct(`creating the tag v${version}`);
    const v = await versions({ published: false });
    const rp = await repo();
    if (v.primary !== version) refuse(`the manifests carry ${v.primary}, not ${version}; set the version first (release.setVersion)`);
    if (!v.agree) refuse(`the version is not the same everywhere: ${v.mismatched.map((m) => `${m.file}:${m.line}=${m.value}`).join(", ")}`);
    if ((await tags()).some((t) => tagVersion(t.name) === version)) refuse(`a tag for ${version} exists; never move a tag, publish the next version`);
    if (rp.dirty) refuse(`${rp.dirty} tracked files have uncommitted changes; commit the version bump first`);
    if (rp.defaultBranch && rp.branch !== rp.defaultBranch) refuse(`HEAD is on ${rp.branch}, not ${rp.defaultBranch}`);
    const r = await rawGit(["tag", "-a", `v${version}`, "-m", `v${version}`]);
    if (r.code !== 0) throw new Error(`git tag: ${(r.err || r.out).slice(0, 300)}`);
    _tags = null;
    return { tag: `v${version}`, sha: await gitText("rev-parse", "--short", "HEAD"), annotated: true, pushed: false };
  }
  /** Push the tag v<version> to origin. Needs act and confirm equal to the version. Never forces and never moves a remote tag. */
  async function pushTag(version, { confirm } = {}) {
    needConfirm(`pushing the tag v${version}`, version, confirm);
    const name = `v${version}`;
    const t = (await tags()).find((x) => x.name === name);
    if (!t) refuse(`no local tag ${name}; create it with release.tag first`);
    if (!t.annotated) refuse(`${name} is not an annotated tag`);
    const remote = await rawGit(["ls-remote", "--tags", "origin", `refs/tags/${name}`]);
    if (remote.code === 0 && remote.out.trim()) refuse(`origin already has ${name}; never move a tag, publish the next version`);
    const r = await rawGit(["push", "origin", `refs/tags/${name}`], { timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`git push: ${(r.err || r.out).slice(0, 400)}`);
    return { pushed: name, out: (r.err || r.out).trim().slice(0, 600), next: "watch the release workflow's run to the end before saying released" };
  }
  /** Publish the package from the tagged commit: npm publish, or cargo publish for a crate. Needs act and confirm equal to the version. */
  async function publish(version, { confirm, what } = {}) {
    needConfirm(`publishing ${version}`, version, confirm);
    const v = await versions({ published: false });
    const p = await project();
    const rp = await repo();
    if (v.primary !== version || !v.agree) refuse("the manifests do not all carry that version");
    const name = `v${version}`;
    const tg = (await tags()).find((x) => x.name === name);
    if (!tg) refuse(`no tag ${name}: tag the commit first, so the published bytes are the tagged ones`);
    if (rp.dirty) refuse("the work tree has uncommitted changes");
    if ((await gitText("rev-parse", `${name}^{commit}`)) !== (await gitText("rev-parse", "HEAD"))) refuse(`HEAD is not the commit ${name} points at`);
    for (const f of (await files()).filter((x) => /^\.github\/workflows\//.test(x))) {
      const t = tryRead(f) ?? "";
      if (/tags:/.test(t) && /(npm publish|cargo publish|gh release create)/.test(t)) refuse(`${f} publishes when the tag is pushed (the repository's tag-triggered release path); push the tag with release.pushTag instead of publishing by hand`);
    }
    const kind = what ?? (p.npm && !p.npm.private ? "npm" : "cargo");
    if (kind === "npm") {
      if (!p.npm || p.npm.private) refuse("package.json is private or missing");
      const r = await exec("npm", ["publish"], { cwd: root, timeoutMs: 180_000 });
      trace("npm", "npm publish", Date.now(), r);
      if (r.code !== 0) throw new Error(`npm publish: ${(r.err || r.out).slice(0, 500)}`);
      return { published: `${p.npm.name}@${version}`, out: (r.out + r.err).slice(-600) };
    }
    const crate = p.cargo?.crates.find((c) => c.publish !== "false");
    if (!crate || p.cargo?.workspace?.publish === "false") refuse("every crate has publish = false");
    const r = await exec("cargo", ["publish", "--locked", "-p", crate.name], { cwd: root, timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`cargo publish: ${(r.err || r.out).slice(0, 500)}`);
    return { published: `${crate.name}@${version}`, out: (r.out + r.err).slice(-600) };
  }
  /** Create the GitHub release for an existing remote tag. Needs act and confirm equal to the version. */
  async function githubRelease(version, { confirm, notes, title } = {}) {
    needConfirm(`creating the GitHub release for v${version}`, version, confirm);
    const rp = await repo();
    if (!rp.slug) refuse("origin is not a GitHub repository");
    const name = `v${version}`;
    const remote = await rawGit(["ls-remote", "--tags", "origin", `refs/tags/${name}`]);
    if (!remote.out.trim()) refuse(`origin has no tag ${name}; push it first`);
    const u = notes == null ? (await unreleased({ max: 200 })).draft : notes;
    const args = ["release", "create", name, "-R", rp.slug, "--verify-tag", "--title", title ?? `${name}`, "--notes-file", "-"];
    if (version.includes("-")) args.push("--prerelease");
    const r = await exec("gh", args, { cwd: root, input: u ?? "", timeoutMs: 120_000 });
    trace("gh", `gh release create ${name}`, Date.now(), r);
    if (r.code !== 0) throw new Error(`gh release create: ${(r.err || r.out).slice(0, 400)}`);
    return { release: name, url: r.out.trim() };
  }
  /** Replace the notes of an existing GitHub release. Needs act. */
  async function setReleaseNotes(version, notes) {
    needAct(`rewriting the notes of v${version}`);
    const rp = await repo();
    if (!rp.slug) refuse("origin is not a GitHub repository");
    const r = await exec("gh", ["release", "edit", `v${version}`, "-R", rp.slug, "--notes-file", "-"], { cwd: root, input: notes, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`gh release edit: ${(r.err || r.out).slice(0, 400)}`);
    return { edited: `v${version}`, chars: notes.length };
  }

  /**
   * `npm pack --dry-run` in the repository (lifecycle scripts off): the files an npm publish would ship and their sizes, the
   * entry points (main, module, types, bin, exports) that are not among them, and shipped files that look wrong (.env, .npmrc,
   * keys, logs, tests, .github). Writes nothing.
   */
  async function pack() {
    const pj = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      } catch {
        return null;
      }
    })();
    if (!pj) return { ok: false, note: "no package.json in the repository root" };
    const t = Date.now();
    const r = await exec("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, timeoutMs: 120_000 });
    trace("npm", "npm pack --dry-run", t, r);
    let j = null;
    try {
      j = JSON.parse(r.out)?.[0];
    } catch {}
    if (!j) return { ok: false, note: "npm pack did not return JSON", tail: (r.out + "\n" + r.err).trim().split("\n").slice(-20) };
    const shipped = new Set(j.files.map((f) => f.path));
    const entries = [];
    const add = (what, p) => typeof p === "string" && entries.push({ what, path: p.replace(/^\.\//, "") });
    add("main", pj.main);
    add("module", pj.module);
    add("types", pj.types ?? pj.typings);
    if (typeof pj.bin === "string") add("bin", pj.bin);
    else for (const [k, v] of Object.entries(pj.bin ?? {})) add(`bin ${k}`, v);
    const walk = (x, label) => (typeof x === "string" ? add(label, x) : x && typeof x === "object" ? Object.entries(x).forEach(([k, v]) => walk(v, `${label}.${k}`)) : null);
    walk(pj.exports, "exports");
    const missing = entries.filter((e) => !e.path.includes("*") && !e.path.endsWith("/") && !shipped.has(e.path)).map((e) => `${e.what}: ${e.path}`);
    const shouldNotShip = j.files.map((f) => f.path).filter((p) => /(^|\/)(\.env|\.npmrc|\.git\/|node_modules\/|[^/]*\.(pem|key|log)$|[^/]*\.test\.[cm]?[jt]s$|tests?\/|\.github\/)/.test(p));
    return {
      ok: missing.length === 0 && shouldNotShip.length === 0,
      name: j.name, version: j.version, fileCount: j.entryCount, packedKB: Math.round(j.size / 1024), unpackedKB: Math.round(j.unpackedSize / 1024),
      files: j.files.slice(0, 60).map((f) => f.path), ...(j.files.length > 60 ? { moreFiles: j.files.length - 60 } : {}),
      missingEntryPoints: missing, shouldNotShip: shouldNotShip.slice(0, 20),
      fields: { license: !!pj.license, repository: !!pj.repository, files: Array.isArray(pj.files), engines: pj.engines ?? null, private: !!pj.private, publishConfig: pj.publishConfig ?? null },
    };
  }

  const api = {
    root, act,
    git, gh, npmView, pack,
    repo, project, versions, unreleased, status, secrets, privateWords, audit,
    templates, scaffold, addFile, setVersion, writeChangelog, tag, pushTag, publish, githubRelease, setReleaseNotes,
    /** The same client for another repository: release.at("/path/to/repo"). */
    at(dir) {
      const p = path.resolve(cwd, String(dir).replace(/^~(?=\/|$)/, os.homedir()));
      if (!fs.existsSync(p)) throw new Error(`no such folder: ${p}`);
      return makeRelease({ cwd: p, push, act, settings });
    },
    localTime,
  };
  return api;
}
