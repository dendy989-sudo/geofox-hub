export function getSupabaseConfig() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!value || !key) return null;
  try {
    const url = new URL(value);
    const local = process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    // Public Auth clients accept only a publishable key or the legacy anon JWT.
    // A private server key is never an acceptable browser configuration.
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
      const parts = key.split(".");
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
      if (payload?.role !== "anon") return null;
    }
    return { url: url.origin, key };
  } catch { return null; }
}
