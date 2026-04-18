export type ArtifactType =
  | "quote-card"
  | "kline-chart"
  | "news-list"
  | "finance-breakfast"
  | "ai-hot-news"
  | "bar-chart"
  | "line-chart"
  | "data-table";

export interface QuoteCardData {
  code: string;
  name: string;
  price: number;
  chgVal: number;
  chgPct: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  vol: number;
  turnover: number;
  mktCap: number;
  currency: string;
  mkt: string;
  quoteTime?: string;
  turnoverRate?: number;
  floatMktCap?: number;
  amp?: number;
  pb?: number;
}

export interface KLineDataPoint {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  vol: number;
  turnover?: number;
  chgPct?: number;
}

export interface KLineChartData {
  code: string;
  name: string;
  ktype: "day" | "week" | "month";
  data: KLineDataPoint[];
}

export interface NewsItem {
  newId: string;
  title: string;
  summary: string;
  tags: string[];
  publishTime: string;
  imgUrl?: string;
  wordCount?: number;
  readTime?: number;
  influence?: string;
  influenceScore?: string;
  marketTrends?: { ticker: string; changeRate: number }[];
}

export interface NewsListData {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
}

export interface FinanceBreakfastData {
  title: string;
  tag: 1 | 2 | 3;
  keyword: string[];
  publish_time: string;
  summary: string;
  newsCount: number;
  sentiment: string;
  title_original?: string;
}

export interface AIHotNewsItem {
  news_id: string;
  xcf_id: string;
  tag: string[];
  title: string;
  summary: string;
  img_url?: string;
}

export interface AIHotNewsData {
  items: AIHotNewsItem[];
}

export interface BarChartData {
  title: string;
  categories: string[];
  series: { name: string; data: number[] }[];
  unit?: string;
}

export interface LineChartData {
  title: string;
  xAxis: string[];
  series: { name: string; data: number[] }[];
  unit?: string;
}

export interface DataTableData {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  data:
    | QuoteCardData
    | KLineChartData
    | NewsListData
    | FinanceBreakfastData
    | AIHotNewsData
    | BarChartData
    | LineChartData
    | DataTableData;
}
