"use client";
import Link from "next/link";
import "@/components/auth/auth.css";
export default function TaxError({ reset }: { reset: () => void }) { return <div className="auth-surface"><section className="auth-setup"><span className="auth-chip">GEOFOX TAXES</span><h1>Let's reconnect to your records.</h1><p>This page could not finish loading. Your saved records are kept. Try opening it again.</p><div className="auth-setup-actions"><button className="auth-primary" onClick={reset}>Try again</button><Link href="/apps">Personal apps</Link></div></section></div>; }
