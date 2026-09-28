// Shared fakes for the data-layer tests: a Map-backed storage and a
// supabase-shaped client that logs every call and can be switched offline.
export function fakeStorage(seed: Record<string, unknown> = {}) {
  const data: Record<string, string> = {};
  Object.entries(seed).forEach(([k, v]) => { data[k] = JSON.stringify(v); });
  return {
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    json: (k: string) => (k in data ? JSON.parse(data[k]!) : undefined)
  };
}

export function fakeClient(tables: Record<string, unknown[]> = {}) {
  const log: { op: string; table?: string; row?: unknown; value?: unknown }[] = [];
  const state = { offline: false, failWrites: false };
  const handlers: (() => void)[] = [];
  const answer = () => (state.offline || state.failWrites ? { data: null, error: { message: 'offline' } } : { data: null, error: null });
  const client = {
    log,
    state,
    tables,
    /** A realtime event from another device. */
    remoteChange() { handlers.forEach((h) => h()); },
    from(table: string) {
      return {
        select() {
          log.push({ op: 'select', table });
          if (state.offline) return Promise.resolve({ data: null, error: { message: 'offline' } });
          return Promise.resolve({ data: tables[table] ?? [], error: null });
        },
        upsert(row: unknown) {
          log.push({ op: 'upsert', table, row });
          return Promise.resolve(answer());
        },
        delete() {
          return { eq(_c: string, value: unknown) { log.push({ op: 'delete', table, value }); return Promise.resolve(answer()); } };
        }
      };
    },
    channel() {
      const ch = { on(_e: unknown, _f: unknown, cb: () => void) { handlers.push(cb); return ch; }, subscribe() { log.push({ op: 'subscribe' }); return ch; } };
      return ch;
    },
    removeChannel() { log.push({ op: 'removeChannel' }); }
  };
  return client;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
