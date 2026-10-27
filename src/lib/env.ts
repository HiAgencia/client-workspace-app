// Server configuration is read at request time, by a computed name, so the build never inlines a value: the same
// build runs locally and on the Worker with each place's own variables.
export function serverEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

// A missing variable stops the request with its name instead of running half configured.
export function requireServerEnv(name: string): string {
  const value = serverEnv(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export type PublicConfig = { supabaseUrl: string; supabaseKey: string };

// What the browser needs to talk to Supabase: the project URL and the publishable key, both public by design.
export function publicConfig(): PublicConfig {
  return {
    supabaseUrl: requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseKey: requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}
