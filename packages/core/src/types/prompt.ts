export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  arguments?: {
    name: string;
    description?: string;
    required?: boolean;
  }[];
  template: string;
}
