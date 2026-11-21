export const meta = {
  purpose:
    "What is on the default branch since the last tag: the tag and its date, the commits (grouped by conventional type when the repository uses it), the files changed by top folder, whether the manifest version was already bumped, whether the changelog has an entry, uncommitted and unpushed work, and a draft changelog entry. Use for: what is unreleased, what would the next release contain, what are the release notes.",
  params: { path: "another repository folder, optional", max: "commits to list, default 60" },
  returns: "{lastTag, base, commitsSinceTag, commits:[{short,date,subject,type,breaking}], truncated, conventional, byType, files:{changed,insertions,deletions,byFolder}, manifestVersion, manifestAheadOfTag, changelog, workingTree:{branch,dirtyTrackedFiles,unpushed,unpulled}, draft}",
  example: 'await scripts.run("unreleased", { path: "/path/to/my-app" })',
};

export default async function unreleased({ release }, { path, max = 60 } = {}) {
  const r = path ? release.at(path) : release;
  return r.unreleased({ max });
}
