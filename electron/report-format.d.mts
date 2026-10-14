export type ReportSection = { title: string; content: string };
export function parseReport(text: unknown): { summary: string; sections: ReportSection[] } | null;
export function reportView(data?: any): {
  summary: string;
  sections: ReportSection[];
  content: string;
};
export function fullReport(sections: ReportSection[]): string;
export function markdownSections(text: string): ReportSection[];
