export const meta = {
  purpose:
    "Where a release stands: the newest tag and its date, the GitHub release for it (assets, notes length, draft, prerelease), the last runs of the tag-triggered release workflow, the published npm and crate versions, and what is ahead of the tag. Times are given in the local zone as well as as read. Use for: is this all released, what did the last release ship, did the release workflow pass, is the working tree ahead of what is published.",
  params: { path: "another repository folder, optional" },
  returns: "{repo, version, lastTag, published:{npm,crate,githubRelease}, release:{tag,publishedAtLocal,assets,notesChars,draft,prerelease,url}, releaseWorkflow:{file,lastRuns}, aheadOfLastTag:{commits,files,byType}, manifestAheadOfTag, workingTree}",
  example: 'await scripts.run("status", { path: "/path/to/my-app" })',
};

export default async function status({ release }, { path } = {}) {
  const r = path ? release.at(path) : release;
  return r.status();
}
