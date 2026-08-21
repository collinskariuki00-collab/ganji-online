const fs   = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '../../config/trades.json');

class TradeStore {
  // filePath: optional per-user override (e.g. config/users/<id>/trades.json).
  constructor(filePath = DEFAULT_FILE) {
    this.file = filePath;
    this.trades = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file))
        this.trades = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch { this.trades = []; }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.trades, null, 2));
    } catch (e) { console.error('Trade save:', e.message); }
  }

  add(trade)  { this.trades.push({ ...trade, id: `t_${Date.now()}` }); this._save(); }

  close(orderId, closePrice, pnl) {
    const t = this.trades.find(x => x.orderId === orderId);
    if (t) { Object.assign(t, { status: 'CLOSED', closePrice, pnl, closedAt: Date.now() }); this._save(); }
    return t;
  }

  getOpen()   { return this.trades.filter(t => t.status === 'OPEN'); }
  getClosed() { return this.trades.filter(t => t.status === 'CLOSED'); }
  getAll()    { return [...this.trades]; }

  getStats() {
    const closed   = this.getClosed();
    const wins     = closed.filter(t => (t.pnl || 0) > 0);
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    return {
      total:    this.trades.length,
      open:     this.getOpen().length,
      closed:   closed.length,
      wins:     wins.length,
      losses:   closed.length - wins.length,
      winRate:  closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      totalPnl: +totalPnl.toFixed(2),
    };
  }
}

module.exports = { TradeStore };
