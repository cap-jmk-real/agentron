/**
 * Schedules workflow runs for workflows with executionMode "interval" or "continuous" and a schedule.
 * Uses WorkflowScheduler for interval (seconds); uses setTimeout for daily@ / weekly@ and reschedules after each run.
 * All runs go through the DB-backed workflow queue (enqueueScheduledWorkflow + waitForJob).
 */
import { WorkflowScheduler } from "@agentron-studio/runtime";
import { eq } from "drizzle-orm";
import { db, workflows } from "./db";
import { fromWorkflowRow } from "./db";
import { enqueueScheduledWorkflow, waitForJob } from "./workflow-queue";
import type { Workflow } from "@agentron-studio/core";

const intervalScheduler = new WorkflowScheduler();
const calendarTimeouts = new Map<string, NodeJS.Timeout>();
/** Timeouts for "continuous" mode: re-run after each run completes. Key = scheduleKey(workflowId, branchId). */
const continuousTimeouts = new Map<string, NodeJS.Timeout>();

/** Default delay (ms) between consecutive runs when executionMode is continuous and no schedule is set. */
const CONTINUOUS_DEFAULT_DELAY_MS = 1000;

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

/** Key for calendar timeout map: workflow-only or workflow:branchId for branch schedules. */
function scheduleKey(workflowId: string, branchId?: string): string {
  return branchId ? `${workflowId}:${branchId}` : workflowId;
}

/**
 * Start a continuous loop for a workflow or branch: run once, then when the run completes (not when it pauses for user),
 * wait delayMs and run again. Repeats until refreshScheduledWorkflows clears it.
 */
function runContinuousLoop(workflowId: string, branchId: string | undefined, delayMs: number): void {
  const key = scheduleKey(workflowId, branchId);
  const run = async () => {
    try {
      const jobId = await enqueueScheduledWorkflow({ workflowId, branchId });
      await waitForJob(jobId);
    } catch {
      // continue to reschedule
    }
    const t = setTimeout(() => runContinuousLoop(workflowId, branchId, delayMs), delayMs);
    continuousTimeouts.set(key, t);
  };
  void run();
}

function scheduleCalendarWorkflow(workflow: Workflow, branchId?: string): void {
  const schedule = branchId
    ? (workflow.branches?.find((b) => b.id === branchId)?.schedule?.trim())
    : workflow.schedule?.trim();
  if (!schedule) return;

  const daily = parseDaily(schedule);
  if (daily) {
    const run = async () => {
      try {
        const jobId = await enqueueScheduledWorkflow({ workflowId: workflow.id, branchId });
        await waitForJob(jobId);
      } catch {
        // continue to reschedule
      }
      const ms = nextDailyMs(daily.hour, daily.minute);
      const t = setTimeout(() => scheduleCalendarWorkflow(workflow, branchId), ms);
      calendarTimeouts.set(scheduleKey(workflow.id, branchId), t);
    };
    const ms = nextDailyMs(daily.hour, daily.minute);
    const t = setTimeout(() => void run(), ms);
    calendarTimeouts.set(scheduleKey(workflow.id, branchId), t);
    return;
  }

  const weeklyDays = parseWeekly(schedule);
  if (weeklyDays) {
    const run = async () => {
      try {
        const jobId = await enqueueScheduledWorkflow({ workflowId: workflow.id, branchId });
        await waitForJob(jobId);
      } catch {
        // continue to reschedule
      }
      const ms = nextWeeklyMs(weeklyDays);
      const t = setTimeout(() => scheduleCalendarWorkflow(workflow, branchId), ms);
      calendarTimeouts.set(scheduleKey(workflow.id, branchId), t);
    };
    const ms = nextWeeklyMs(weeklyDays);
    const t = setTimeout(() => void run(), ms);
    calendarTimeouts.set(scheduleKey(workflow.id, branchId), t);
  }
}

function clearCalendarWorkflow(workflowId: string): void {
  const t = calendarTimeouts.get(workflowId);
  if (t) {
    clearTimeout(t);
    calendarTimeouts.delete(workflowId);
  }
  for (const key of calendarTimeouts.keys()) {
    if (key.startsWith(`${workflowId}:`)) {
      clearTimeout(calendarTimeouts.get(key)!);
      calendarTimeouts.delete(key);
    }
  }
}

/**
 * Load workflows with executionMode interval/continuous and schedule set, or with branches that have their own schedules; register with the scheduler.
 * Call on server start and after workflow create/update/delete.
 */
export function refreshScheduledWorkflows(): void {
  intervalScheduler.clearAll();
  for (const t of calendarTimeouts.values()) clearTimeout(t);
  calendarTimeouts.clear();
  for (const t of continuousTimeouts.values()) clearTimeout(t);
  continuousTimeouts.clear();

  void (async () => {
    const rows = await db.select().from(workflows);
    for (const row of rows) {
      const workflow = fromWorkflowRow(row) as Workflow;
      const hasBranches = Array.isArray(workflow.branches) && workflow.branches.length > 0;

      if (hasBranches) {
        for (const branch of workflow.branches!) {
          const mode = branch.executionMode ?? workflow.executionMode;
          if (mode === "one_time") continue;

          const schedule = branch.schedule?.trim();

          if (mode === "continuous") {
            const delayMs =
              schedule != null && parseScheduleSeconds(schedule) != null
                ? parseScheduleSeconds(schedule)! * 1000
                : CONTINUOUS_DEFAULT_DELAY_MS;
            runContinuousLoop(workflow.id, branch.id, delayMs);
            continue;
          }

          if (mode === "interval" && schedule) {
            const seconds = parseScheduleSeconds(schedule);
            if (seconds != null) {
              const intervalMs = seconds * 1000;
              intervalScheduler.scheduleInterval(
                { ...workflow, id: `${workflow.id}:${branch.id}` },
                intervalMs,
                async () => {
                  const jobId = await enqueueScheduledWorkflow({ workflowId: workflow.id, branchId: branch.id });
                  await waitForJob(jobId);
                }
              );
              continue;
            }
            if (schedule.startsWith("daily@") || schedule.startsWith("weekly@")) {
              scheduleCalendarWorkflow(workflow, branch.id);
            }
          }
        }
        continue;
      }

      const mode = workflow.executionMode;
      if (mode === "one_time") continue;

      const schedule = workflow.schedule?.trim();

      if (mode === "continuous") {
        const delayMs =
          schedule != null && parseScheduleSeconds(schedule) != null
            ? parseScheduleSeconds(schedule)! * 1000
            : CONTINUOUS_DEFAULT_DELAY_MS;
        runContinuousLoop(workflow.id, undefined, delayMs);
        continue;
      }

      if (mode === "interval" && schedule) {
        const seconds = parseScheduleSeconds(schedule);
        if (seconds != null) {
          const intervalMs = seconds * 1000;
          intervalScheduler.scheduleInterval(workflow, intervalMs, async () => {
            const jobId = await enqueueScheduledWorkflow({ workflowId: workflow.id });
            await waitForJob(jobId);
          });
          continue;
        }
        if (schedule.startsWith("daily@") || schedule.startsWith("weekly@")) {
          scheduleCalendarWorkflow(workflow);
        }
      }
    }
  })();
}
