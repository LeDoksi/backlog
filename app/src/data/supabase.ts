import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';

declare global { interface Window { __blSupabaseStub?: { createClient(): SupabaseClient } } }

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  try {
    if (import.meta.env.MODE === 'e2e' && window.__blSupabaseStub) client = window.__blSupabaseStub.createClient();
    else client = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch {
    client = null;
  }
  return client;
}
