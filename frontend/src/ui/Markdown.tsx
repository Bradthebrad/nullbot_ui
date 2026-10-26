import {memo, useState, type ReactNode} from 'react';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {Check, Copy} from 'lucide-react';
import {classifyHref} from '../lib/links';

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as any).props.children);
  return '';
}

export function CopyButton({text, label = 'Copy'}: {text: string; label?: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm copy-button"
      aria-label={copied ? 'Copied' : label}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

const components: Components = {
  pre({children}) {
    const text = textOf(children).replace(/\n$/, '');
    const lang = /language-(\w+)/.exec(String((children as any)?.props?.className || ''))?.[1];
    return (
      <div className="code-block">
        <div className="code-block-bar">
          <span>{lang || 'text'}</span>
          <CopyButton text={text} />
        </div>
        <pre>{children}</pre>
      </div>
    );
  },
  a({href, children}) {
    const target = classifyHref(href);
    if (target.kind === 'blocked') return <span className="link-blocked" title={target.reason}>{children}</span>;
    const external = target.kind === 'external';
    return (
      <a href={href} className={external ? 'link-external' : target.kind === 'local' ? 'link-local' : undefined} title={external ? target.url : target.kind === 'local' ? `Open ${target.path} (Ctrl+click to open with the system app)` : undefined}>
        {children}
      </a>
    );
  },
  img({src, alt}) {
    if (typeof src !== 'string') return null;
    if (/^data:image\/(png|jpe?g|gif|webp);/.test(src) || src.startsWith('/__local/')) return <img src={src} alt={alt || ''} loading="lazy" />;
    if (/^https:\/\//.test(src)) return <RemoteImage src={src} alt={alt || ''} />;
    return <span className="faint">[image: {alt || 'not shown'}]</span>;
  },
  table({children}) {
    return <div className="table-scroll"><table>{children}</table></div>;
  },
};

/**
 * Remote images load only when asked: an image URL in a reply could carry
 * data out to its host the moment it rendered.
 */
function RemoteImage({src, alt}: {src: string; alt: string}) {
  const [shown, setShown] = useState(false);
  if (shown) return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />;
  let host = src;
  try {
    host = new URL(src).host;
  } catch {
    /* shown as given */
  }
  return (
    <button type="button" className="remote-image" onClick={() => setShown(true)} title={src}>
      Show image{alt ? ` “${alt}”` : ''} from {host}
    </button>
  );
}

// Links and images are judged by the components above, so URLs pass through
// unchanged (the default transform would empty Windows paths like C:\…).
const keepUrl = (url: string) => url;

function MarkdownInner({children, className = 'prose'}: {children: string; className?: string}) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={keepUrl}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}

/** Markdown with routed links and copyable code. Memoized on its text. */
export const Markdown = memo(MarkdownInner);
