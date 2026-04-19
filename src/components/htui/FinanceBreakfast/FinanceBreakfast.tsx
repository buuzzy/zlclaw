import type { FinanceBreakfastData } from '@/shared/types/artifact';

import './FinanceBreakfast.css';

const TAG_META: Record<number, { icon: string; label: string }> = {
  1: { icon: '🌅', label: '财经早餐' },
  2: { icon: '🌙', label: '港股收盘' },
  3: { icon: '☀️', label: '港股午盘' },
};

const SENTIMENT_CLASS: Record<string, string> = {
  positive: 'positive',
  neutral: 'neutral',
  negative: 'negative',
};

function sentimentLabel(raw: string): string {
  if (/乐观|positive|bullish/i.test(raw)) return '乐观';
  if (/悲观|negative|bearish/i.test(raw)) return '悲观';
  if (/中性偏乐观/i.test(raw)) return '中性偏乐观';
  if (/中性偏悲观/i.test(raw)) return '中性偏悲观';
  return raw || '中性';
}

function sentimentClass(raw: string): string {
  if (/乐观|positive|bullish/i.test(raw)) return 'positive';
  if (/悲观|negative|bearish/i.test(raw)) return 'negative';
  return SENTIMENT_CLASS[raw] ?? 'neutral';
}

interface Props {
  data: FinanceBreakfastData;
}

function FinanceBreakfast({ data }: Props) {
  const meta = TAG_META[data.tag] ?? TAG_META[1];

  return (
    <div className="fb-card">
      <div className="fb-header">
        <span className="fb-icon">{meta.icon}</span>
        <span className="fb-title">{data.title || meta.label}</span>
        <span className="fb-time">{data.publish_time}</span>
      </div>

      {data.keyword.length > 0 && (
        <div className="fb-keywords">
          {data.keyword.map((kw) => (
            <span key={kw} className="fb-kw-tag">
              {kw}
            </span>
          ))}
        </div>
      )}

      <div className="fb-meta">
        <span className={`fb-sentiment ${sentimentClass(data.sentiment)}`}>
          {sentimentLabel(data.sentiment)}
        </span>
        {data.newsCount > 0 && (
          <span className="fb-news-count">
            过去 24h · {data.newsCount} 条资讯
          </span>
        )}
      </div>

      {data.summary && <p className="fb-summary">{data.summary}</p>}
    </div>
  );
}

export default FinanceBreakfast;
