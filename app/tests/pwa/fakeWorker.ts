import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs a plain service-worker script against fake `self`, `caches` and
// `clients`, and fires its activate handler.
export async function activate(file: string, cacheNames: string[], clientUrls: string[]) {
  const code = readFileSync(resolve(__dirname, '../..', file), 'utf8');
  const names = new Set(cacheNames);
  const navigated: string[] = [];
  let unregistered = false;
  const handlers: Record<string, (e: unknown) => void> = {};
  const caches = {
    keys: async () => [...names],
    delete: async (n: string) => names.delete(n)
  };
  const clients = {
    claim: async () => {},
    matchAll: async () => clientUrls.map((url) => ({ url, navigate: async (to: string) => { navigated.push(to); } }))
  };
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: () => {},
    registration: { unregister: async () => { unregistered = true; return true; } },
    caches, clients
  };
  new Function('self', 'caches', 'clients', code)(self, caches, clients);
  const waits: Promise<unknown>[] = [];
  handlers.activate?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return { caches: [...names], navigated, unregistered };
}
