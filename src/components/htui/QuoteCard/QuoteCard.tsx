import type { QuoteCardData } from "@/shared/types/artifact";
import {
  formatPrice,
  formatPercent,
  formatVolume,
  formatAmount,
} from "@/shared/lib/format";
import "./QuoteCard.css";

interface QuoteCardProps {
  data: QuoteCardData;
}

function QuoteCard({ data }: QuoteCardProps) {
  const isUp = data.chgPct >= 0;
  const trend = isUp ? "up" : "down";
  const arrow = isUp ? "▲" : "▼";

  return (
    <div className="quote-card">
      <div className="quote-header">
        <span className="quote-code">{data.code}</span>
        <span className="quote-sep">·</span>
        <span className="quote-name">{data.name}</span>
      </div>

      <div className="quote-main">
        <div className="quote-price-row">
          <span className={`quote-price ${trend}`}>
            {formatPrice(data.price)}
          </span>
          <span className="quote-currency">{data.currency}</span>
        </div>
        <div className={`quote-change ${trend}`}>
          <span>{isUp ? "+" : ""}{formatPrice(data.chgVal)}</span>
          <span>({formatPercent(data.chgPct)})</span>
          <span className="quote-arrow">{arrow}</span>
        </div>
      </div>

      <div className="quote-divider" />

      <div className="quote-grid">
        <div className="quote-cell">
          <span className="cell-label">开盘</span>
          <span className="cell-value">{formatPrice(data.open)}</span>
        </div>
        <div className="quote-cell">
          <span className="cell-label">昨收</span>
          <span className="cell-value">{formatPrice(data.prevClose)}</span>
        </div>
        <div className="quote-cell">
          <span className="cell-label">最高</span>
          <span className={`cell-value ${data.high >= data.prevClose ? "up" : "down"}`}>
            {formatPrice(data.high)}
          </span>
        </div>
        <div className="quote-cell">
          <span className="cell-label">最低</span>
          <span className={`cell-value ${data.low >= data.prevClose ? "up" : "down"}`}>
            {formatPrice(data.low)}
          </span>
        </div>
        <div className="quote-cell">
          <span className="cell-label">成交量</span>
          <span className="cell-value">{formatVolume(data.vol)}</span>
        </div>
        <div className="quote-cell">
          <span className="cell-label">市值</span>
          <span className="cell-value">{formatAmount(data.mktCap)}</span>
        </div>
      </div>
    </div>
  );
}

export default QuoteCard;
