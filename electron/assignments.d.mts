type Item = { id: string; parent: string | null; data: Record<string, any> };
type StoreLike = {
  get: (id: string) => Item | null | undefined;
  settings: () => { activeAgent: string };
};
export function assignedAgent(store: StoreLike, item: Item | null | undefined): string;
export function requireAssignedAgent(store: StoreLike, item: Item | null | undefined): string;
