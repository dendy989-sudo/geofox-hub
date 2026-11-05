"use client";
export default function FinanceError({ reset }: { reset: () => void }) {
  return <main style={{ maxWidth: 620, margin: "12vh auto", padding: 32, fontFamily: "system-ui" }}><h1>Your finance workspace couldn’t load.</h1><p>Your saved records have not been changed. Try opening the workspace again.</p><button type="button" onClick={reset} style={{ padding: "12px 18px", marginRight: 16 }}>Try again</button><a href="/admin/login?next=/finance">Sign in again</a></main>;
}
