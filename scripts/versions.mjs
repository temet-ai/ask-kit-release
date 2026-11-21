export const meta = {
  purpose:
    "Every place a version is written (package.json, package-lock.json, Cargo.toml and Cargo.lock for workspace crates, plugin manifests, server.json, gemini-extension.json, Homebrew formulas in the tree), whether they agree, the changelog's newest entry, the newest tag, and what is published (npm view, crates.io unless publish = false, the latest GitHub release). Use for: is the version the same everywhere, what is the latest release, is it published, is the working tree ahead of what is published.",
  params: { path: "another repository folder, optional (default: the repository the caller works in)", published: "read npm, crates.io and GitHub too, default true (these are network reads, no credentials)" },
  returns: "{primary, primaryFrom, places:[{file,line,key,value,kind}], agree, mismatched, changelog:{file,topVersion,hasEntryForPrimary}, latestTag:{name,version,date,atHead,matchesPrimary}, manifestAheadOfTag, hasTagForPrimary, published:{npm,crate,githubRelease}}",
  example: 'await scripts.run("versions", { path: "/path/to/my-app" })',
};

export default async function versions({ release }, { path, published = true } = {}) {
  const r = path ? release.at(path) : release;
  const v = await r.versions({ published });
  const ahead = [];
  if (v.latestTag && v.manifestAheadOfTag) ahead.push(`manifest ${v.primary} is ahead of the newest tag ${v.latestTag.name}`);
  for (const [k, x] of Object.entries(v.published ?? {})) if (x.matchesPrimary === false) ahead.push(`${k} is at ${x.version ?? x.tagName}, the manifest is ${v.primary}`);
  return { ...v, summary: [!v.places.length ? "no version is written in any manifest this kit knows (package.json, Cargo.toml, ask-kit.toml, pyproject.toml, plugin manifests, server.json)" : v.agree ? `all ${v.places.length} places carry ${v.primary}` : `${v.mismatched.length} places differ from ${v.primary}`, ...ahead] };
}
