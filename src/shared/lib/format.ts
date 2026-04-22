const MISSING = '—';

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function formatPrice(price: number | null | undefined): string {
  if (!isNum(price)) return MISSING;
  return price.toFixed(2);
}

export function formatPercent(pct: number | null | undefined): string {
  if (!isNum(pct)) return MISSING;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatVolume(vol: number | null | undefined): string {
  if (!isNum(vol)) return MISSING;
  if (vol >= 1e8) return (vol / 1e8).toFixed(2) + ' 亿股';
  if (vol >= 1e4) return (vol / 1e4).toFixed(0) + ' 万股';
  return vol.toLocaleString() + ' 股';
}

export function formatAmount(amount: number | null | undefined): string {
  if (!isNum(amount)) return MISSING;
  if (amount >= 1e12) return (amount / 1e12).toFixed(2) + ' 万亿';
  if (amount >= 1e8) return (amount / 1e8).toFixed(2) + ' 亿';
  if (amount >= 1e4) return (amount / 1e4).toFixed(0) + ' 万';
  return amount.toLocaleString();
}
