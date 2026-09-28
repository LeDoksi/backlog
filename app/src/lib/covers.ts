const PLACEHOLDER = 'images/covers/_placeholder.svg';

// Covers are stored as repo-relative paths ("images/covers/x.jpg") or full
// URLs. v2 is served from a sub-path, so a relative cover must resolve
// against the site root that holds images/, not against the app base.
export function resolveCover(cover: string | undefined, assetRoot: string): string {
  const value = cover && cover.trim() ? cover.trim() : PLACEHOLDER;
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith('/')) return value;
  return assetRoot.replace(/\/?$/, '/') + value;
}
