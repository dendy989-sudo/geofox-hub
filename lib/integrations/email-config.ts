/** Public support identity. Staff login addresses must never become mail headers. */
export const supportEmail = "support@geofoxapps.com";

export function supportEmailSettings(env: NodeJS.ProcessEnv = process.env): { from: string; replyTo: string } | null {
  const configured = env.SUPPORT_FROM_EMAIL?.trim();
  if (!configured || /[\r\n]/.test(configured)) return null;
  const match = /^(?:[^<>]*<)?(support@(?:notify\.)?geofoxapps\.com)>?$/i.exec(configured);
  if (!match || configured.includes("<") !== configured.endsWith(">")) return null;
  return { from: `Geofox Support <${match[1].toLowerCase()}>`, replyTo: supportEmail };
}
