// ChaiMenu configuration — the only file you need to edit.
//
// Find both values in Supabase → Project Settings → API.
// The anon (public) key is SAFE to publish: Row Level Security in
// supabase/schema.sql decides what anyone can read or change.
// NEVER paste the "service_role" key here.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

// Name of the Storage bucket created by schema.sql.
export const STORAGE_BUCKET = 'menu-images';
