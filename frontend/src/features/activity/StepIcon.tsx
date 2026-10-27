import {
  AppWindow, BookOpen, Bot, Brain, FileSearch, FileText, Globe, HardDrive, Image, Info, Mail, MessageCircle, OctagonAlert,
  PenLine, Search, ShieldAlert, Sparkles, SquareTerminal, Trash2, Wrench,
} from 'lucide-react';
import type {StepCategory} from './describe';
import type {Step} from './model';

const icons: Record<StepCategory, typeof Globe> = {
  search: Search,
  web: Globe,
  browser: AppWindow,
  email: Mail,
  drive: HardDrive,
  message: MessageCircle,
  document: FileSearch,
  image: Image,
  file: FileText,
  edit: PenLine,
  delete: Trash2,
  command: SquareTerminal,
  agent: Bot,
  skill: BookOpen,
  nullbot: Sparkles,
  tool: Wrench,
};

export function StepIcon({step, category, size = 12}: {step: Step; category: StepCategory; size?: number}) {
  if (step.state === 'blocked') return <ShieldAlert size={size} />;
  if (step.kind === 'error') return <OctagonAlert size={size} />;
  if (step.kind === 'note') return <Info size={size} />;
  if (step.kind === 'thinking') return <Brain size={size} />;
  const Icon = icons[category] || Wrench;
  return <Icon size={size} />;
}
