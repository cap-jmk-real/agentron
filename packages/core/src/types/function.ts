export interface CustomFunction {
  id: string;
  name: string;
  description?: string;
  language: string;
  source: string;
  sandboxId?: string;
  createdAt: number;
}
