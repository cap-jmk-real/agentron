/**
 * Schedules workflow runs for workflows with executionMode "interval" or "continuous" and a schedule.
 * Uses WorkflowScheduler for interval (seconds); uses setTimeout for daily@ / weekly@ and reschedules after each run.
 */
import { WorkflowScheduler } from "@agentron-studio/runtime";
import { eq, inArray } from "drizzle-orm";
import { db, workflows, executions } from "./db";
import { fromWorkflowRow, toExecutionRow } from "./db";
import { executionOutputSuccess, executionOutputFailure } from "./db";
import { runWorkflow, RUN_CANCELLED_MESSAGE, WAITING_FOR_USER_MESSAGE } from "./run-workflow";
import { enqueueWorkflowRun } from "./workflow-queue";
import type { Workflow } from "@agentron-studio/core";

const intervalScheduler = new WorkflowScheduler();
const calendarTimeouts = new Map<string, NodeJS.Timeout>();

/** Exported for tests. */
export function parseScheduleSeconds(schedule: string): number | null {
  const s = schedule.trim();
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

/** Parse daily@HH:mm -> { type: 'daily', hour, minute }. Exported for tests. */
export function parseDaily(schedule: string): { hour: number; minute: number } | null {
  const s = schedule.trim();
  if (!s.startsWith("daily@")) return null;
  const time = s.slice(6).trim();
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return { hour, minute };
}

/** Parse weekly@d1,d2,... (0-6, Sunday=0) -> { type: 'weekly', days: number[] }. Exported for tests. */
export function parseWeekly(schedule: string): number[] | null {
  const s = schedule.trim();
  if (!s.startsWith("weekly@")) return null;
  const part = s.slice(7).trim();
  if (!part) return null;
  const days = part.split(",").map((d) => Math.min(6, Math.max(0, parseInt(d.trim(), 10) || 0)));
  return days.length > 0 ? days : null;
}

/** Next run time (ms from now) for daily at HH:mm in local time. Exported for tests. */
export function nextDailyMs(hour: number, minute: number): number {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/** Next run time (ms from now) for weekly on given days (0-6). Exported for tests. */
export function nextWeeklyMs(days: number[]): number {
  const now = new Date();
  const currentDay = now.getDay();
  let daysAhead = 0;
  for (let i = 1; i <= 7; i++) {
    const d = (currentDay + i) % 7;
    if (days.includes(d)) {
      daysAhead = i;
      break;
    }
  }
  const next = new Date(now);
  next.setDate(next.getDate() + daysAhead);
  next.setHours(0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

async function runOneScheduledWorkflow(workflowId: string): Promise<void> {
  const runId = crypto.randomUUID();
  await db
    .insert(executions)
    .values(toExecutionRow({ id: runId, targetType: "workflow", targetId: workflowId, status: "running" }))
    .run();

  try {
    const onStepComplete = async (trail: Array<{ order: number; round?: number; nodeId: string; agentName: string; input?: unknown; output?: unknown; error?: string }>, lastOutput: unknown) => {
      const payload = executionOutputSuccess(lastOutput ?? undefined, trail);
      await db.update(executions).set({ output: JSON.stringify(payload) }).where(eq(executions.id, runId)).run();
    };
    const isCancelled = async () => {
      const rows = await db.select({ status: executions.status }).from(executions).where(eq(executions.id, runId));
      return rows[0]?.status === "cancelled";
    };
    const { output, context, trail } = await runWorkflow({ workflowId, runId, onStepComplete, isCancelled });
    const payload = executionOutputSuccess(output ?? context, trail);
    await db
      .update(executions)
      .set({ status: "completed", finishedAt: Date.now(), output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === WAITING_FOR_USER_MESSAGE) {
      return;
    }
    if (message === RUN_CANCELLED_MESSAGE) {
      await db.update(executions).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(executions.id, runId)).run();
      return;
    }
    const payload = executionOutputFailure(message, { message, stack: err instanceof Error ? err.stack : undefined });
    await db
      .update(executions)
      .set({ status: "failed", finishedAt: Date.now(), output: JSON.stringify(payload) })
      .where(eq(executions.id, runId))
      .run();
  }
}

function scheduleCalendarWorkflow(workflow: Workflow): void {
  const schedule = workflow.schedule?.trim();
  if (!schedule) return;

  const daily = parseDaily(schedule);
  if (daily) {
    const run = () => {
      void enqueueWorkflowRun(() => runOneScheduledWorkflow(workflow.id)).then(() => {
        const ms = nextDailyMs(daily.hour, daily.minute);
        const t = setTimeout(() => scheduleCalendarWorkflow(workflow), ms);
        calendarTimeouts.set(workflow.id, t);
      });
    };
    const ms = nextDailyMs(daily.hour, daily.minute);
    const t = setTimeout(run, ms);
    calendarTimeouts.set(workflow.id, t);
    return;
  }

  const weeklyDays = parseWeekly(schedule);
  if (weeklyDays) {
    const run = () => {
      void enqueueWorkflowRun(() => runOneScheduledWorkflow(workflow.id)).then(() => {
        const ms = nextWeeklyMs(weeklyDays);
        const t = setTimeout(() => scheduleCalendarWorkflow(workflow), ms);
        calendarTimeouts.set(workflow.id, t);
      });
    };
    const ms = nextWeeklyMs(weeklyDays);
    const t = setTimeout(run, ms);
    calendarTimeouts.set(workflow.id, t);
  }
}

function clearCalendarWorkflow(workflowId: string): void {
  const t = calendarTimeouts.get(workflowId);
  if (t) {
    clearTimeout(t);
    calendarTimeouts.delete(workflowId);
  }
}

/**
 * Load workflows with executionMode interval/continuous and schedule set; register them with the scheduler.
 * Call on server start and after workflow create/update/delete.
 */
export function refreshScheduledWorkflows(): void {
  intervalScheduler.clearAll();
  for (const t of calendarTimeouts.values()) clearTimeout(t);
  calendarTimeouts.clear();

  void (async () => {
    const rows = await db
      .select()
      .from(workflows)
      .where(inArray(workflows.executionMode, ["interval", "continuous"]));
    const withSchedule = rows.filter((r) => r.schedule?.trim());
    for (const row of withSchedule) {
      const workflow = fromWorkflowRow(row) as Workflow;
      const schedule = workflow.schedule!.trim();

      const seconds = parseScheduleSeconds(schedule);
      if (seconds != null) {
        const intervalMs = seconds * 1000;
        intervalScheduler.scheduleInterval(workflow, intervalMs, () =>
          enqueueWorkflowRun(() => runOneScheduledWorkflow(workflow.id))
        );
        continue;
      }

      if (schedule.startsWith("daily@") || schedule.startsWith("weekly@")) {
        scheduleCalendarWorkflow(workflow);
      }
    }
  })();
}
