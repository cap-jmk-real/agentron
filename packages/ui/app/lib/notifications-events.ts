/** Fired when notifications may have changed (cleared from modal, user responded in chat, etc.). Listeners should refetch their notification data. */
export const NOTIFICATIONS_UPDATED_EVENT = "agentron-notifications-updated";

export function dispatchNotificationsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_UPDATED_EVENT));
}
