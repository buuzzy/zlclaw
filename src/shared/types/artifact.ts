export type ArtifactType =
  | 'quote-card'
  | 'kline-chart'
  | 'intraday-chart'
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

/**
 * 分时图单个时间点数据。
 * 对应 A 股实时分时（tick-by-minute）行情。
 */
export interface IntradayPoint {
  /** 时间，格式 'HH:MM'，如 '09:30'、'14:37'（24 小时制） */
  time: string;
  /** 成交价（元） */
  price: number;
  /** 累计均价（开盘至当前时刻的 VWAP）*/
  avgPrice: number;
  /** 该分钟成交量（股）*/
  volume: number;
  /** 该分钟成交额（元），可选 */
  turnover?: number;
}

/**
 * 分时图 artifact 数据。仅支持 A 股（sh/sz），市场在组件内按惯例处理：
 *   - 交易时段 09:30-11:30 + 13:00-15:00（合计 240 分钟）
 *   - 11:30-13:00 午间停盘，组件内部灰化展示
 *   - 配色沿用 TradingView KLine 惯例（绿涨红跌）
 */
export interface IntradayChartData {
  /** 股票代码，如 '600519.SH' */
  code: string;
  /** 股票名称 */
  name: string;
  /** 昨收价，作为涨跌参考线（红绿分色的基准） */
  prevClose: number;
  /** 交易日期（YYYY-MM-DD），用于 tooltip 展示 */
  tradeDate?: string;
  /** 按时间升序排列的 tick 数据 */
  points: IntradayPoint[];
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

export interface NewsFeedSentimentSummary {
  bullish: number;
  bearish: number;
  neutral: number;
  overall: 'bullish' | 'bearish' | 'neutral';
  summary?: string; // 一句话总结，如"关税政策持续压制情绪，整体偏空"
}

export interface NewsFeedData {
  items: NewsFeedItem[];
  total: number;
  sentimentSummary?: NewsFeedSentimentSummary;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  data:
    | QuoteCardData
    | KLineChartData
    | IntradayChartData
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
