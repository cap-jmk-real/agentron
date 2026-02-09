export class SharedContextManager {
  private context: Record<string, unknown>;

  constructor(initial?: Record<string, unknown>) {
    this.context = { ...(initial ?? {}) };
  }

  get<T = unknown>(key: string): T | undefined {
    return this.context[key] as T | undefined;
  }

  set(key: string, value: unknown) {
    this.context[key] = value;
  }

  merge(values: Record<string, unknown>) {
    this.context = { ...this.context, ...values };
  }

  snapshot() {
    return { ...this.context };
  }
}
