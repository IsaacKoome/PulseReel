export function isAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  );
}

export function isAuthEnabled() {
  return process.env.PULSEREEL_AUTH_ENABLED === "true" && isAuthConfigured();
}
