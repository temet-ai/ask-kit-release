export const meta = {
  purpose:
    "The private-word check: the list (setting PRIVATE_WORDS; one extended regex per line, matched without case) against tracked file names, file lines and commit messages, and with history: true against the lines commits added or removed. Reports files, lines and commits; the words are never printed or returned. Without a list it says so and runs nothing.",
  params: { path: "another repository folder, optional", history: "also check what the newest commits added or removed, default false", commits: "commits to check, default 400" },
  returns: "{ran, listPath, words, tree:{files,lines,byFile:{file:[lines]}}, pathHits, commitMessages:{count,commits}, history?:{commitsTouching,hits}} or {ran:false, reason}",
  example: 'await scripts.run("private-words", { path: "/path/to/my-app" })',
};

export default async function privateWords({ release }, { path, history = false, commits = 400 } = {}) {
  const r = path ? release.at(path) : release;
  return r.privateWords({ history, commits });
}
