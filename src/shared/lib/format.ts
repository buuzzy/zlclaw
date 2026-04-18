export function formatPrice(price: number): string {
  return price.toFixed(2);
}

export function formatPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1e8) return (vol / 1e8).toFixed(2) + " 亿股";
  if (vol >= 1e4) return (vol / 1e4).toFixed(0) + " 万股";
  return vol.toLocaleString() + " 股";
}

export function formatAmount(amount: number): string {
  if (amount >= 1e12) return (amount / 1e12).toFixed(2) + " 万亿";
  if (amount >= 1e8) return (amount / 1e8).toFixed(2) + " 亿";
  if (amount >= 1e4) return (amount / 1e4).toFixed(0) + " 万";
  return amount.toLocaleString();
}
