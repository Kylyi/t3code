const stagedDirectory = /^versions[\\/]([a-f0-9]{12})-v(\d+\.\d+\.\d+)[\\/]win-unpacked$/;

export function parseGentlStagedUpdate(marker: string) {
  const match = stagedDirectory.exec(marker.trim());
  if (!match) return null;
  const [, commit, version] = match;
  return { directory: `${commit}-v${version}`, version: `${version}-gentl.g${commit}` };
}
