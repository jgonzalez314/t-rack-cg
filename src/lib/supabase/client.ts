import { supabaseAnonKey, supabaseUrl } from "@/lib/config";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
  );
}
