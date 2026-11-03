import "server-only";
import type { HubApp, ServiceStatus } from "@/lib/hub/types";

const defaults = ["geofoxapps.com", "www.geofoxapps.com", "mynovanook.com", "www.mynovanook.com"];
const timeout = () => AbortSignal.timeout(6500);

/** Only explicitly trusted public hosts are probed. App-edit fields cannot become arbitrary fetch targets. */
export async function websiteHealth(app: HubApp): Promise<ServiceStatus> {
  const base: ServiceStatus = { id: "website", appSlug: app.slug, name: `${app.name} website`, status: "unknown", detail: "The website host has not been approved for health checks.", latencyMs: null, checkedAt: null };
  const allowed = [...defaults, ...(process.env.HUB_HEALTH_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean)];
  let target: URL;
  try {
    target = new URL(app.website);
    if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443") || !allowed.includes(target.hostname.toLowerCase())) return base;
    target = new URL("/", target.origin);
  } catch { return base; }
  const started = Date.now();
  try {
    const response = await fetch(target, { method: "HEAD", redirect: "manual", cache: "no-store", signal: timeout() });
    return { ...base, status: response.status >= 200 && response.status < 400 ? "healthy" : response.status >= 500 ? "down" : "degraded", detail: `Homepage returned HTTP ${response.status}. This check measures website reachability, not every app feature.`, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
  } catch { return { ...base, status: "down", detail: "The public homepage did not respond within this check. Confirm in the provider dashboard before taking action.", latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }; }
}

export async function vercelHealth(appSlug: string, appName: string): Promise<ServiceStatus> {
  const prefix = appSlug === "geofox" ? "HUB" : appSlug.replaceAll("-", "_").toUpperCase();
  const token = process.env.VERCEL_ACCESS_TOKEN;
  const project = process.env[`${prefix}_VERCEL_PROJECT_ID`];
  const base: ServiceStatus = { id: "vercel", appSlug, name: `${appName} deployment`, status: "unknown", detail: !token ? "Add VERCEL_ACCESS_TOKEN to Geofox’s production environment and redeploy. The hub uses it to read deployments; ChatGPT’s Vercel connection is separate." : `Add ${prefix}_VERCEL_PROJECT_ID to Geofox’s production environment and redeploy.`, latencyMs: null, checkedAt: null };
  if (!token || !project) return base;
  const query = new URLSearchParams({ projectId: project, target: "production", limit: "1" });
  if (process.env.VERCEL_TEAM_ID) query.set("teamId", process.env.VERCEL_TEAM_ID);
  const started = Date.now();
  try {
    const response = await fetch(`https://api.vercel.com/v6/deployments?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: timeout() });
    if (!response.ok) return { ...base, status: "degraded", detail: "Vercel’s deployment check could not be authenticated or completed. Check its token, team and project settings.", checkedAt: new Date().toISOString() };
    const body = await response.json() as { deployments?: { readyState?: string; state?: string }[] };
    const deployment = body.deployments?.[0];
    const state = deployment?.readyState || deployment?.state;
    return { ...base, status: state === "READY" ? "healthy" : state === "ERROR" || state === "CANCELED" ? "degraded" : "unknown", detail: state === "READY" ? "The latest production deployment is ready. Runtime errors are monitored separately." : state === "ERROR" ? "The latest production deployment failed. A previous release may still be serving." : state === "CANCELED" ? "The latest production deployment was canceled." : deployment ? "The latest production deployment is still being prepared." : "No production deployment was returned for this project.", latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
  } catch { return { ...base, detail: "The Vercel check timed out or could not be reached.", checkedAt: new Date().toISOString() }; }
}
