/**
 * Deep-link helpers for Knowledge page (e.g. ?tab=connectors).
 */
export function shouldOpenConnectorsTab(searchParams: URLSearchParams): boolean {
  return searchParams.get("tab") === "connectors";
}
