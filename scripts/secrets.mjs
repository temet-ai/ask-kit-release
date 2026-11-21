export const meta = {
  purpose:
    "Does anything that looks like a secret or a personal trace sit in the tracked files: token shapes (GitHub, GitLab, Slack, AWS, Google, npm, API keys, private keys, JWT, bearer, database URLs with a password), home paths, emails other than example and noreply, the git email and this machine's name; credential-style files that are tracked; and with history: true the lines added by the newest commits. Reports file, line and kind, never the matched text. Credential files are never read.",
  params: { path: "another repository folder, optional", history: "also scan the lines added by the newest commits, default false (slower)", commits: "how many commits of history to scan, default 300", personal: "also look for home paths, emails and machine names, default true" },
  returns: "{scanned, skipped, trackedSecretFiles, tree:{count,byKind,hits:[{file,line,kind}],truncated}, history?:{commitsScanned,commitsTotal,complete,count,hits:[{commit,file,line,kind}]}, covers, notCovered}",
  example: 'await scripts.run("secrets", { path: "/path/to/my-app", history: true })',
};

export default async function secrets({ release }, { path, history = false, commits = 300, personal = true } = {}) {
  const r = path ? release.at(path) : release;
  return r.secrets({ history, commits, personal });
}
