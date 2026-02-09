export interface Feedback {
  id: string;
  targetType: "agent" | "chat";
  targetId: string;
  executionId?: string;
  input: unknown;
  output: unknown;
  label: "good" | "bad";
  notes?: string;
  createdAt: number;
}
