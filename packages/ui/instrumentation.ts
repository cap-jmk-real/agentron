/**
 * Runs when the Next.js server starts. Used to start the scheduled workflow scheduler,
 * the reminder scheduler, and to register the scheduled-turn runner (so assistant_task
 * reminders can run the assistant when they fire).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refreshScheduledWorkflows } = await import("./app/api/_lib/scheduled-workflows");
    refreshScheduledWorkflows();
    await import("./app/api/chat/route"); // register scheduled-turn runner before any reminder can fire
    const { refreshReminderScheduler } = await import("./app/api/_lib/reminder-scheduler");
    refreshReminderScheduler();
  }
}
