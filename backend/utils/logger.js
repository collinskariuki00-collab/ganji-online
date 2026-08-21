const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

const logFile = path.join(LOG_DIR, `waki7_${new Date().toISOString().slice(0, 10)}.log`);

// Keep recent log lines in memory so the API/dashboard can show them
// without reading log files off disk on every request.
const MAX_BUFFER = 500;
const buffer = [];
let listeners = []; // optional subscribers for live streaming (e.g. WS broadcast)

const write = (level, ...args) => {
  const msg   = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const entry = { time: new Date().toISOString(), level, message: msg };
  const line  = `[${entry.time}] [${level}] ${msg}`;

  console.log(line);
  try { fs.appendFileSync(logFile, line + '\n'); } catch {}

  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  for (const fn of listeners) {
    try { fn(entry); } catch {}
  }
};

const logger = {
  info:  (...a) => write('INFO',  ...a),
  warn:  (...a) => write('WARN',  ...a),
  error: (...a) => write('ERROR', ...a),
  debug: (...a) => write('DEBUG', ...a),
  getRecent: (limit = 200) => buffer.slice(-limit),
  onLog: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn); }; },
};

module.exports = { logger };
