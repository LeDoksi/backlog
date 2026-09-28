import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs a plain service-worker script against fake `self`, `caches` and
// `clients`, and fires its activate handler.
export async function activate(file: string, cacheNames: string[], clientUrls: string[]) {
  const code = readFileSync(resolve(__dirname, '../..', file), 'utf8');
  const names = new Set(cacheNames);
  const navigated: string[] = [];
  // A real navigation from a worker's activate step goes through that same
  // worker, whose fetch events wait until activation finishes, so navigate()
  // only settles after activation. Awaiting it inside waitUntil deadlocks.
  let activated!: () => void;
  const done = new Promise<void>((r) => { activated = r; });
  let unregistered = false;
  const handlers: Record<string, (e: unknown) => void> = {};
  const caches = {
    keys: async () => [...names],
    delete: async (n: string) => names.delete(n)
  };
  const clients = {
    claim: async () => {},
    matchAll: async () => clientUrls.map((url) => ({ url, navigate: (to: string) => { navigated.push(to); return done; } }))
  };
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: () => {},
    registration: { scope: 'https://x/backlog/', unregister: async () => { unregistered = true; return true; } },
    caches, clients
  };
  new Function('self', 'caches', 'clients', code)(self, caches, clients);
  const waits: Promise<unknown>[] = [];
  handlers.activate?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  const settled = await Promise.race([Promise.all(waits).then(() => true), new Promise((r) => setTimeout(() => r(false), 200))]);
  if (!settled) throw new Error('activation never finished (waits on a navigation that waits on activation)');
  activated();
  // Dispatches a navigation fetch to the script's fetch handler, if any.
  const navigate = (url: string): Response | undefined => {
    let answer: Response | undefined;
    handlers.fetch?.({ request: { mode: 'navigate', url }, respondWith: (r: Response) => { answer = r; } });
    return answer;
  };
  return { caches: [...names], navigated, unregistered, navigate };
}
