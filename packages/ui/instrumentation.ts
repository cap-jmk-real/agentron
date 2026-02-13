/**
 * Runs when the Next.js server starts. Used to start the scheduled workflow scheduler.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refreshScheduledWorkflows } = await import("./app/api/_lib/scheduled-workflows");
    refreshScheduledWorkflows();
  }
}
