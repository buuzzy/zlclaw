import { formatPrice } from '@/shared/lib/format';
import type { ResearchConsensusData } from '@/shared/types/artifact';

import './ResearchConsensus.css';

interface Props {
  data: ResearchConsensusData;
}

// Normalize English enum values → Chinese display strings
function normalizeRating(rating: string): string {
  const map: Record<string, string> = {
    buy: '买入',
    'strong buy': '强烈买入',
    outperform: '增持',
    overweight: '增持',
    hold: '中性',
    neutral: '中性',
    underperform: '减持',
    underweight: '减持',
    sell: '卖出',
  };
  return map[rating.toLowerCase()] ?? rating;
}

const RATING_COLORS: Record<string, string> = {
  买入: 'var(--color-success)',
  强烈买入: 'var(--color-success)',
  增持: '#34d399',
  中性: 'var(--text-muted)',
  观望: 'var(--text-muted)',
  减持: '#f87171',
  卖出: 'var(--color-danger)',
};

function getRatingGroup(rating: string): 'buy' | 'hold' | 'sell' {
  const normalized = normalizeRating(rating);
  if (['买入', '强烈买入', '增持'].includes(normalized)) return 'buy';
  if (['减持', '卖出'].includes(normalized)) return 'sell';
  return 'hold';
}

function ResearchConsensus({ data }: Props) {
  const allItems = data.items ?? [];
  const items = allItems.slice(0, 5);

  // Compute counts from ALL items (not just the displayed 5) if not provided
  const buyCount =
    data.buyCount ??
    allItems.filter((i) => getRatingGroup(i.rating) === 'buy').length;
  const holdCount =
    data.holdCount ??
    allItems.filter((i) => getRatingGroup(i.rating) === 'hold').length;
  const sellCount =
    data.sellCount ??
    allItems.filter((i) => getRatingGroup(i.rating) === 'sell').length;
  const total = buyCount + holdCount + sellCount || 1;

  // Compute target price range from ALL items if not provided
  const itemsWithTarget = allItems.filter((i) => i.targetPrice != null);
  const targets = itemsWithTarget.map((i) => i.targetPrice as number);
  const highTarget =
    data.highTarget ?? (targets.length > 0 ? Math.max(...targets) : null);
  const lowTarget =
    data.lowTarget ?? (targets.length > 0 ? Math.min(...targets) : null);
  const avgTarget =
    data.avgTarget ??
    (targets.length > 0
      ? targets.reduce((a, b) => a + b, 0) / targets.length
      : null);

  // Current price position in the target range (0-1)
  let pricePosition = 0.5;
  if (lowTarget != null && highTarget != null && highTarget > lowTarget) {
    pricePosition = Math.min(
      1,
      Math.max(0, (data.currentPrice - lowTarget) / (highTarget - lowTarget))
    );
  }

  return (
    <div className="rc-card">
      {/* Header */}
      <div className="rc-header">
        <div className="rc-title-row">
          <span className="rc-name">{data.name}</span>
          <span className="rc-code">{data.code}</span>
        </div>
        <div className="rc-price">
          {formatPrice(data.currentPrice)}
          <span className="rc-price-label">当前价</span>
        </div>
      </div>

      {/* Rating distribution bar */}
      <div className="rc-section">
        <div className="rc-section-label">分析师评级</div>
        <div className="rc-rating-bar">
          {buyCount > 0 && (
            <div
              className="rc-bar-seg buy"
              style={{ flex: buyCount }}
              title={`买入 ${buyCount}`}
            />
          )}
          {holdCount > 0 && (
            <div
              className="rc-bar-seg hold"
              style={{ flex: holdCount }}
              title={`中性 ${holdCount}`}
            />
          )}
          {sellCount > 0 && (
            <div
              className="rc-bar-seg sell"
              style={{ flex: sellCount }}
              title={`卖出 ${sellCount}`}
            />
          )}
        </div>
        <div className="rc-rating-counts">
          <span className="rc-count buy">{buyCount} 买入</span>
          <span className="rc-count hold">{holdCount} 中性</span>
          <span className="rc-count sell">{sellCount} 卖出</span>
          <span className="rc-count-total">{total} 家机构</span>
        </div>
      </div>

      {/* Target price range */}
      {lowTarget != null && highTarget != null && (
        <div className="rc-section">
          <div className="rc-section-label">目标价区间</div>
          <div className="rc-target-track-wrap">
            <span className="rc-target-low">{formatPrice(lowTarget)}</span>
            <div className="rc-target-track">
              <div
                className="rc-target-marker"
                style={{ left: `${pricePosition * 100}%` }}
                title={`当前价 ${formatPrice(data.currentPrice)}`}
              />
              {avgTarget != null && (
                <div
                  className="rc-avg-marker"
                  style={{
                    left: `${
                      Math.min(
                        1,
                        Math.max(
                          0,
                          (avgTarget - lowTarget) / (highTarget - lowTarget)
                        )
                      ) * 100
                    }%`,
                  }}
                  title={`均值目标价 ${formatPrice(avgTarget)}`}
                />
              )}
            </div>
            <span className="rc-target-high">{formatPrice(highTarget)}</span>
          </div>
          {avgTarget != null && (
            <div className="rc-avg-label">
              均值目标价 <strong>{formatPrice(avgTarget)}</strong>
              {data.currentPrice > 0 && (
                <span
                  className={
                    avgTarget > data.currentPrice
                      ? 'upside positive'
                      : 'upside negative'
                  }
                >
                  {avgTarget > data.currentPrice ? '+' : ''}
                  {(
                    ((avgTarget - data.currentPrice) / data.currentPrice) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Research items list */}
      {items.length > 0 && (
        <div className="rc-section">
          <div className="rc-section-label">近期研报</div>
          <div className="rc-list">
            {items.map((item, i) => (
              <div key={i} className="rc-item">
                <div className="rc-item-left">
                  <span className="rc-institution">{item.institution}</span>
                  {item.title && (
                    <span className="rc-report-title">{item.title}</span>
                  )}
                </div>
                <div className="rc-item-right">
                  <span
                    className="rc-rating-badge"
                    style={{
                      color:
                        RATING_COLORS[normalizeRating(item.rating)] ?? 'var(--text-secondary)',
                    }}
                  >
                    {normalizeRating(item.rating)}
                  </span>
                  {item.targetPrice != null && (
                    <span className="rc-target-price">
                      {formatPrice(item.targetPrice)}
                    </span>
                  )}
                  <span className="rc-date">{item.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ResearchConsensus;
