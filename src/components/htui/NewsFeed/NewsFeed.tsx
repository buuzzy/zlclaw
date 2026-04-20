import { formatPercent } from '@/shared/lib/format';
import type { NewsFeedData, NewsFeedItem, NewsFeedSentimentSummary } from '@/shared/types/artifact';

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
  // Full ISO / "YYYY-MM-DD HH:MM" → keep as-is
  const fullMatch = raw.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (fullMatch) return `${fullMatch[1]} ${fullMatch[2]}`;
  // Time-only "HH:MM" → prepend today's date so the user always sees a date
  const timeOnly = raw.match(/^(\d{2}:\d{2})/);
  if (timeOnly) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${today} ${timeOnly[1]}`;
  }
  return raw;
}

function SentimentBar({ summary }: { summary: NewsFeedSentimentSummary }) {
  const total = summary.bullish + summary.bearish + summary.neutral || 1;
  const bullPct = (summary.bullish / total) * 100;
  const bearPct = (summary.bearish / total) * 100;
  const neutPct = (summary.neutral / total) * 100;

  const overallCfg = SENTIMENT_CONFIG[summary.overall];

  return (
    <div className="nf-sentiment-summary">
      <div className="nf-ss-top">
        <span className="nf-ss-overall" style={{ color: overallCfg.color }}>
          {overallCfg.label}偏多
        </span>
        <div className="nf-ss-counts">
          <span style={{ color: SENTIMENT_CONFIG.bullish.dot }}>{summary.bullish} 利好</span>
          <span style={{ color: SENTIMENT_CONFIG.neutral.dot }}>{summary.neutral} 中性</span>
          <span style={{ color: SENTIMENT_CONFIG.bearish.dot }}>{summary.bearish} 利空</span>
        </div>
      </div>
      <div className="nf-ss-bar">
        {bullPct > 0 && (
          <div className="nf-ss-seg bullish" style={{ width: `${bullPct}%` }} />
        )}
        {neutPct > 0 && (
          <div className="nf-ss-seg neutral" style={{ width: `${neutPct}%` }} />
        )}
        {bearPct > 0 && (
          <div className="nf-ss-seg bearish" style={{ width: `${bearPct}%` }} />
        )}
      </div>
      {summary.summary && (
        <p className="nf-ss-text">{summary.summary}</p>
      )}
    </div>
  );
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

  // Sort items by publishTime descending (newest first)
  const sorted = [...data.items].sort((a, b) =>
    b.publishTime.localeCompare(a.publishTime)
  );

  return (
    <div className="nf-card">
      <div className="nf-header">
        <span className="nf-header-title">市场资讯</span>
        <span className="nf-header-count">{data.total} 条</span>
      </div>

      {data.sentimentSummary && (
        <SentimentBar summary={data.sentimentSummary} />
      )}

      <div className="nf-list">
        {sorted.map((item, i) => (
          <NewsFeedItemRow
            key={item.id}
            item={item}
            isLast={i === sorted.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

export default NewsFeed;
