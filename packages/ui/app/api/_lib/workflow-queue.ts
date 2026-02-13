/**
 * In-memory queue for workflow runs. Limits concurrent executions (default 2)
 * so that many simultaneous triggers (UI, API, scheduler) don't overload the system.
 */
const CONCURRENCY = 2;
const queue: Array<() => Promise<void>> = [];
let running = 0;

function tryRun(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    job().finally(() => {
      running--;
      tryRun();
    });
  }
}

/**
 * Enqueue a workflow run. Returns a promise that resolves when the run has completed
 * (or failed). The run itself is executed when a worker slot is free.
 */
export function enqueueWorkflowRun(run: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push(() =>
      run().then(resolve, reject)
    );
    tryRun();
  });
}
