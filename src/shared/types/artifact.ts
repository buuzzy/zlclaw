export type ArtifactType =
  | 'quote-card'
  | 'kline-chart'
  | 'news-list'
  | 'finance-breakfast'
  | 'ai-hot-news'
  | 'bar-chart'
  | 'line-chart'
  | 'data-table'
  | 'stock-snapshot'
  | 'sector-heatmap'
  | 'research-consensus'
  | 'financial-health'
  | 'news-feed';

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
  ktype: 'day' | 'week' | 'month';
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

export interface StockSnapshotData {
  code: string;
  name: string;
  price: number;
  chgPct: number;
  chgVal: number;
  prevClose: number;
  high: number;
  low: number;
  open: number;
  turnover: number;
  turnoverRate: number;
  mktCap: number;
  pe: number;
  pb: number;
  roe: number;
  currency: string;
  mkt: string;
  sparkline: number[];
  analystRating?: '强烈推荐' | '推荐' | '中性' | '回避';
  targetPrice?: number;
}

export interface SectorItem {
  name: string;
  chgPct: number;
  vol?: number;
}

export interface SectorHeatmapData {
  title: string;
  date: string;
  items: SectorItem[];
}

export interface ResearchItem {
  institution: string;
  rating: string;
  targetPrice?: number;
  date: string;
  title?: string;
}

export interface ResearchConsensusData {
  code: string;
  name: string;
  currentPrice: number;
  items: ResearchItem[];
  buyCount?: number;
  holdCount?: number;
  sellCount?: number;
  avgTarget?: number;
  highTarget?: number;
  lowTarget?: number;
}

export interface FinancialDimension {
  label: string;
  score: number;
  metrics: {
    label: string;
    value: string | number;
    trend?: 'up' | 'down' | 'flat';
  }[];
}

export interface FinancialHealthData {
  code: string;
  name: string;
  year: string;
  dimensions: FinancialDimension[];
  summary?: string;
}

export interface NewsFeedItem {
  id: string;
  title: string;
  summary?: string;
  tags: string[];
  publishTime: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  relatedTickers?: { ticker: string; chgPct: number }[];
}

export interface NewsFeedData {
  items: NewsFeedItem[];
  total: number;
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
    | DataTableData
    | StockSnapshotData
    | SectorHeatmapData
    | ResearchConsensusData
    | FinancialHealthData
    | NewsFeedData;
}
