import {useMemo, useState} from 'react';
import {FolderOpen} from 'lucide-react';
import {api} from '../../lib/bindings';
import {useResource} from '../../lib/useResource';
import {formatCost, formatCount} from '../../lib/format';
import type {UsageReport, UsageTotals} from '../../lib/types';
import {Segmented} from '../../ui/Tabs';
import {Spinner} from '../../ui/layout';
import {toast, toastError} from '../../ui/toast';

type Range = 'today' | '7d' | '30d' | 'month' | 'last-month' | 'all';
type Bucket = 'hour' | 'day' | 'week' | 'month';

const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function rangeDates(range: Range): {start?: string; end?: string} {
  const now = new Date();
  const back = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };
  switch (range) {
    case 'today': return {start: ymd(now), end: ymd(now)};
    case '7d': return {start: ymd(back(6)), end: ymd(now)};
    case '30d': return {start: ymd(back(29)), end: ymd(now)};
    case 'month': return {start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end: ymd(now)};
    case 'last-month': return {start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: ymd(new Date(now.getFullYear(), now.getMonth(), 0))};
    default: return {};
  }
}

export function UsageSettings() {
  const [range, setRange] = useState<Range>('30d');
  const [bucket, setBucket] = useState<Bucket | 'auto'>('auto');
  const [model, setModel] = useState('');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const effectiveBucket: Bucket = bucket === 'auto' ? (range === 'today' ? 'hour' : range === 'all' ? 'month' : 'day') : bucket;
  const filter = useMemo(() => ({...rangeDates(range), bucket: effectiveBucket, model: model || undefined}), [range, effectiveBucket, model]);
  const {data: report, error, loading} = useResource<UsageReport>(() => api.buildUsageReport(filter, false), {deps: [JSON.stringify(filter)]});
  const models = useMemo(() => [...new Set((report?.records || []).map((r: any) => String(r.model || '')).filter(Boolean))].sort(), [report]);
  const totals: UsageTotals = report?.totals || {};

  async function save() {
    try {
      const saved = await api.saveUsageReport(filter);
      toast(`Report saved to ${saved.path}.`, 'success');
      if (saved.path) void api.revealPath(saved.path).catch(() => undefined);
    } catch (err) {
      toastError(err);
    }
  }

  return (
    <section>
      <header className="settings-head">
        <h2>Usage</h2>
        <p className="muted">Tokens and estimated cost for every model request NullBot made, including subagents.</p>
      </header>
      <div className="usage-bar">
        <Segmented label="Period" value={range} onChange={setRange} options={[
          {id: 'today', label: 'Today'}, {id: '7d', label: '7 days'}, {id: '30d', label: '30 days'},
          {id: 'month', label: 'This month'}, {id: 'last-month', label: 'Last month'}, {id: 'all', label: 'All'},
        ]} />
        <select className="select select-sm" value={bucket} onChange={event => setBucket(event.target.value as Bucket | 'auto')} aria-label="Group by">
          <option value="auto">Group automatically</option>
          <option value="hour">By hour</option>
          <option value="day">By day</option>
          <option value="week">By week</option>
          <option value="month">By month</option>
        </select>
        <select className="select select-sm" value={model} onChange={event => setModel(event.target.value)} aria-label="Model">
          <option value="">All models</option>
          {[...new Set([...(model ? [model] : []), ...models])].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {error && <p className="notice bad">{error}</p>}
      <div className="stat-row">
        <Stat label="Requests" value={formatCount(totals.requests)} />
        <Stat label="Tokens in" value={formatCount(totals.input_tokens)} sub={totals.cached_input_tokens ? `${formatCount(totals.cached_input_tokens)} from cache` : undefined} />
        <Stat label="Tokens out" value={formatCount(totals.output_tokens)} sub={totals.reasoning_output_tokens ? `${formatCount(totals.reasoning_output_tokens)} thinking` : undefined} />
        <Stat label="Estimated cost" value={formatCost(totals.cost_usd)} sub={totals.estimated ? 'Some prices estimated' : undefined} />
      </div>
      <div className="settings-group">
        <div className="group-head">
          <h3>Tokens by {effectiveBucket}</h3>
          <span className="project-spacer" />
          <Segmented label="Show as" value={view} onChange={setView} options={[{id: 'chart', label: 'Chart'}, {id: 'table', label: 'Table'}]} />
          <button className="btn btn-sm" onClick={() => void save()}><FolderOpen size={13} />Save report</button>
        </div>
        {loading && !report ? <Spinner label="Adding it up" /> : !(report?.buckets || []).length ? (
          <p className="muted">No model requests in this period.</p>
        ) : view === 'chart' ? <ColumnChart buckets={report!.buckets} /> : <UsageTable buckets={report!.buckets} />}
      </div>
    </section>
  );
}

function Stat({label, value, sub}: {label: string; value: string; sub?: string}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value num">{value}</strong>
      {sub && <span className="stat-sub faint">{sub}</span>}
    </div>
  );
}

/** A clean tick step (1, 2 or 5 times a power of ten) for about four intervals. */
function niceStep(max: number) {
  if (max <= 0) return 1;
  const raw = max / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

function ColumnChart({buckets}: {buckets: UsageReport['buckets']}) {
  const [active, setActive] = useState(-1);
  const values = buckets.map(b => b.totals.total_tokens || 0);
  const step = niceStep(Math.max(...values));
  const max = step * Math.max(1, Math.ceil(Math.max(...values) / step));
  const ticks = Array.from({length: Math.round(max / step) + 1}, (_, i) => i * step);
  const peak = values.indexOf(Math.max(...values));
  const every = Math.max(1, Math.ceil(buckets.length / 10));
  const hovered = buckets[active];
  return (
    <figure className="chart" aria-label="Tokens per period">
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {ticks.slice().reverse().map(t => <div key={t} className="chart-gridline"><span className="num">{formatCount(t)}</span></div>)}
        </div>
        <div className="chart-columns" onMouseLeave={() => setActive(-1)}>
          {buckets.map((bucket, i) => {
            const value = values[i];
            return (
              <div
                key={bucket.key}
                className={i === active ? 'chart-band active' : 'chart-band'}
                tabIndex={0}
                aria-label={`${bucket.key}: ${formatCount(value)} tokens`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(-1)}
              >
                <div className="chart-bar" style={{height: `${(value / max) * 100}%`}}>
                  {i === peak && value > 0 && <span className="chart-cap num">{formatCount(value)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {hovered && (
          <div className="chart-tip" style={{left: `${((active + 0.5) / buckets.length) * 100}%`}} role="status">
            <strong>{hovered.key}</strong>
            <span className="num">{formatCount(hovered.totals.total_tokens)} tokens</span>
            <span className="num faint">{formatCount(hovered.totals.requests)} requests, {formatCost(hovered.totals.cost_usd)}</span>
          </div>
        )}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {buckets.map((bucket, i) => <span key={bucket.key} className="num">{i % every === 0 ? shortKey(bucket.key) : ''}</span>)}
      </div>
    </figure>
  );
}

function shortKey(key: string) {
  const day = key.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (day) return `${Number(day[1])}/${Number(day[2])}`;
  const hour = key.match(/(\d{2}):00/);
  if (hour) return `${hour[1]}h`;
  return key.replace(/^\d{4}-/, '');
}

function UsageTable({buckets}: {buckets: UsageReport['buckets']}) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead><tr><th>Period</th><th className="num-col">Requests</th><th className="num-col">Tokens in</th><th className="num-col">Tokens out</th><th className="num-col">Cost</th></tr></thead>
        <tbody>
          {buckets.map(b => (
            <tr key={b.key}>
              <td className="num">{b.key}</td>
              <td className="num-col num">{(b.totals.requests || 0).toLocaleString()}</td>
              <td className="num-col num">{(b.totals.input_tokens || 0).toLocaleString()}</td>
              <td className="num-col num">{(b.totals.output_tokens || 0).toLocaleString()}</td>
              <td className="num-col num">{formatCost(b.totals.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
