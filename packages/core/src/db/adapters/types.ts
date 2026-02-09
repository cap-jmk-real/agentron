export type DatabaseAdapter<TDatabase> = {
  db: TDatabase;
  close: () => void;
  initialize?: () => void;
  /** Create a consistent backup to a file (e.g. for export). */
  backupToPath?: (targetPath: string) => Promise<void>;
  /** Replace current DB content with backup from file (in-process, no restart needed). */
  restoreFromPath?: (sourcePath: string) => Promise<void>;
  /** Drop all tables and re-create from current schema. Use to clear data or fix schema drift. */
  resetDatabase?: () => void;
}
