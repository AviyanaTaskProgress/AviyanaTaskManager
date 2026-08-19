import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local (project root) and fill them in, then restart `npm run dev`.'
  );
}

// A syntactically-valid placeholder so createClient() never throws at import
// time when the real env vars are missing — without this, the whole app
// crashes to a white screen before React even gets a chance to render.
export const supabase = createClient(
  url && anonKey ? url : 'https://placeholder.supabase.co',
  url && anonKey ? anonKey : 'placeholder-anon-key'
);
