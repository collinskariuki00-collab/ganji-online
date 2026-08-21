const fs   = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '../../config/settings.json');

const DEFAULTS = {
  pairs:               ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT'],
  watchPairs: [
    'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','OPUSDT','ARBUSDT','WIFUSDT',
    'SUIUSDT','1000PEPEUSDT','1000SHIBUSDT','1000BONKUSDT','JUPUSDT','TIAUSDT','INJUSDT','NEARUSDT','APTUSDT','STXUSDT',
    'FETUSDT','RENDERUSDT','WLDUSDT','ENAUSDT','EIGENUSDT','PYTHUSDT','NOTUSDT','POLUSDT','LTCUSDT','ATOMUSDT','FILUSDT',
    'SANDUSDT','MANAUSDT','AAVEUSDT','UNIUSDT','MKRUSDT','CRVUSDT',
    'TRXUSDT','ETCUSDT','XLMUSDT','HBARUSDT','VETUSDT','ALGOUSDT','DOTUSDT','GRTUSDT','CHZUSDT','DYDXUSDT','GALAUSDT',
    'THETAUSDT','ENSUSDT','IMXUSDT','GMTUSDT','APEUSDT','WOOUSDT','JASMYUSDT','STGUSDT','BCHUSDT','COMPUSDT','SUSHIUSDT',
    'EGLDUSDT','KSMUSDT','AXSUSDT','ENJUSDT','1INCHUSDT','ANKRUSDT','ROSEUSDT','FLOWUSDT','API3USDT','SNXUSDT','ZILUSDT',
  ],
  minProbability:      65,
  takeProfitPct:       3.0,
  stopLossPct:         1.5,
  leverage:            10,
  marginMode:          'CROSSED',
  maxOpenTrades:       5,
  maxTradesPerDay:     10,
  scanIntervalSeconds: 60,
  tradeMode:           'fixed',
  tradeAmountUsd:      100,
  tradeAmountPct:      5,
  allowLong:           true,
  allowShort:          false,
  trailingStopLoss:    false,
  compoundProfits:     true,
  autoReduceLeverage:  true,
  useAnthropicAnalysis:      true,
  anthropicBlocksLowQuality: true,
  dailyLossLimitPct:   5,
  maxDrawdownPct:      15,
  pauseOnDailyLimit:   true,
};

class BotSettings {
  // filePath: optional per-user override (e.g. config/users/<id>/settings.json).
  // Defaults to the original global path for single-tenant/local-dev use.
  constructor(filePath = DEFAULT_FILE) {
    this.file = filePath;
    this.data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file))
        this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch { this.data = { ...DEFAULTS }; }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { console.error('Settings save:', e.message); }
  }

  get(k)     { return this.data[k]; }
  getAll()   { return { ...this.data }; }
  update(o)  { this.data = { ...this.data, ...o }; this._save(); return this.data; }
  reset()    { this.data = { ...DEFAULTS }; this._save(); return this.data; }
}

module.exports = { BotSettings };
