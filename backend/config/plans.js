// Single source of truth for what each purchasable plan grants.
// Only one product exists (full bot trading, all pairs) — the two plans
// differ only in price and duration.
const PLANS = {
  monthly: { product: 'bot', hours: 30 * 24, maxPairs: null, label: 'Monthly — 30 days, full access' },
  daily:   { product: 'bot', hours: 24,       maxPairs: null, label: 'Daily — 24 hours, full access' },
};

function isValidPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLANS, plan);
}

module.exports = { PLANS, isValidPlan };
