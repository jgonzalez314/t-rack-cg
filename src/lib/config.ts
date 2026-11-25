/**
 * Local mode runs the app with no database: no sign-in, and data is saved in
 * the browser. It turns on automatically when the Supabase keys are missing,
 * or when NEXT_PUBLIC_LOCAL_MODE=true is set.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isLocalMode =
  process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ||
  !supabaseUrl ||
  !supabaseAnonKey;

/**
 * Where synced data is kept: "supabase" (the default) or "dynamodb". With
 * DynamoDB, sign-in still uses Supabase Auth, and the app's own server reads
 * and writes the table (see src/app/api/sync/route.ts).
 */
export const dataBackend: "supabase" | "dynamodb" =
  process.env.NEXT_PUBLIC_DATA_BACKEND === "dynamodb" ? "dynamodb" : "supabase";
