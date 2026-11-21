interface Check { id: string; severity: "P0" | "P1" | "P2"; status: "FAIL" | "NOT RUN / unreadable"; title: string; evidence: string[]; reason: string; fix: string; acceptance: string }
interface VersionPlace { file: string; line: number | null; key: string; value: string; kind: "manifest" | "lock" | "plugin" | "formula" }

declare const release: {
  root: string; // the repository's top folder
  act: boolean; // true when this ask may change things

  // Read-only git: status, log, show, diff, rev-parse, rev-list, ls-files, describe, tag --list, branch --list, remote get-url, config --get ...
  // Returns {code, out, err}. Anything that changes a ref, a file or a remote throws; use the typed calls below.
  git(...args: string[]): Promise<{ code: number; out: string; err: string }>;
  // Read-only gh: `repo view`, `release list|view`, `run list|view`, `workflow list|view` and `api <path>` (GET only), e.g.
  // release.gh("release", "list", "-R", "owner/repo", "--json", "tagName,publishedAt"). Returns {code, out, err}.
  gh(...args: string[]): Promise<{ code: number; out: string; err: string }>;
  // `npm view <name> <field> --json` in a neutral folder: {status: "published", value} | {status: "not published"} | {status: "unreadable", error}.
  npmView(name: string, field?: string): Promise<{ status: string; value?: any; error?: string }>;
  // `npm pack --dry-run` in the repository root, lifecycle scripts off: what an npm publish would ship. ok is false when an entry
  // point (main, module, types, bin, exports) is not among the files, or a shipped file looks wrong (shouldNotShip: .env, .npmrc,
  // keys, logs, tests, .github). Writes nothing; runs in every ask. {ok: false, note} with no package.json.
  pack(): Promise<{ ok: boolean; name?: string; version?: string; fileCount?: number; packedKB?: number; unpackedKB?: number; files?: string[]; moreFiles?: number;
    missingEntryPoints?: string[]; shouldNotShip?: string[]; fields?: { license: boolean; repository: boolean; files: boolean; engines: any; private: boolean; publishConfig: any }; note?: string }>;
  // The same client for another repository: release.at("/path/to/other-repo").
  at(dir: string): typeof release;
  // "2026-11-20T09:19:02Z" -> "2026-11-20 10:19 GMT+1" for the time zone Europe/Paris. The zone is the setting TIMEZONE (default: the machine's). Give the caller times in it.
  localTime(iso: string): string | null;

  // Top folder, branch, short head, default branch (defaultRef is origin/main), origin url (passwords masked), GitHub slug, dirty tracked files.
  repo(): Promise<{ root: string; branch: string | null; head: string | null; defaultRef: string | null; defaultBranch: string | null; remote: string | null; slug: string | null; dirty: number; tracked: number }>;
  // What kind of project: kinds ["npm","cargo"], npm {name,version,private,bin,files,license}, cargo {workspace,crates[]}, plugin manifests, formulas.
  project(): Promise<any>;

  // Every place a version is written, whether they agree, the newest tag and what is published.
  // published (default true) reads npm view, crates.io (unless publish = false) and the latest GitHub release.
  versions(o?: { published?: boolean }): Promise<{ primary: string | null; primaryFrom: string; places: VersionPlace[]; agree: boolean; mismatched: VersionPlace[];
    changelog: { file: string | null; topVersion: string | null; line: number | null; hasEntryForPrimary: boolean; unreleasedLine: number | null };
    latestTag: { name: string; version: string; sha: string; annotated: boolean; date: string; atHead: boolean; matchesPrimary: boolean } | null;
    manifestAheadOfTag?: boolean; hasTagForPrimary: boolean;
    published?: { npm?: any; crate?: any; githubRelease?: any } }>;

  // Commits on the default branch since the newest tag, by conventional type, files by folder, changelog state, a draft changelog entry.
  unreleased(o?: { max?: number }): Promise<any>;
  // The last release: tag, GitHub release with its assets, the tag-triggered workflow's last runs, published versions, what is ahead.
  status(): Promise<any>;

  // Token shapes and personal traces in the tracked files (file, line, kind; never the text); history: true scans the lines added by the newest `commits` commits.
  secrets(o?: { history?: boolean; commits?: number; personal?: boolean }): Promise<any>;
  // The private-word list (the setting PRIVATE_WORDS) against tracked paths, lines and commit messages. Never returns a word.
  privateWords(o?: { history?: boolean; commits?: number }): Promise<any>;
  // The whole readiness audit. See scripts.run("audit").
  audit(o?: { history?: boolean; commits?: number; remote?: boolean; detail?: boolean }): Promise<{ decision: string; counts: Record<string, number>; blocking: Check[]; otherFailures: Check[]; notRun: any[]; byGroup: Record<string, string[]>; notCertified: string[] }>;

  // ---- changing calls: each throws "not in this ask" unless the caller asked for a change (act: true) ----

  // The templates (paths relative to the TEMPLATES folder; by default the templates folder bundled in the kit).
  templates(): string[];
  // Copy one template into the repository with its names filled in; never overwrites. LICENSE needs { holder }.
  addFile(name: string, o?: { name?: string; org?: string; desc?: string; holder?: string; author?: string; privateRepo?: string }): Promise<{ file: string; created: boolean; placeholdersLeft?: string[]; note?: string }>;
  // The scaffold script (setting SCAFFOLD; by default the bundled bin/scaffold): adds every missing template, never overwrites. dryRun defaults to TRUE and then only lists what it would add (allowed in every ask).
  scaffold(o?: { dryRun?: boolean; name?: string; desc?: string; author?: string; holder?: string; privateRepo?: string; org?: string }): Promise<{ dryRun: boolean; code: number; out: string }>;
  // Write the version into every place versions() found. Files are written, not committed.
  setVersion(version: string): Promise<{ changed: { file: string; line: number; from: string; to: string }[]; agree: boolean }>;
  // Write the changelog entry for `version` from the commits since the last tag, at the top. Creates CHANGELOG.md when there is none. o.text replaces the generated entry.
  writeChangelog(version: string, o?: { date?: string; text?: string }): Promise<{ file: string; written: boolean; line?: number; entry?: string; note?: string }>;
  // Create the annotated tag v<version> on HEAD, locally. Refuses an existing tag, a version the manifests do not carry, a dirty tree, a HEAD off the default branch.
  tag(version: string): Promise<{ tag: string; sha: string; pushed: false }>;

  // ---- irreversible: need act AND confirm equal to the version string, passed only when the caller's request names that version ----
  // Push the annotated tag to origin. Never forces; refuses a tag origin already has.
  pushTag(version: string, o: { confirm: string }): Promise<{ pushed: string; out: string }>;
  // npm publish or cargo publish from the tagged commit. Refuses when a tag-triggered workflow publishes (push the tag instead).
  publish(version: string, o: { confirm: string; what?: "npm" | "cargo" }): Promise<{ published: string }>;
  // gh release create for a tag origin has, with --verify-tag; notes default to the draft from unreleased().
  githubRelease(version: string, o: { confirm: string; notes?: string; title?: string }): Promise<{ release: string; url: string }>;
  // Replace the notes of an existing release (reversible, needs act only).
  setReleaseNotes(version: string, notes: string): Promise<{ edited: string; chars: number }>;
};
