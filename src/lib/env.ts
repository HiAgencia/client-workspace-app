export function serverEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function requireServerEnv(name: string): string {
  const value = serverEnv(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export type PublicConfig = { supabaseUrl: string; supabaseKey: string };

export function publicConfig(): PublicConfig {
  return {
    supabaseUrl: requireServerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseKey: requireServerEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}
