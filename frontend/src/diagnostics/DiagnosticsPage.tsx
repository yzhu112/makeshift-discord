import type { User } from '@/api';
import { api } from '@/api';
import { AppHeader } from '@/components/AppHeader';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Globe,
  Headphones,
  LoaderCircle,
  Search,
  Server,
  Users,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import './diagnostics.css';
import { applySync, type SyncResponse } from './sync';
import type {
  AudioStats,
  Call,
  Details,
  DiagnosticEvent,
  Overview,
  Sample,
  ServerSample,
  Session,
} from './types';

function usePoll<T>(url: string | null) {
  const [result, setResult] = useState<{ url: string; data: T; at: number }>();
  const [failure, setFailure] = useState<{ url: string; message: string }>();
  useEffect(() => {
    if (!url) return;
    let stopped = false;
    let revision: string | undefined;
    let previous: T | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const tick = async () => {
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ sync: '1' });
        if (revision) query.set('revision', revision);
        const response = await api<SyncResponse<T>>(
          url + (url.includes('?') ? '&' : '?') + query,
          { signal: controller.signal },
        );
        const data = applySync(previous, response);
        previous = data;
        revision = response.revision;
        if (!stopped) {
          setResult({ url, data, at: Date.now() });
          setFailure(undefined);
        }
      } catch (error) {
        if (!stopped)
          setFailure({
            url,
            message:
              error instanceof Error
                ? error.message
                : 'Unable to load diagnostics',
          });
      } finally {
        if (!stopped) timer = setTimeout(tick, document.hidden ? 30000 : 5000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [url]);
  return {
    data: result?.url === url ? result.data : undefined,
    at: result?.url === url ? result.at : undefined,
    error: failure?.url === url ? failure.message : undefined,
  };
}
const time = (v: number | null | undefined) =>
  v
    ? new Date(v).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
const date = (v: number) =>
  new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' });
function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
const bytes = (v: number | undefined) =>
  v == null
    ? '—'
    : v >= 1024 ** 3
      ? `${(v / 1024 ** 3).toFixed(1)} GiB`
      : `${(v / 1024 ** 2).toFixed(1)} MiB`;
const metric = (v: number | null | undefined, unit = '') =>
  v == null || !Number.isFinite(v)
    ? '—'
    : `${v.toFixed(v >= 100 ? 0 : 1)}${unit}`;
const avg = (values: (number | null | undefined)[]) => {
  const numbers = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return numbers.length
    ? numbers.reduce((a, b) => a + b, 0) / numbers.length
    : null;
};
const sum = (values: (number | null | undefined)[]) => {
  const numbers = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
};
function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`diag-badge diag-${tone}`}>{children}</span>;
}
function State({ session, now }: { session: Session; now: number }) {
  const stale = !session.ended_at && now - session.last_seen_at > 45000;
  return (
    <Badge
      tone={
        stale
          ? 'warning'
          : session.status === 'connected'
            ? 'good'
            : session.status === 'failed'
              ? 'bad'
              : session.status === 'reconnecting'
                ? 'warning'
                : 'neutral'
      }
    >
      <span className="diag-dot" />
      {stale ? 'Not reporting' : session.status}
    </Badge>
  );
}
function KeyValues({ values }: { values: Details }) {
  return (
    <dl className="diag-kv">
      {Object.entries(values).map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')}</dt>
          <dd>
            {v === null || v === undefined
              ? 'Unavailable'
              : typeof v === 'boolean'
                ? v
                  ? 'Yes'
                  : 'No'
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Chart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string;
  points: { at: number; value: number | null | undefined }[];
}) {
  const available = points.filter(
    (p) => p.value != null && Number.isFinite(p.value),
  );
  const max = Math.max(1, ...available.map((p) => p.value!));
  const start = points[0]?.at ?? 0,
    end = points.at(-1)?.at ?? start + 1;
  const x = (at: number) => ((at - start) / Math.max(1, end - start)) * 600;
  const y = (value: number) => 80 - (value / max) * 65;
  // Gaps remain gaps: never draw a continuous line through absent telemetry.
  let path = '',
    drawing = false;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value)) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${x(point.at)},${y(point.value)} `;
    drawing = true;
  }
  return (
    <div className="diag-chart">
      <div className="diag-chart-head">
        <span>{title}</span>
        <strong>{metric(available.at(-1)?.value, unit)}</strong>
      </div>
      {available.length ? (
        <>
          <svg
            viewBox="0 0 600 90"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${title} over time; peak ${metric(max, unit)}`}
          >
            <path d="M0 80H600 M0 45H600 M0 10H600" className="diag-gridline" />
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
            {available.length === 1 && (
              <circle cx="0" cy={y(available[0].value!)} r="3" />
            )}
          </svg>
          <div className="diag-chart-axis">
            <span>{time(start)}</span>
            <span>
              peak {metric(Math.max(...available.map((p) => p.value!)), unit)}
            </span>
            <span>{time(end)}</span>
          </div>
        </>
      ) : (
        <div className="diag-chart-empty">No measurements available</div>
      )}
    </div>
  );
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="diag-empty">
      <Activity size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function DiagnosticsPage({ user }: { user: User }) {
  const overview = usePoll<Overview>('/api/diagnostics/overview');
  const [selected, setSelected] = useState<{
    kind: 'call' | 'attempt';
    id: string;
  } | null>(() => {
    const p = new URLSearchParams(location.search);
    return p.get('call')
      ? { kind: 'call', id: p.get('call')! }
      : p.get('attempt')
        ? { kind: 'attempt', id: p.get('attempt')! }
        : null;
  });
  const [search, setSearch] = useState('');
  const [older, setOlder] = useState<Call[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState('');
  const [noMore, setNoMore] = useState(false);
  const [section, setSection] = useState<'calls' | 'server'>('calls');
  const calls = useMemo(() => {
    const map = new Map<string, Call>();
    for (const c of [...older, ...(overview.data?.calls ?? [])])
      map.set(c.id, c);
    return [...map.values()].sort(
      (a, b) =>
        Number(b.ended_at === null) - Number(a.ended_at === null) ||
        b.started_at - a.started_at,
    );
  }, [older, overview.data?.calls]);
  const choose = (kind: 'call' | 'attempt', id: string) => {
    setSelected({ kind, id });
    setSection('calls');
    history.replaceState(
      null,
      '',
      `/diagnostics?${kind}=${encodeURIComponent(id)}`,
    );
  };
  const selection =
    selected ??
    (calls[0]
      ? { kind: 'call' as const, id: calls[0].id }
      : overview.data?.attempts[0]
        ? { kind: 'attempt' as const, id: overview.data.attempts[0].id }
        : null);
  const matches = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  const live = calls.filter((c) => !c.ended_at).length;
  async function more() {
    const before = Math.min(...calls.map((c) => c.started_at));
    setLoadingOlder(true);
    setOlderError('');
    try {
      const data = await api<Overview>(
        `/api/diagnostics/overview?before=${before}`,
      );
      setOlder((previous) => [...previous, ...data.calls]);
      setNoMore(data.calls.length < 50);
    } catch (error) {
      setOlderError(
        error instanceof Error ? error.message : 'Could not load older calls',
      );
    } finally {
      setLoadingOlder(false);
    }
  }
  return (
    <div className="diagnostics">
      <div className="diag-topbar">
        <AppHeader section="Diagnostics" username={user.username} brandHref="/" showLanguage={false} />
      </div>
      <div className="diag-layout">
        <aside className="diag-sidebar">
          <div className="diag-sidebar-title">WORKSPACE</div>
          <button
            className={`diag-nav ${section === 'calls' ? 'selected' : ''}`}
            onClick={() => setSection('calls')}
          >
            <Headphones size={15} />
            Calls<span>{live ? `${live} live` : calls.length}</span>
          </button>
          <button
            className={`diag-nav ${section === 'server' ? 'selected' : ''}`}
            onClick={() => setSection('server')}
          >
            <Server size={15} />
            Server health
            <span
              className={`diag-dot ${overview.data?.server && Date.now() - overview.data.server.sampled_at < 150000 ? 'diag-good' : 'diag-warning'}`}
            />
          </button>
          <div className="diag-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by channel…"
              aria-label="Filter calls by channel"
            />
          </div>
          <div className="diag-call-list">
            <div className="diag-sidebar-title">CALL SESSIONS</div>
            {calls
              .filter((c) => matches(c.room_name))
              .map((c) => (
                <button
                  key={c.id}
                  className={`diag-call-item ${section === 'calls' && selection?.id === c.id ? 'selected' : ''}`}
                  onClick={() => choose('call', c.id)}
                >
                  <div>
                    <strong>#{c.room_name}</strong>
                    {!c.ended_at && <span className="diag-live-dot" />}
                  </div>
                  <div>
                    <span>
                      {date(c.started_at)} · {time(c.started_at).slice(0, 5)}
                    </span>
                    <span>{c.participant_count} joined</span>
                  </div>
                </button>
              ))}
            {!calls.length && (
              <p className="diag-sidebar-note">
                Calls appear when the first participant connects.
              </p>
            )}
            {calls.length >= 50 && !noMore && (
              <button
                className="diag-load"
                onClick={more}
                disabled={loadingOlder}
              >
                {loadingOlder ? 'Loading…' : 'Load older calls'}
              </button>
            )}
            {olderError && <p className="diag-error-text">{olderError}</p>}
            {!!overview.data?.attempts.length && (
              <>
                <div className="diag-sidebar-title diag-spaced">
                  UNATTACHED JOIN ATTEMPTS
                </div>
                {overview.data.attempts
                  .filter((s) => matches(`${s.room_name} ${s.username}`))
                  .map((s) => (
                    <button
                      key={s.id}
                      className={`diag-call-item ${selection?.id === s.id ? 'selected' : ''}`}
                      onClick={() => choose('attempt', s.id)}
                    >
                      <div>
                        <strong>{s.username}</strong>
                        <span
                          className={s.status === 'failed' ? 'diag-bad' : ''}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div>
                        <span>#{s.room_name}</span>
                        <span>{time(s.attempted_at).slice(0, 5)}</span>
                      </div>
                    </button>
                  ))}
              </>
            )}
          </div>
          <div className="diag-storage">
            <div>
              <Database size={13} />
              <span>Diagnostics storage</span>
            </div>
            <strong>
              {bytes(overview.data?.storage.bytes)}{' '}
              <span>/ {bytes(overview.data?.storage.budget)}</span>
            </strong>
            <progress
              max={overview.data?.storage.budget ?? 1}
              value={overview.data?.storage.bytes ?? 0}
            />
            <p>No time expiry. Oldest data clears at capacity.</p>
          </div>
        </aside>
        <main className="diag-main">
          <div className="diag-page-title">
            <div>
              <div className="diag-eyebrow">OBSERVABILITY</div>
              <h1>
                {section === 'calls' ? 'Call diagnostics' : 'Server health'}
              </h1>
              <p>
                {section === 'calls'
                  ? 'Connection evidence, audio health, and the events behind each call.'
                  : 'Host resources, service reachability, and recent operational events.'}
              </p>
            </div>
            <div className="diag-refresh">
              <span
                className={`diag-dot ${overview.error ? 'diag-bad' : 'diag-good'}`}
              />
              {overview.error
                ? 'Updates interrupted'
                : overview.at
                  ? `Updated ${time(overview.at)}`
                  : 'Connecting…'}
              <small>Refreshes every 5 seconds</small>
            </div>
          </div>
          {overview.error && (
            <div className="diag-alert">
              {overview.error}. Displaying the last available data; retrying
              automatically.
            </div>
          )}
          {overview.data?.storage.lastPrunedAt && (
            <div className="diag-prune-note">
              Oldest details were pruned at{' '}
              {date(overview.data.storage.lastPrunedAt)}{' '}
              {time(overview.data.storage.lastPrunedAt)}. Some historical charts
              or events may be incomplete.
            </div>
          )}
          {section === 'server' ? (
            <ServerPanel current={overview.data?.server} />
          ) : selection ? (
            <CallPanel
              key={`${selection.kind}:${selection.id}`}
              selection={selection}
            />
          ) : overview.data ? (
            <Empty title="No calls yet">
              Join a channel to start a call. Connected calls and failed join
              attempts will appear here automatically.
            </Empty>
          ) : (
            <div className="diag-loading">
              <LoaderCircle className="animate-spin" size={18} />
              Loading diagnostics…
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function CallPanel({
  selection,
}: {
  selection: { kind: 'call' | 'attempt'; id: string };
}) {
  const call = usePoll<Call>(
    selection.kind === 'call' ? `/api/diagnostics/calls/${selection.id}` : null,
  );
  const attempt = usePoll<Session>(
    selection.kind === 'attempt'
      ? `/api/diagnostics/sessions/${selection.id}`
      : null,
  );
  const [participant, setParticipant] = useState<string | null>(null);
  const participantTrigger = useRef<HTMLButtonElement | null>(null);
  const [range, setRange] = useState('300000');
  const sessions = call.data?.sessions ?? (attempt.data ? [attempt.data] : []);
  const focused = sessions.find((s) => s.id === participant);
  const history = usePoll<Sample[]>(
    focused ? `/api/diagnostics/samples/${focused.id}?windowMs=${range}` : null,
  );
  const latest = history.data?.at(-1)?.data ?? focused?.latest?.data;
  const now = Date.now();
  const started = call.data?.started_at ?? attempt.data?.attempted_at;
  const ended = call.data?.ended_at ?? attempt.data?.ended_at;
  const error = call.error ?? attempt.error;
  if (!call.data && !attempt.data)
    return error ? (
      <div className="diag-alert">
        {error}. The record may have been removed during storage cleanup.
      </div>
    ) : (
      <div className="diag-loading">
        <LoaderCircle className="animate-spin" size={18} />
        Loading call…
      </div>
    );
  return (
    <>
      <section className="diag-call-heading">
        <div>
          <h2>#{call.data?.room_name ?? attempt.data?.room_name}</h2>
          {selection.kind === 'attempt' ? (
            <Badge tone="warning">Join attempt</Badge>
          ) : !call.data?.ended_at ? (
            <Badge tone="good">
              <span className="diag-dot" />
              Live
            </Badge>
          ) : (
            <Badge>Ended</Badge>
          )}
        </div>
        <span className="diag-id" title={selection.id}>
          {selection.id.slice(0, 8)}
        </span>
      </section>
      <div className="diag-summary">
        <div>
          <Clock3 size={15} />
          <span>
            Started
            <strong>
              {started ? `${date(started)} · ${time(started)}` : '—'}
            </strong>
          </span>
        </div>
        <div>
          <Activity size={15} />
          <span>
            Duration
            <strong>
              {started ? duration((ended ?? now) - started) : '—'}
            </strong>
          </span>
        </div>
        <div>
          <Users size={15} />
          <span>
            Participants
            <strong>
              {sessions.length}{' '}
              <small>
                · {sessions.filter((s) => !s.ended_at).length} active
              </small>
            </strong>
          </span>
        </div>
        <div>
          <Globe size={15} />
          <span>
            Ended<strong>{ended ? time(ended) : 'In progress'}</strong>
          </span>
        </div>
      </div>
      {error && (
        <div className="diag-alert">{error}. These values may be stale.</div>
      )}
      <div className="diag-section-heading">
        <h3>Participants</h3>
        <span>Select a participant to inspect their connection</span>
      </div>
      <div className="diag-table-wrap">
        <table className="diag-table">
          <thead>
            <tr>
              <th>Participant</th>
              <th>State</th>
              <th>Media path</th>
              <th>RTT</th>
              <th>Receive loss</th>
              <th>Quality</th>
              <th>Last report</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const data = s.latest?.data;
              return (
                <tr
                  key={s.id}
                  className={participant === s.id ? 'selected' : ''}
                  onClick={(e) => {
                    participantTrigger.current =
                      e.currentTarget.querySelector('button');
                    setParticipant(s.id);
                  }}
                >
                  <td>
                    <button
                      className="diag-person"
                      aria-haspopup="dialog"
                      aria-expanded={participant === s.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        participantTrigger.current = e.currentTarget;
                        setParticipant(s.id);
                      }}
                    >
                      <span>{s.username[0]?.toUpperCase()}</span>
                      <div>
                        <strong>{s.username}</strong>
                        <small>{s.id.slice(0, 8)}</small>
                      </div>
                    </button>
                  </td>
                  <td>
                    <State session={s} now={now} />
                  </td>
                  <td className="diag-mono">
                    {data?.transports
                      .map((t) => t.path)
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join(' / ') || 'Unknown'}
                  </td>
                  <td>
                    {metric(
                      avg(data?.transports.map((t) => t.rttMs) ?? []),
                      ' ms',
                    )}
                  </td>
                  <td>
                    {metric(
                      avg(data?.incomingAudio.map((t) => t.lossPercent) ?? []),
                      '%',
                    )}
                  </td>
                  <td>{data?.connectionQuality ?? '—'}</td>
                  <td className="diag-muted">
                    {s.ended_at
                      ? time(s.last_seen_at)
                      : `${duration(now - s.last_seen_at)} ago`}
                  </td>
                  <td>
                    <ChevronRight size={14} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Dialog.Root
        open={!!focused}
        onOpenChange={(open) => {
          if (!open) setParticipant(null);
        }}
      >
        {focused && (
          <Dialog.Portal>
            <Dialog.Overlay className="diag-sheet-overlay" />
            <Dialog.Content
              className="diagnostics diag-participant-sheet"
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                participantTrigger.current?.focus({ preventScroll: true });
              }}
            >
              <div className="diag-sheet-heading">
                <Dialog.Title>
                  {focused.username}
                  <span className="diag-muted"> / Connection detail</span>
                </Dialog.Title>
                <button
                  className="diag-icon-link"
                  aria-label="Close participant details"
                  onClick={() => setParticipant(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="diag-sheet-body">
                {focused.end_reason && (
                  <div className="diag-reason">
                    <span>End reason</span>
                    <code>{focused.end_reason}</code>
                  </div>
                )}
                <div className="diag-detail-tabs">
                  <span>Connection history</span>
                  <div>
                    {[
                      ['300000', '5 min'],
                      ['900000', '15 min'],
                      ['0', 'Full session'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setRange(value)}
                        className={range === value ? 'selected' : ''}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {history.error && (
                  <div className="diag-alert">{history.error}</div>
                )}
                <div className="diag-charts">
                  <Chart
                    title="Round-trip time"
                    unit=" ms"
                    points={(history.data ?? []).map((s) => ({
                      at: s.sampled_at,
                      value: avg(s.data.transports.map((t) => t.rttMs)),
                    }))}
                  />
                  <Chart
                    title="Receive packet loss"
                    unit="%"
                    points={(history.data ?? []).map((s) => ({
                      at: s.sampled_at,
                      value: avg(
                        s.data.incomingAudio.map((t) => t.lossPercent),
                      ),
                    }))}
                  />
                  <Chart
                    title="Receive jitter"
                    unit=" ms"
                    points={(history.data ?? []).map((s) => ({
                      at: s.sampled_at,
                      value: avg(s.data.incomingAudio.map((t) => t.jitterMs)),
                    }))}
                  />
                  <Chart
                    title="Send bitrate"
                    unit=" kb/s"
                    points={(history.data ?? []).map((s) => ({
                      at: s.sampled_at,
                      value: sum(
                        s.data.outgoingAudio.map((t) => t.bitrateKbps),
                      ),
                    }))}
                  />
                </div>
                <div className="diag-section-heading">
                  <h4>Selected media transports</h4>
                  <span>
                    {history.data?.at(-1)
                      ? `Measured ${time(history.data.at(-1)!.sampled_at)}`
                      : 'Not yet observed'}
                  </span>
                </div>
                <div className="diag-transports">
                  {latest?.transports.length ? (
                    latest.transports.map((t, i) => (
                      <div className="diag-transport" key={`${t.role}-${i}`}>
                        <div>
                          <Badge
                            tone={
                              t.path.startsWith('TURN') ? 'blue' : 'neutral'
                            }
                          >
                            {t.path}
                          </Badge>
                          <span>{t.role}</span>
                        </div>
                        <KeyValues
                          values={{
                            state: t.state,
                            iceState: t.iceState,
                            relay: t.relayUrl,
                            protocol: t.protocol,
                            relayProtocol: t.relayProtocol,
                            candidateType: t.candidateType,
                            roundTrip: metric(t.rttMs, ' ms'),
                          }}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="diag-explanation">
                      No selected transport was reported. This can happen before
                      media connects, after it closes, or when browser
                      statistics are unavailable.
                    </p>
                  )}
                </div>
                <p className="diag-explanation">
                  A candidate that was not selected is not necessarily a failed
                  attempt. The event timeline shows observed ICE errors and path
                  changes only.
                </p>
                <div className="diag-section-heading">
                  <h4>Audio paths</h4>
                  <span>Measured by {focused.username}’s browser</span>
                </div>
                <AudioTable
                  outgoing={latest?.outgoingAudio ?? []}
                  incoming={latest?.incomingAudio ?? []}
                />
                <div className="diag-two-column">
                  <details className="diag-disclosure" open>
                    <summary>
                      Microphone & playback
                      <ChevronDown size={14} />
                    </summary>
                    <KeyValues
                      values={
                        latest?.localAudio ?? { status: 'No measurements' }
                      }
                    />
                  </details>
                  <details className="diag-disclosure">
                    <summary>
                      Device & browser
                      <ChevronDown size={14} />
                    </summary>
                    <KeyValues
                      values={{
                        ...focused.client_info,
                        ...latest?.deviceState,
                      }}
                    />
                  </details>
                </div>
                <details className="diag-disclosure">
                  <summary>
                    Session identifiers
                    <ChevronDown size={14} />
                  </summary>
                  <KeyValues
                    values={{
                      attemptId: focused.id,
                      roomSid: focused.livekit_room_sid,
                      participantSid: focused.livekit_participant_sid,
                      connectedAt: time(focused.connected_at),
                    }}
                  />
                </details>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
      <EventTimeline
        callId={selection.kind === 'call' ? selection.id : undefined}
        sessionId={selection.kind === 'attempt' ? selection.id : undefined}
        sessions={sessions}
      />
    </>
  );
}
function AudioTable({
  outgoing,
  incoming,
}: {
  outgoing: AudioStats[];
  incoming: AudioStats[];
}) {
  return (
    <div className="diag-table-wrap">
      <table className="diag-table diag-audio-table">
        <thead>
          <tr>
            <th>Direction / source</th>
            <th>Codec</th>
            <th>Bitrate</th>
            <th>Loss</th>
            <th>Jitter</th>
            <th>Concealed audio</th>
            <th>Jitter buffer</th>
          </tr>
        </thead>
        <tbody>
          {[
            ...outgoing.map((t) => ({ ...t, direction: 'Sending' })),
            ...incoming.map((t) => ({ ...t, direction: 'Receiving' })),
          ].map((t, i) => (
            <tr key={`${t.trackId}-${i}`}>
              <td>
                <strong>{t.direction}</strong>
                <small>{t.participant ?? 'Sender unavailable'}</small>
              </td>
              <td>{t.codec ?? '—'}</td>
              <td>{metric(t.bitrateKbps, ' kb/s')}</td>
              <td>{metric(t.lossPercent, '%')}</td>
              <td>{metric(t.jitterMs, ' ms')}</td>
              <td>{metric(t.concealedPercent, '%')}</td>
              <td>{metric(t.jitterBufferMs, ' ms')}</td>
            </tr>
          ))}
          {!outgoing.length && !incoming.length && (
            <tr>
              <td colSpan={7} className="diag-muted">
                No audio statistics available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function EventTimeline({
  callId,
  sessionId,
  sessions = [],
  serverOnly = false,
}: {
  callId?: string;
  sessionId?: string;
  sessions?: Session[];
  serverOnly?: boolean;
}) {
  const [level, setLevel] = useState('');
  const [older, setOlder] = useState<DiagnosticEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const params = new URLSearchParams();
  if (callId) params.set('callId', callId);
  if (sessionId) params.set('sessionId', sessionId);
  if (level) params.set('level', level);
  if (serverOnly) params.set('serverOnly', 'true');
  const url = `/api/diagnostics/events?${params}`;
  const current = usePoll<DiagnosticEvent[]>(url);
  useEffect(() => {
    setOlder([]);
    setError('');
  }, [url]);
  const events = [
    ...new Map(
      [...older, ...(current.data ?? [])].map((e) => [e.id, e]),
    ).values(),
  ].sort((a, b) => b.id - a.id);
  async function more() {
    setBusy(true);
    try {
      const extra = await api<DiagnosticEvent[]>(
        `${url}&before=${events.at(-1)?.id ?? 0}`,
      );
      setOlder((previous) => [...previous, ...extra]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load older events');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="diag-events">
      <div className="diag-section-heading">
        <h3>
          Event timeline <span className="diag-count">{events.length}</span>
        </h3>
        <select
          aria-label="Filter event severity"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">All levels</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
        </select>
      </div>
      {(current.error || error) && (
        <div className="diag-alert">{current.error || error}</div>
      )}
      <div className="diag-event-list">
        {events.map((e) => (
          <details key={e.id} className={`diag-event diag-event-${e.level}`}>
            <summary>
              <span
                className="diag-event-time"
                title={`Received ${time(e.received_at)}`}
              >
                {time(e.occurred_at)}
              </span>
              <span
                className={`diag-event-marker diag-${e.level === 'error' ? 'bad' : e.level === 'warning' ? 'warning' : 'neutral'}`}
              >
                {e.level === 'error' ? (
                  <X size={11} />
                ) : e.level === 'warning' ? (
                  '!'
                ) : (
                  <Check size={10} />
                )}
              </span>
              <span className="diag-event-content">
                <strong>{e.message}</strong>
                <small>
                  {e.source} ·{' '}
                  {sessions.find((s) => s.id === e.participant_session_id)
                    ?.username ??
                    e.room_name ??
                    'Server'}{' '}
                  · {e.type}
                </small>
              </span>
              <ChevronDown size={13} />
            </summary>
            <div className="diag-event-body">
              <KeyValues
                values={{
                  ...e.details,
                  occurredAt: new Date(e.occurred_at).toISOString(),
                  receivedAt: new Date(e.received_at).toISOString(),
                }}
              />
            </div>
          </details>
        ))}
        {!events.length && (
          <p className="diag-no-events">
            {current.data ? 'No events match this view.' : 'Loading events…'}
          </p>
        )}
      </div>
      {events.length >= 150 && (
        <button className="diag-load" disabled={busy} onClick={more}>
          {busy ? 'Loading…' : 'Load earlier events'}
        </button>
      )}
    </section>
  );
}
function ServerPanel({
  current,
}: {
  current: ServerSample | null | undefined;
}) {
  const history = usePoll<ServerSample[]>('/api/diagnostics/server');
  const data = current?.data;
  return (
    <>
      <div className="diag-summary diag-server-summary">
        <div>
          <Server size={16} />
          <span>
            Host memory
            <strong>
              {bytes(data?.memoryUsedBytes)}
              <small> / {bytes(data?.memoryTotalBytes)}</small>
            </strong>
          </span>
        </div>
        <div>
          <Activity size={16} />
          <span>
            Backend memory<strong>{bytes(data?.processMemoryBytes)}</strong>
          </span>
        </div>
        <div>
          <Database size={16} />
          <span>
            Free disk<strong>{bytes(data?.diskFreeBytes)}</strong>
          </span>
        </div>
        <div>
          <Clock3 size={16} />
          <span>
            Host uptime
            <strong>{data ? duration(data.uptimeSeconds * 1000) : '—'}</strong>
          </span>
        </div>
      </div>
      {history.error && <div className="diag-alert">{history.error}</div>}
      <div className="diag-charts">
        <Chart
          title="Host CPU"
          unit="%"
          points={(history.data ?? []).map((s) => ({
            at: s.sampled_at,
            value: s.data.cpuPercent,
          }))}
        />
        <Chart
          title="Host memory used"
          unit="%"
          points={(history.data ?? []).map((s) => ({
            at: s.sampled_at,
            value: s.data.memoryTotalBytes
              ? (s.data.memoryUsedBytes / s.data.memoryTotalBytes) * 100
              : null,
          }))}
        />
      </div>
      <div className="diag-section-heading">
        <h3>Services</h3>
        <span>Sampled every 10 seconds</span>
      </div>
      <div className="diag-service-grid">
        {Object.entries(data?.services ?? {}).map(([name, s]) => (
          <div className="diag-service" key={name}>
            <div>
              <strong>{name}</strong>
              <Badge
                tone={
                  s.status === 'running'
                    ? 'good'
                    : s.status === 'not_configured'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {s.status.replaceAll('_', ' ')}
              </Badge>
            </div>
            <KeyValues
              values={{
                restarts: s.restartCount,
                certificateExpires: s.certificateExpiresAt
                  ? new Date(s.certificateExpiresAt).toLocaleDateString()
                  : undefined,
                ...(s.error ? { error: s.error } : {}),
              }}
            />
          </div>
        ))}
      </div>
      <p className="diag-explanation">
        {data?.collectorLastSeenAt
          ? `Service log collector last reported ${duration(Date.now() - data.collectorLastSeenAt)} ago.`
          : 'Service log collector has not reported. Local development still records backend health and client telemetry.'}{' '}
        Host memory includes operating-system caches.
      </p>
      <EventTimeline serverOnly />
    </>
  );
}
