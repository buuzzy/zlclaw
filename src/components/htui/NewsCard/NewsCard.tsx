import type { NewsListData } from "@/shared/types/artifact";
import { formatPercent } from "@/shared/lib/format";
import "./NewsCard.css";

interface Props {
  data: NewsListData;
}

function NewsCard({ data }: Props) {
  return (
    <div className="news-list">
      {data.items.map((item) => (
        <article key={item.newId} className="news-item">
          <div className="news-item-header">
            <h4 className="news-item-title">{item.title}</h4>
            <span className="news-item-time">{item.publishTime}</span>
          </div>

          {item.summary && (
            <p className="news-item-summary">{item.summary}</p>
          )}

          <div className="news-item-footer">
            {item.tags.length > 0 && (
              <div className="news-tags">
                {item.tags.map((tag) => (
                  <span key={tag} className="news-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {item.marketTrends && item.marketTrends.length > 0 && (
              <div className="news-trends">
                {item.marketTrends.map((t) => (
                  <span
                    key={t.ticker}
                    className={`news-trend ${t.changeRate >= 0 ? "up" : "down"}`}
                  >
                    {t.ticker} {formatPercent(t.changeRate * 100)}
                  </span>
                ))}
              </div>
            )}

            {item.readTime != null && (
              <span className="news-read-time">{item.readTime} min</span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export default NewsCard;
