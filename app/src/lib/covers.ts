// Covers are stored as repo-relative paths ("images/covers/x.jpg") or full
// URLs. v2 is served from a sub-path, so a relative cover must resolve
// against the site root that holds images/, not against the app base.
export function resolveCover(cover: string | undefined, assetRoot: string): string {
  const value = cover && cover.trim() ? cover.trim() : PLACEHOLDER;
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith('/')) return value;
  return assetRoot.replace(/\/?$/, '/') + value;
}
const PLACEHOLDER = 'images/covers/_placeholder.svg';

/**
 * A wide picture a game was given when nothing tall exists (spec 3.2):
 * Steam's store header or capsule, or a RAWG screenshot. The tile fits it
 * on a blur of itself instead of cropping it.
 */
export function isLandscapeCover(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/media\.rawg\.io\//.test(url)) return true;
  return /steamstatic\.com\/|steampowered\.com\/|akamaihd\.net\//.test(url) && /\/(header|capsule_[^/]*)\.jpg/.test(url);
}
