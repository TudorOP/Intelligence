export type SetupProgress = {
  version: number;
  stage: string;
  status: 'not-started' | 'in-progress' | 'deferred' | 'completed';
  outcomes: Record<string, 'configured' | 'skipped'>;
  lessons: Record<string, number>;
};
export const setupStages: string[];
export const initialSetup: SetupProgress;
export function validateSetup(value: unknown): SetupProgress;
