import { formatAmount, formatPercent, formatPrice } from '@/shared/lib/format';
import type { StockSnapshotData } from '@/shared/types/artifact';

import './StockSnapshot.css';

interface Props {
  data: StockSnapshotData;
}

// Build a smooth SVG polyline path from normalized data points
function buildSparklinePath(values: number[], w: number, h: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h * 0.85) - h * 0.05;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return 'M ' + pts.join(' L ');
}

const RATING_COLOR: Record<string, string> = {
  强烈推荐: 'var(--color-success)',
  推荐: '#34d399',
  中性: 'var(--text-muted)',
  回避: 'var(--color-danger)',
};

function formatTurnoverRate(v: number): string {
  return v.toFixed(2) + '%';
}

function StockSnapshot({ data }: Props) {
  const isUp = data.chgPct >= 0;
  const trend = isUp ? 'up' : 'down';
  const arrow = isUp ? '▲' : '▼';
  const sparkColor = isUp ? 'var(--color-success)' : 'var(--color-danger)';

  const sparkW = 96;
  const sparkH = 40;
  const sparkline = data.sparkline ?? [];
  const sparkPath = buildSparklinePath(sparkline, sparkW, sparkH);

  return (
    <div className="ss-card">
      {/* Top: name + code */}
      <div className="ss-header">
        <div className="ss-name-group">
          <span className="ss-name">{data.name}</span>
          <span className="ss-code-badge">{data.code}</span>
        </div>
        <span className="ss-mkt">{data.mkt}</span>
      </div>

      {/* Price + sparkline */}
      <div className="ss-price-row">
        <div className="ss-price-group">
          <div className="ss-price-line">
            <span className={`ss-price ${trend}`}>
              {formatPrice(data.price)}
            </span>
            <span className="ss-currency">{data.currency}</span>
          </div>
          <div className={`ss-change ${trend}`}>
            <span className="ss-arrow">{arrow}</span>
            <span>
              {isUp ? '+' : ''}
              {formatPrice(data.chgVal)}
            </span>
            <span>({formatPercent(data.chgPct)})</span>
          </div>
        </div>
        {sparkline.length >= 2 && (
          <svg
            className="ss-sparkline"
            viewBox={`0 0 ${sparkW} ${sparkH}`}
            width={sparkW}
            height={sparkH}
            aria-hidden="true"
          >
            <path
              d={sparkPath}
              fill="none"
              stroke={sparkColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      <div className="ss-divider" />

      {/* 3-column metrics grid */}
      <div className="ss-metrics-grid">
        {/* Col 1: basic OHLC */}
        <div className="ss-metric-col">
          <div className="ss-metric">
            <span className="ss-metric-label">开盘</span>
            <span className="ss-metric-value">{formatPrice(data.open)}</span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">最高</span>
            <span
              className={`ss-metric-value ${data.high >= data.prevClose ? 'up' : 'down'}`}
            >
              {formatPrice(data.high)}
            </span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">最低</span>
            <span
              className={`ss-metric-value ${data.low >= data.prevClose ? 'up' : 'down'}`}
            >
              {formatPrice(data.low)}
            </span>
          </div>
        </div>

        {/* Col 2: market info */}
        <div className="ss-metric-col">
          <div className="ss-metric">
            <span className="ss-metric-label">市值</span>
            <span className="ss-metric-value">{formatAmount(data.mktCap)}</span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">换手率</span>
            <span className="ss-metric-value">
              {formatTurnoverRate(data.turnoverRate)}
            </span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">成交额</span>
            <span className="ss-metric-value">
              {formatAmount(data.turnover)}
            </span>
          </div>
        </div>

        {/* Col 3: valuation */}
        <div className="ss-metric-col">
          <div className="ss-metric">
            <span className="ss-metric-label">PE (TTM)</span>
            <span className="ss-metric-value">
              {data.pe > 0 ? data.pe.toFixed(1) : '—'}
            </span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">PB</span>
            <span className="ss-metric-value">
              {data.pb > 0 ? data.pb.toFixed(2) : '—'}
            </span>
          </div>
          <div className="ss-metric">
            <span className="ss-metric-label">ROE</span>
            <span className="ss-metric-value">
              {data.roe !== undefined && data.roe > 0
                ? data.roe.toFixed(1) + '%'
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Analyst rating */}
      {(data.analystRating || data.targetPrice != null) && (
        <div className="ss-analyst-row">
          {data.analystRating && (
            <span
              className="ss-rating-pill"
              style={{
                color:
                  RATING_COLOR[data.analystRating] ?? 'var(--text-secondary)',
                borderColor:
                  RATING_COLOR[data.analystRating] ?? 'var(--border)',
              }}
            >
              {data.analystRating}
            </span>
          )}
          {data.targetPrice != null && (
            <span className="ss-target">
              目标价 <strong>{formatPrice(data.targetPrice)}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default StockSnapshot;
