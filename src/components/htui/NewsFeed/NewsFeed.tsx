import { formatPercent } from '@/shared/lib/format';
import type { NewsFeedData, NewsFeedItem } from '@/shared/types/artifact';

import './NewsFeed.css';

interface Props {
  data: NewsFeedData;
}

const SENTIMENT_CONFIG = {
  bullish: { color: 'var(--color-success)', label: '利好', dot: '#10b981' },
  bearish: { color: 'var(--color-danger)', label: '利空', dot: '#ef4444' },
  neutral: { color: 'var(--text-muted)', label: '中性', dot: '#71717a' },
};

function formatTime(raw: string): string {
  // Extract HH:MM if time is like "2026-04-19 09:30:00"
  const match = raw.match(/(\d{2}:\d{2})/);
  if (match) return match[1];
  return raw.slice(-5);
}

function NewsFeedItemRow({
  item,
  isLast,
}: {
  item: NewsFeedItem;
  isLast: boolean;
}) {
  const cfg = SENTIMENT_CONFIG[item.sentiment];
  return (
    <div className={`nf-item ${isLast ? 'last' : ''}`}>
      {/* Timeline left */}
      <div className="nf-timeline">
        <div className="nf-dot" style={{ background: cfg.dot }} />
        {!isLast && <div className="nf-line" />}
      </div>

      {/* Content right */}
      <div className="nf-content">
        <div className="nf-meta">
          <span className="nf-time">{formatTime(item.publishTime)}</span>
          <span className="nf-sentiment-badge" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
        </div>
        <h4 className="nf-title">{item.title}</h4>
        {item.summary && <p className="nf-summary">{item.summary}</p>}
        <div className="nf-footer">
          {item.tags.length > 0 && (
            <div className="nf-tags">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="nf-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {item.relatedTickers && item.relatedTickers.length > 0 && (
            <div className="nf-tickers">
              {item.relatedTickers.slice(0, 3).map((t) => (
                <span
                  key={t.ticker}
                  className={`nf-ticker ${t.chgPct >= 0 ? 'up' : 'down'}`}
                >
                  {t.ticker} {formatPercent(t.chgPct)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewsFeed({ data }: Props) {
  if (!data.items || data.items.length === 0) return null;

  return (
    <div className="nf-card">
      <div className="nf-header">
        <span className="nf-header-title">市场资讯</span>
        <span className="nf-header-count">{data.total} 条</span>
      </div>
      <div className="nf-list">
        {data.items.map((item, i) => (
          <NewsFeedItemRow
            key={item.id}
            item={item}
            isLast={i === data.items.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

export default NewsFeed;
