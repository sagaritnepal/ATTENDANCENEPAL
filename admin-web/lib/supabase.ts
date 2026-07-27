import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Never throw at module load: this file is imported by every 'use client'
// page, which Next.js also renders once on the server. Throwing here turns a
// missing env var into a hard 500 (FUNCTION_INVOCATION_FAILED) on every
// route instead of a readable in-page message.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);
