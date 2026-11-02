import Link from "next/link";
import { UtilityShell } from "@/components/utility-shell";

export default function NotFound() {
  return (
    <UtilityShell>
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>Let’s find<br />your way back.</h1>
      <p className="utility-intro">This page may have moved, or the address may be incomplete.</p>
      <Link className="button" href="/">Back to Geofox <span aria-hidden="true">↗</span></Link>
    </UtilityShell>
  );
}
