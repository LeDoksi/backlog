// A supabase-shaped client for the `titles` table only: rows per board,
// the query builder calls the sync makes, and realtime events on demand.
type Row = Record<string, unknown> & { id: string; workspace_id?: string };
type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };

export function fakeTitlesClient(boards: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  Object.entries(boards).forEach(([b, rows]) => { tables[b] = rows.map((r) => ({ workspace_id: b, ...r })); });
  const log: { op: string; filters?: Record<string, unknown>; values?: unknown; order?: string; row?: unknown }[] = [];
  const state = { offline: false, failNext: 0, refuse: '' as string, gate: null as Promise<void> | null };
  const listeners: { board: string; cb: (p: Payload) => void }[] = [];
  const netError = { message: 'TypeError: Failed to fetch', code: '' };

  function failing(id?: unknown) {
    if (state.offline) return netError;
    if (state.failNext > 0) { state.failNext -= 1; return netError; }
    if (state.refuse && id === state.refuse) return { message: 'permission denied', code: '42501' };
    return null;
  }

  function query(op: string, values?: unknown) {
    const filters: Record<string, unknown> = {};
    let order: string | undefined;
    const q = {
      eq(col: string, v: unknown) { filters[col] = v; return q; },
      order(col: string) { order = col; return q; },
      select() { return q; },
      then(resolve: (r: unknown) => void, reject?: (e: unknown) => void) {
        const run = async () => {
          if (state.gate) await state.gate;
          log.push({ op, filters: { ...filters }, values, order });
          const err = failing(filters.id ?? (values as Row | undefined)?.id);
          if (err) return { data: null, error: err };
          const board = String(filters.workspace_id ?? (values as Row | undefined)?.workspace_id ?? '');
          const rows = (tables[board] ??= []);
          if (op === 'select') return { data: rows.map((r) => ({ ...r })), error: null };
          if (op === 'update') {
            const hit = rows.filter((r) => r.id === filters.id);
            hit.forEach((r) => Object.assign(r, values));
            return { data: hit.map((r) => ({ ...r })), error: null };
          }
          if (op === 'upsert') {
            const v = values as Row;
            const at = rows.findIndex((r) => r.id === v.id);
            if (at >= 0) rows[at] = { ...rows[at], ...v }; else rows.push({ ...v });
            return { data: [{ ...rows[at >= 0 ? at : rows.length - 1] }], error: null };
          }
          if (op === 'delete') { tables[board] = rows.filter((r) => r.id !== filters.id); return { data: null, error: null }; }
          return { data: null, error: null };
        };
        return run().then(resolve, reject);
      }
    };
    return q;
  }

  return {
    log,
    state,
    tables,
    emit(board: string, p: Payload) { listeners.filter((l) => l.board === board).forEach((l) => l.cb(p)); },
    from(_table: string) {
      return {
        select: () => query('select'),
        update: (values: unknown) => query('update', values),
        upsert: (values: unknown) => query('upsert', values),
        delete: () => query('delete')
      };
    },
    channel(name: string) {
      const board = name.split(':')[1] ?? '';
      const ch = {
        on(_e: unknown, filter: { filter?: string }, cb: (p: Payload) => void) {
          log.push({ op: 'on', filters: { filter: filter.filter } });
          listeners.push({ board, cb });
          return ch;
        },
        subscribe() { log.push({ op: 'subscribe', filters: { board } }); return ch; }
      };
      return ch;
    },
    removeChannel() { log.push({ op: 'removeChannel' }); listeners.length = 0; }
  };
}
