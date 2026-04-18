import type { AIHotNewsData } from "@/shared/types/artifact";
import "./AIHotNews.css";

interface Props {
  data: AIHotNewsData;
}

function AIHotNews({ data }: Props) {
  return (
    <div className="ai-hot-news">
      <div className="ahn-header">
        <span className="ahn-icon">🔥</span>
        <span className="ahn-title">AI 热闻</span>
      </div>

      <div className="ahn-list">
        {data.items.map((item) => (
          <article key={item.news_id} className="ahn-item">
            <div className="ahn-item-body">
              <h4 className="ahn-item-title">{item.title}</h4>
              {item.summary && (
                <p className="ahn-item-summary">{item.summary}</p>
              )}
              {item.tag.length > 0 && (
                <div className="ahn-tags">
                  {item.tag.map((t) => (
                    <span key={t} className="ahn-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {item.img_url && (
              <img
                className="ahn-item-img"
                src={item.img_url}
                alt=""
                loading="lazy"
              />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export default AIHotNews;
