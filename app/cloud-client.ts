import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://jxpiteqoanvcyavhumez.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PHZZWvK3iPzQFl3U3FKjvg_6cCzlNpN";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
