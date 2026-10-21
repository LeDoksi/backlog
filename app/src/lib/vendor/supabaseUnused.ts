// Stands in for @supabase/storage-js and @supabase/functions-js (aliased in
// vite.config.ts). The app never uses file storage or edge functions, but
// supabase-js imports both and builds a StorageClient in its constructor, so
// without this they cost ~6 KB of the 250 KB JS budget. Calling either one
// fails loudly instead of quietly doing nothing.
function unused(): never { throw new Error('Supabase storage/functions are not bundled'); }
export class StorageClient { constructor(..._args: unknown[]) {} from() { return unused(); } }
export class FunctionsClient { constructor(..._args: unknown[]) {} invoke() { return unused(); } setAuth() {} }
export class StorageApiError extends Error {}
export class FunctionsError extends Error {}
export class FunctionsFetchError extends FunctionsError {}
export class FunctionsHttpError extends FunctionsError {}
export class FunctionsRelayError extends FunctionsError {}
export const FunctionRegion = {} as Record<string, string>;
