export const meta = {
  purpose:
    "The release-readiness audit of the release-ready-repo skill, run on the repository at its current commit: licence file and fields, notices, README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, templates, CI and what it runs, release workflow, secret and private-word scans (tree and history), personal traces, .gitignore, public/private split, hooks, versions, tag, changelog, packaging (npm files/bin/exports, cargo metadata, Homebrew tap, mise), and the GitHub settings gh can read (visibility, topics, branch protection, vulnerability reporting, CI result, release, published version). Each failing check carries the evidence, the skill's reason, the smallest fix and an acceptance sentence; P0 and P1 failures come first and a required check that could not run blocks. Use for: is this repo release-ready, what blocks going public.",
  params: { path: "another repository folder, optional", history: "scan git history for secrets and private words too, default true (capped)", commits: "commits of history to scan, default 300", remote: "read GitHub, npm and crates.io, default true", detail: "return every check with its evidence, default false (passed checks are then only ids)" },
  returns: "{repo, commit, visibility, version, decision, counts, blocking:[{id,severity,status,title,evidence,reason,fix,acceptance}], otherFailures, notRun, byGroup, notCertified, passed, notApplicable}",
  example: 'await scripts.run("audit", { path: "/path/to/my-app" })',
};

export default async function audit({ release }, { path, history = true, commits = 300, remote = true, detail = false } = {}) {
  const r = path ? release.at(path) : release;
  return r.audit({ history, commits, remote, detail });
}
