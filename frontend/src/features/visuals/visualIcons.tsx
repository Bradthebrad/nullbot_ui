import {ChartColumn, FileText, Image, LayoutTemplate, ListChecks, PenTool, Workflow, type LucideIcon} from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  poll: ListChecks,
  html: LayoutTemplate,
  svg: PenTool,
  image: Image,
  chart: ChartColumn,
  drawio: Workflow,
  file: FileText,
};

export function VisualIcon({kind, size = 15}: {kind: string; size?: number}) {
  const Icon = icons[kind] || LayoutTemplate;
  return <Icon size={size} strokeWidth={1.75} className={`visual-icon kind-${kind}`} aria-hidden="true" />;
}
