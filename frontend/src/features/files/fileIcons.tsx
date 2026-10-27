// Icons for files by kind and extension. Each group has its own muted tint
// so a long listing scans by type at a glance.
import {
  Database, File, FileArchive, FileAudio, FileCode, FileCog, FileImage, FileJson, FileKey, FileSpreadsheet, FileTerminal,
  FileText, FileType, FileVideo, Folder, Presentation, type LucideIcon,
} from 'lucide-react';
import type {FileEntry} from '../../lib/types';

type Look = {icon: LucideIcon; tone: string};

const byKind: Record<string, Look> = {
  folder: {icon: Folder, tone: 'folder'},
  markdown: {icon: FileText, tone: 'doc'},
  text: {icon: FileText, tone: 'plain'},
  docx: {icon: FileText, tone: 'doc'},
  odt: {icon: FileText, tone: 'doc'},
  rtf: {icon: FileText, tone: 'doc'},
  pdf: {icon: FileText, tone: 'pdf'},
  html: {icon: FileCode, tone: 'code'},
  code: {icon: FileCode, tone: 'code'},
  json: {icon: FileJson, tone: 'code'},
  data: {icon: FileJson, tone: 'code'},
  csv: {icon: FileSpreadsheet, tone: 'sheet'},
  xlsx: {icon: FileSpreadsheet, tone: 'sheet'},
  ods: {icon: FileSpreadsheet, tone: 'sheet'},
  pptx: {icon: Presentation, tone: 'slides'},
  odp: {icon: Presentation, tone: 'slides'},
  image: {icon: FileImage, tone: 'media'},
  audio: {icon: FileAudio, tone: 'media'},
  video: {icon: FileVideo, tone: 'media'},
  font: {icon: FileType, tone: 'plain'},
  archive: {icon: FileArchive, tone: 'archive'},
  binary: {icon: File, tone: 'plain'},
};

const byExtension: Record<string, Look> = {
  '.sh': {icon: FileTerminal, tone: 'code'}, '.bash': {icon: FileTerminal, tone: 'code'}, '.zsh': {icon: FileTerminal, tone: 'code'},
  '.ps1': {icon: FileTerminal, tone: 'code'}, '.bat': {icon: FileTerminal, tone: 'code'}, '.cmd': {icon: FileTerminal, tone: 'code'},
  '.exe': {icon: FileTerminal, tone: 'plain'}, '.msi': {icon: FileTerminal, tone: 'plain'},
  '.ini': {icon: FileCog, tone: 'plain'}, '.cfg': {icon: FileCog, tone: 'plain'}, '.conf': {icon: FileCog, tone: 'plain'}, '.env': {icon: FileCog, tone: 'plain'},
  '.toml': {icon: FileCog, tone: 'code'}, '.yaml': {icon: FileCog, tone: 'code'}, '.yml': {icon: FileCog, tone: 'code'}, '.properties': {icon: FileCog, tone: 'plain'},
  '.pem': {icon: FileKey, tone: 'plain'}, '.key': {icon: FileKey, tone: 'plain'}, '.crt': {icon: FileKey, tone: 'plain'}, '.cer': {icon: FileKey, tone: 'plain'}, '.pub': {icon: FileKey, tone: 'plain'}, '.pfx': {icon: FileKey, tone: 'plain'},
  '.db': {icon: Database, tone: 'sheet'}, '.sqlite': {icon: Database, tone: 'sheet'}, '.sqlite3': {icon: Database, tone: 'sheet'}, '.mdb': {icon: Database, tone: 'sheet'}, '.accdb': {icon: Database, tone: 'sheet'},
};

export function lookFor(entry: Pick<FileEntry, 'is_dir' | 'kind' | 'extension' | 'name'>): Look {
  if (entry.is_dir) return byKind.folder;
  const raw = (entry.extension || (entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '')).toLowerCase();
  const ext = raw && !raw.startsWith('.') ? `.${raw}` : raw;
  return byExtension[ext] || byKind[entry.kind] || byKind.binary;
}

export function EntryIcon({entry, size = 15}: {entry: Pick<FileEntry, 'is_dir' | 'kind' | 'extension' | 'name'>; size?: number}) {
  const {icon: Icon, tone} = lookFor(entry);
  return <Icon size={size} strokeWidth={1.75} className={`file-icon tone-${tone}`} aria-hidden="true" />;
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case 'markdown': return 'Markdown';
    case 'code': return 'Code';
    case 'json': return 'JSON';
    case 'data': return 'JSON lines';
    case 'csv': return 'Table';
    case 'html': return 'Web page';
    case 'xlsx': case 'ods': return 'Spreadsheet';
    case 'docx': return 'Word document';
    case 'odt': return 'Document';
    case 'rtf': return 'Rich text';
    case 'pptx': case 'odp': return 'Presentation';
    case 'pdf': return 'PDF';
    case 'image': return 'Image';
    case 'audio': return 'Audio';
    case 'video': return 'Video';
    case 'font': return 'Font';
    case 'archive': return 'Archive';
    case 'binary': return 'Binary file';
    case 'folder': return 'Folder';
    default: return 'Text';
  }
}
