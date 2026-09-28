import type { Page } from '@playwright/test';

export interface StubOptions {
  signedIn: boolean;
  hasProfile?: boolean;
  drafts?: unknown[];
  overrides?: unknown[];
  parts?: unknown[];
}

// Stands in for supabase-js in the `--mode e2e` build (see data/supabase.ts):
// the same calls lib/auth.ts and lib/sync.ts make, answered from fixtures, so
// the tests never reach the network or a real Google sign-in.
export async function installStub(page: Page, options: StubOptions): Promise<void> {
  await page.addInitScript((opts: StubOptions) => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const tables: Record<string, unknown[]> = {
      profiles: opts.signedIn && opts.hasProfile ? [{ id: userId, email: 'e2e@example.com' }] : [],
      drafts: opts.drafts ?? [],
      overrides: opts.overrides ?? [],
      parts: opts.parts ?? []
    };

    function query(table: string) {
      let rows = (tables[table] ?? []).slice() as Record<string, unknown>[];
      const q = {
        select() { return q; },
        eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return q; },
        in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return q; },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        delete() { return q; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
      return q;
    }

    const session = opts.signedIn ? { user: { id: userId, email: 'e2e@example.com' } } : null;
    const client = {
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
        signOut: () => Promise.resolve({ error: null })
      },
      from: query,
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel() {
        const ch = { on() { return ch; }, subscribe() { return ch; } };
        return ch;
      },
      removeChannel() {}
    };
    (window as unknown as { __blSupabaseStub: unknown }).__blSupabaseStub = { createClient: () => client };
  }, options);
}
