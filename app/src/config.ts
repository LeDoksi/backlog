// Public client keys: the browser has to present them itself, so they live in
// the source on purpose (same values and reasoning as v1's app.js).
export const SUPABASE_URL = 'https://rjdnpwamcxvhryiigbvt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto';
export const TMDB_KEY = '9affbfce7554a8309e8ea9933431b1ff';
export const RAWG_KEY = 'bde5b0fbbc9242d0b0aeec940d845ac3';
export const CORS_PROXY = 'https://backlog-proxy.shmar-shmar2.workers.dev/';
// Covers live in the repo's images/ at the site root, not under the v2 base.
export const ASSET_ROOT: string = import.meta.env.VITE_ASSET_ROOT ?? '/backlog/';
