import React, { useState, useEffect, useMemo, useRef } from 'react';

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR'];

// Trade-related lines get a highlight so executions are easy to spot in the stream
function isTradeLine(message) {
  return /order placed|trade|reconciled|safety-closed|unprotected/i.test(message);
}

export default function Logs({ liveLogs }) {
  const [history, setHistory] = useState([]);
  const [level, setLevel]     = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch('/api/logs?limit=500', { credentials: 'include' }).then(r => r.json()).then(setHistory).catch(() => {});
  }, []);

  // Merge initial history with anything that's arrived live since,
  // de-duplicating by time+message in case of overlap on load.
  const merged = useMemo(() => {
    const all = [...history, ...liveLogs];
    const seen = new Set();
    const out = [];
    for (const entry of all) {
      const key = entry.time + entry.message;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
    return out;
  }, [history, liveLogs]);

  const filtered = useMemo(() => {
    if (level === 'ALL') return merged;
    return merged.filter(e => e.level === level);
  }, [merged, level]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [filtered, autoScroll]);

  return (
    <div className="page">
      <div className="page-hdr">
        <h2>Logs</h2>
        <div className="pills">
          {LEVELS.map(l => (
            <button key={l} className={`pill ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>{l}</button>
          ))}
          <button
            className={`pill ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(s => !s)}
            title="Automatically scroll to newest log line"
          >
            Auto-scroll
          </button>
        </div>
      </div>

      <div className="logs-panel">
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#8892a4' }}>No logs yet</div>
        )}
        {filtered.map((entry, i) => (
          <div
            key={i}
            className={`log-line log-${entry.level?.toLowerCase()} ${isTradeLine(entry.message) ? 'log-trade' : ''}`}
          >
            <span className="log-time">{new Date(entry.time).toLocaleTimeString()}</span>
            <span className={`log-level lvl-${entry.level?.toLowerCase()}`}>{entry.level}</span>
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <style>{`
        .logs-panel {
          background: #11141a;
          border: 1px solid #232732;
          border-radius: 10px;
          padding: 14px 16px;
          max-height: 70vh;
          overflow-y: auto;
          font-family: 'SF Mono', Consolas, Menlo, monospace;
          font-size: 12.5px;
          line-height: 1.7;
        }
        .log-line {
          display: flex;
          gap: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .log-line.log-trade { background: rgba(56, 161, 105, 0.08); }
        .log-time { color: #5b6577; flex-shrink: 0; }
        .log-level { flex-shrink: 0; font-weight: 600; width: 46px; }
        .lvl-info  { color: #4d9fff; }
        .lvl-warn  { color: #e8a13b; }
        .lvl-error { color: #ef5266; }
        .lvl-debug { color: #8892a4; }
        .log-msg   { color: #d7dae0; }
      `}</style>
    </div>
  );
}
