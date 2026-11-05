/** Keep keyboard navigation in the open drawer and its workspace rail. */
export function trapMobileMenuFocus(event: KeyboardEvent, sidebarId: string): void {
  if (event.key !== "Tab") return;
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const rail = document.querySelector<HTMLElement>(".hub-area-rail"), sidebar = document.getElementById(sidebarId);
  const focusable = [rail, sidebar].flatMap(root => root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : []).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
  if (!focusable.length) return;
  const active = document.activeElement, first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !focusable.includes(active as HTMLElement))) { event.preventDefault(); first.focus(); }
}
