// Public client keys: the browser has to present them itself, so they live in
// the source on purpose; the data is protected by RLS, not by hiding them.
export const SUPABASE_URL = 'https://rjdnpwamcxvhryiigbvt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto';
export const TMDB_KEY = '9affbfce7554a8309e8ea9933431b1ff';
export const RAWG_KEY = 'bde5b0fbbc9242d0b0aeec940d845ac3';
export const CORS_PROXY = 'https://backlog-proxy.shmar-shmar2.workers.dev/';
// Covers live in the repo's images/, published at /backlog/images/ whatever the app's base.
export const ASSET_ROOT: string = import.meta.env.VITE_ASSET_ROOT ?? '/backlog/';
