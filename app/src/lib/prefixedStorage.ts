import type { StorageLike } from './types';

// v1 and v2 share one origin during the transition; v2 must never read or
// overwrite v1's mirror, so every v2 key lives under its own prefix.
export function prefixedStorage(storage: StorageLike, prefix: string): StorageLike {
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem?.(prefix + key)
  };
}
