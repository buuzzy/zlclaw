# Sage 前端组件架构完整分析报告
**生成时间**: 2026-04-20（更新：新增 5 个 HTUIKit 组件）
**范围**: Artifact 组件系统、渲染机制、实现模式、样式方案

---

## 目录
1. [架构概览](#架构概览)
2. [组件注册与路由机制](#组件注册与路由机制)
3. [现有组件清单](#现有组件清单)
4. [详细组件实现](#详细组件实现)
5. [技术栈与依赖](#技术栈与依赖)
6. [样式方案](#样式方案)
7. [新组件开发指南](#新组件开发指南)

---

## 架构概览

### 文件结构
```
src/
├── components/
│   ├── artifacts/                 # 原始 artifact 处理组件
│   │   ├── ArtifactPreview.tsx
│   │   ├── CodePreview.tsx
│   │   ├── ImagePreview.tsx
│   │   ├── PdfPreview.tsx
│   │   ├── VideoPreview.tsx
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   └── index.ts
│   │
│   └── htui/                      # ⭐ 金融数据可视化组件库
│       ├── ArtifactRenderer.tsx   # 核心路由和渲染器
│       ├── QuoteCard/             # 行情卡片
│       │   ├── QuoteCard.tsx
│       │   └── QuoteCard.css
│       ├── KLineChart/            # K线图表
│       │   ├── KLineChart.tsx
│       │   └── KLineChart.css
│       ├── BarChart/              # 柱状图
│       │   ├── BarChart.tsx
│       │   └── BarChart.css
│       ├── LineChart/             # 折线图
│       │   ├── LineChart.tsx
│       │   └── LineChart.css
│       ├── DataTable/             # 数据表格
│       │   ├── DataTable.tsx
│       │   └── DataTable.css
│       ├── NewsCard/              # 新闻列表
│       │   ├── NewsCard.tsx
│       │   └── NewsCard.css
│       ├── FinanceBreakfast/      # 早报卡片
│       │   ├── FinanceBreakfast.tsx
│       │   └── FinanceBreakfast.css
│       ├── AIHotNews/             # AI热闻
│       │   ├── AIHotNews.tsx
│       │   └── AIHotNews.css
│       ├── StockSnapshot/         # 个股快照 (NEW)
│       │   ├── StockSnapshot.tsx
│       │   └── StockSnapshot.css
│       ├── SectorHeatmap/         # 板块热力图 (NEW)
│       │   ├── SectorHeatmap.tsx
│       │   └── SectorHeatmap.css
│       ├── ResearchConsensus/     # 研报评级汇总 (NEW)
│       │   ├── ResearchConsensus.tsx
│       │   └── ResearchConsensus.css
│       ├── FinancialHealth/       # 财务健康仪表盘 (NEW)
│       │   ├── FinancialHealth.tsx
│       │   └── FinancialHealth.css
│       ├── NewsFeed/              # 情绪新闻流 (NEW)
│       │   ├── NewsFeed.tsx
│       │   └── NewsFeed.css
│       └── index.ts
│
└── shared/
    ├── types/
    │   └── artifact.ts            # ⭐ 所有 artifact 类型定义
    └── lib/
        ├── format.ts              # 格式化工具
        └── artifactParser.ts      # 解析器
```

### 系统设计原则
- **模块化**：每个组件独立文件夹，包含 .tsx 和 .css
- **类型安全**：完整的 TypeScript 类型定义
- **集中式路由**：`ArtifactRenderer` 统一负责类型→组件映射
- **惰性加载**：使用 React.lazy() 动态导入组件
- **CSS 模块化**：采用 CSS 类名 scope，结合 CSS 变量
- **一致性设计**：统一的变量、色彩、间距规范

---

## 组件注册与路由机制

### 1️⃣ 类型定义（`src/shared/types/artifact.ts`）

**核心类型枚举**：
```typescript
export type ArtifactType =
  | "quote-card"        // 行情卡片
  | "kline-chart"       // K线图表
  | "news-list"         // 新闻列表
  | "finance-breakfast" // 金融早报
  | "ai-hot-news"       // AI热闻
  | "bar-chart"         // 柱状图
  | "line-chart"        // 折线图
  | "data-table"        // 数据表格
  | "stock-snapshot"    // 个股快照
  | "sector-heatmap"    // 板块热力图
  | "research-consensus" // 研报评级汇总
  | "financial-health"  // 财务健康仪表盘
  | "news-feed";        // 情绪新闻流
```

**通用 Artifact 容器**：
```typescript
export interface Artifact {
  id: string;                    // 唯一标识
  type: ArtifactType;            // 组件类型
  data: QuoteCardData |          // 数据载荷（联合类型）
        KLineChartData |
        NewsListData |
        StockSnapshotData |
        SectorHeatmapData |
        ResearchConsensusData |
        FinancialHealthData |
        NewsFeedData |
        // ... 其他类型
}
```

### 2️⃣ 渲染入口（`src/components/htui/ArtifactRenderer.tsx`）

**核心机制**：
```typescript
function renderSingleArtifact(artifact: Artifact, index: number) {
  const key = `artifact-${artifact.type}-${index}`;

  switch (artifact.type) {
    case 'quote-card':
      return <QuoteCard key={key} data={artifact.data as QuoteCardData} />;
    case 'kline-chart':
      return <KLineChart key={key} data={artifact.data as KLineChartData} />;
    case 'bar-chart':
      return <BarChart key={key} data={artifact.data as BarChartData} />;
    // ... 其他类型
    default:
      return null;
  }
}

export function ArtifactRenderer({ artifacts }: ArtifactRendererProps) {
  return (
    <Suspense fallback={<div className="h-20 animate-pulse" />}>
      <div className="my-3 flex flex-col gap-4">
        {artifacts.map((artifact, i) => renderSingleArtifact(artifact, i))}
      </div>
    </Suspense>
  );
}
```

**特点**：
- ✅ 类型安全的 switch 路由
- ✅ Suspense 包装处理加载态
- ✅ 支持多个 artifacts 依次渲染
- ✅ 每个 artifact 独立 key 避免渲染问题

### 3️⃣ 组件导入策略

使用 `React.lazy()` 实现**代码分割**：
```typescript
const QuoteCard = lazy(() => import('./QuoteCard/QuoteCard'));
const KLineChart = lazy(() => import('./KLineChart/KLineChart'));
const BarChart = lazy(() => import('./BarChart/BarChart'));
const LineChart = lazy(() => import('./LineChart/LineChart'));
const DataTable = lazy(() => import('./DataTable/DataTable'));
const NewsCard = lazy(() => import('./NewsCard/NewsCard'));
const FinanceBreakfast = lazy(() => import('./FinanceBreakfast/FinanceBreakfast'));
const AIHotNews = lazy(() => import('./AIHotNews/AIHotNews'));
const StockSnapshot = lazy(() => import('./StockSnapshot/StockSnapshot'));
const SectorHeatmap = lazy(() => import('./SectorHeatmap/SectorHeatmap'));
const ResearchConsensus = lazy(() => import('./ResearchConsensus/ResearchConsensus'));
const FinancialHealth = lazy(() => import('./FinancialHealth/FinancialHealth'));
const NewsFeed = lazy(() => import('./NewsFeed/NewsFeed'));
```

**优势**：
- 减小首屏 bundle 体积
- 按需加载组件代码
- 改善应用性能

---

## 现有组件清单

| 组件类型 | 用途 | 图表库 | 数据维度 | 状态 |
|---------|------|------|--------|------|
| **quote-card** | 实时行情卡片 | —— | 单个标的 | ✅ 完成 |
| **kline-chart** | K线走势图 | lightweight-charts | 时间序列 | ✅ 完成 |
| **bar-chart** | 柱状对比图 | echarts | 分类数据 | ✅ 完成 |
| **line-chart** | 趋势折线图 | echarts | 时间序列 | ✅ 完成 |
| **data-table** | 结构化表格 | antd Table | 多行多列 | ✅ 完成 |
| **news-list** | 新闻列表卡片 | —— | 列表 | ✅ 完成 |
| **finance-breakfast** | 金融早报 | —— | 摘要 | ✅ 完成 |
| **ai-hot-news** | AI热闻列表 | —— | 列表 | ✅ 完成 |
| **stock-snapshot** | 个股快照（价格+sparkline+估值） | 原生 SVG | 单个标的 | ✅ 完成 |
| **sector-heatmap** | 板块热力图（涨跌幅颜色映射） | ECharts Treemap | 分类数据 | ✅ 完成 |
| **research-consensus** | 研报评级汇总（分布+目标价区间） | 原生 React | 列表+统计 | ✅ 完成 |
| **financial-health** | 财务健康仪表盘（4维度2×2网格） | 原生 React | 多维评分 | ✅ 完成 |
| **news-feed** | 情绪新闻流（Timeline+情绪圆点） | 原生 React | 列表 | ✅ 完成 |

---

## 详细组件实现

### 1. QuoteCard（行情卡片）

**用途**：显示单个股票/指数的实时行情

**Props 类型**：
```typescript
export interface QuoteCardData {
  code: string;           // 股票代码，如 "600519.SH"
  name: string;           // 股票名称
  price: number;          // 最新价
  chgVal: number;         // 涨跌额
  chgPct: number;         // 涨跌幅 (%)
  prevClose: number;      // 昨收价
  open: number;           // 开盘价
  high: number;           // 最高价
  low: number;            // 最低价
  vol: number;            // 成交量
  turnover: number;       // 成交额
  mktCap: number;         // 市值
  currency: string;       // 货币，如 "CNY"
  mkt: string;            // 市场，如 "SH" (沪深), "US" (美股)
  
  // 可选扩展字段
  quoteTime?: string;     // 报价时间
  turnoverRate?: number;  // 换手率
  floatMktCap?: number;   // 流通市值
  amp?: number;           // 振幅
  pb?: number;            // 市净率
}
```

**实现特点**：
```typescript
function QuoteCard({ data }: QuoteCardProps) {
  const isUp = data.chgPct >= 0;
  const trend = isUp ? "up" : "down";
  
  return (
    <div className="quote-card">
      {/* 头部：代码 + 名称 */}
      <div className="quote-header">
        <span className="quote-code">{data.code}</span>
        <span className="quote-name">{data.name}</span>
      </div>

      {/* 主要数据：价格 + 涨跌 */}
      <div className="quote-main">
        <span className={`quote-price ${trend}`}>
          {formatPrice(data.price)} {data.currency}
        </span>
        <div className={`quote-change ${trend}`}>
          {formatPrice(data.chgVal)} ({formatPercent(data.chgPct)})
        </div>
      </div>

      {/* 详细数据网格 */}
      <div className="quote-grid">
        <div className="quote-cell">
          <span className="cell-label">开盘</span>
          <span className="cell-value">{formatPrice(data.open)}</span>
        </div>
        {/* 其他网格单元 */}
      </div>
    </div>
  );
}
```

**样式要点**：
- 宽度：420px (max-width)
- 颜色主题：绿色上涨 (#10B981)，红色下跌 (#EF4444)
- 布局：Flex 容器 + Grid 详情
- 字体：JetBrains Mono (代码/数字)

**输出尺寸**：约 420px × 180px

---

### 2. KLineChart（K线图表）

**用途**：显示股票/指数的 K 线走势（含 MA 均线）

**Props 类型**：
```typescript
export interface KLineDataPoint {
  time: string;        // 日期，格式 "2026-04-15"
  open: number;        // 开盘价
  close: number;       // 收盘价
  high: number;        // 最高价
  low: number;         // 最低价
  vol: number;         // 成交额或成交量
  turnover?: number;   // 成交额（可选）
  chgPct?: number;     // 涨跌幅（可选）
}

export interface KLineChartData {
  code: string;                     // 股票代码
  name: string;                     // 股票名称
  ktype: "day" | "week" | "month";  // K线周期
  data: KLineDataPoint[];           // K线数据点数组
}
```

**实现特点**：
```typescript
function KLineChart({ data }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 使用 lightweight-charts 创建图表
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { color: "#1e1e1e" },
        textColor: "#a1a1aa",
      },
    });

    // 1. 添加 K 线蜡烛图
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10B981",      // 绿色
      downColor: "#EF4444",    // 红色
    });
    candleSeries.setData(data.data);

    // 2. 添加 MA 均线 (5/10/20)
    const MA_CONFIG = [
      { period: 5, color: "#F59E0B" },   // 黄色
      { period: 10, color: "#06B6D4" },  // 青色
      { period: 20, color: "#A855F7" },  // 紫色
    ];
    
    for (const ma of MA_CONFIG) {
      const maData = calculateMA(data.data, ma.period);
      const series = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
      });
      series.setData(maData);
    }

    // 3. 响应式布局
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      chart.applyOptions({ width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return (
    <div className="kline-chart">
      <div className="kline-header">
        <div>{data.code} {data.name}</div>
        {/* K周期切换按钮 */}
      </div>
      <div className="kline-legend">
        MA5 MA10 MA20
      </div>
      <div className="kline-container" ref={containerRef} />
    </div>
  );
}
```

**图表库**：**lightweight-charts** v5.1.0
- ✅ 轻量级（~50KB gzip）
- ✅ 高性能渲染
- ✅ 原生蜡烛图支持
- ✅ 响应式布局

**输出尺寸**：100% 宽度 × 320px 高度

---

### 3. BarChart（柱状图）

**用途**：多标的对比、财务指标对比、行业排名

**Props 类型**：
```typescript
export interface BarChartData {
  title: string;                    // 图表标题
  categories: string[];             // X 轴标签（分类名）
  series: {
    name: string;                   // 数据系列名称
    data: number[];                 // 对应 categories 的数值数组
  }[];
  unit?: string;                    // 数值单位，如 "亿元"
}
```

**实现特点**：
```typescript
function BarChart({ data }: BarChartProps) {
  const option = {
    title: {
      text: data.title,
      left: "center",
      textStyle: { color: "#e4e4e7", fontSize: 14 },
    },
    tooltip: {
      trigger: "axis" as const,
      valueFormatter: (val: number) =>
        data.unit ? `${val} ${data.unit}` : String(val),
    },
    legend: {
      show: data.series.length > 1,  // 多系列才显示图例
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: data.categories,
    },
    yAxis: {
      type: "value",
      name: data.unit ?? "",
    },
    series: data.series.map((s) => ({
      name: s.name,
      type: "bar",
      data: s.data,
      barMaxWidth: 40,
      itemStyle: { borderRadius: [4, 4, 0, 0] },  // 圆角
    })),
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: "100%" }}
      opts={{ renderer: "svg" }}
      theme="dark"
    />
  );
}
```

**图表库**：**echarts** v6.0.0 + **echarts-for-react** v3.0.6
- ✅ 功能丰富
- ✅ 多维度支持（多series）
- ✅ 自定义配置灵活
- ✅ 内置主题系统

**输出尺寸**：100% 宽度 × 320px 高度

**示例数据**：
```json
{
  "title": "2025年营业收入对比",
  "categories": ["茅台", "五粮液", "泸州老窖"],
  "series": [
    { "name": "营业收入", "data": [1505.2, 832.1, 302.3] }
  ],
  "unit": "亿元"
}
```

---

### 4. LineChart（折线图）

**用途**：趋势分析、收益率走势、指数长期表现

**Props 类型**：
```typescript
export interface LineChartData {
  title: string;           // 图表标题
  xAxis: string[];         // X 轴标签（日期/年份/分类）
  series: {
    name: string;          // 数据系列名称
    data: number[];        // 对应 xAxis 的数值数组
  }[];
  unit?: string;           // 数值单位，如 "%"
}
```

**实现特点**：
```typescript
function LineChart({ data }: LineChartProps) {
  const option = {
    title: { text: data.title, left: "center" },
    tooltip: { trigger: "axis" },
    legend: { show: data.series.length > 1, bottom: 0 },
    xAxis: {
      type: "category",
      data: data.xAxis,
      boundaryGap: false,  // 不留边距，紧贴边界
    },
    yAxis: { type: "value" },
    series: data.series.map((s) => ({
      name: s.name,
      type: "line",
      data: s.data,
      smooth: true,        // 平滑曲线
      symbol: "circle",    // 数据点圆形标记
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: data.series.length === 1  // 单线时显示填充
        ? { opacity: 0.15 }
        : undefined,
    })),
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: "100%" }}
      opts={{ renderer: "svg" }}
      theme="dark"
    />
  );
}
```

**输出尺寸**：100% 宽度 × 320px 高度

**示例数据**：
```json
{
  "title": "沪深300近5年收益率走势",
  "xAxis": ["2021", "2022", "2023", "2024", "2025"],
  "series": [
    { "name": "沪深300", "data": [-5.2, -21.6, -11.4, 14.7, 12.3] }
  ],
  "unit": "%"
}
```

---

### 5. DataTable（数据表格）

**用途**：财务报表、基金列表、研报列表、公告列表

**Props 类型**：
```typescript
export interface DataTableData {
  title: string;
  columns: {
    key: string;        // 数据字段 key
    label: string;      // 列表头显示名
  }[];
  rows: Record<string, string | number>[];
}
```

**实现特点**：
```typescript
function DataTable({ data }: DataTableProps) {
  const columns = data.columns.map((col) => ({
    title: col.label,
    dataIndex: col.key,
    key: col.key,
    render: (val) => val != null ? String(val) : "—",
  }));

  return (
    <div className="data-table-card">
      <Table
        columns={columns}
        dataSource={data.rows}
        size="small"
        pagination={data.rows.length > 10 ? { pageSize: 10 } : false}
        scroll={{ x: "max-content" }}  // 横向滚动
      />
    </div>
  );
}
```

**使用库**：**antd** (Ant Design) v6.3.5 Table 组件
- ✅ 内置分页
- ✅ 自适应布局
- ✅ 行列操作支持

**输出尺寸**：100% 宽度，高度根据行数自适应

**示例数据**：
```json
{
  "title": "贵州茅台近3年财务数据",
  "columns": [
    { "key": "year", "label": "年份" },
    { "key": "revenue", "label": "营业收入(亿)" },
    { "key": "profit", "label": "净利润(亿)" }
  ],
  "rows": [
    { "year": "2023", "revenue": 1476.9, "profit": 747.3 },
    { "year": "2024", "revenue": 1505.2, "profit": 762.1 }
  ]
}
```

---

### 6. NewsCard（新闻列表）

**用途**：财经新闻、资讯展示

**Props 类型**：
```typescript
export interface NewsItem {
  newId: string;                           // 新闻 ID
  title: string;                           // 标题
  summary: string;                         // 摘要
  tags: string[];                          // 标签数组
  publishTime: string;                     // 发布时间
  imgUrl?: string;                         // 缩略图
  wordCount?: number;                      // 字数
  readTime?: number;                       // 阅读时间 (分钟)
  influence?: string;                      // 影响程度
  influenceScore?: string;                 // 影响力分数
  marketTrends?: { ticker: string; changeRate: number }[];
}

export interface NewsListData {
  items: NewsItem[];
  total: number;
  hasMore: boolean;
}
```

**实现特点**：
```typescript
function NewsCard({ data }: Props) {
  return (
    <div className="news-list">
      {data.items.map((item) => (
        <article key={item.newId} className="news-item">
          <div className="news-item-header">
            <h4 className="news-item-title">{item.title}</h4>
            <span className="news-item-time">{item.publishTime}</span>
          </div>

          <p className="news-item-summary">{item.summary}</p>

          <div className="news-item-footer">
            {/* 标签 */}
            <div className="news-tags">
              {item.tags.map((tag) => (
                <span key={tag} className="news-tag">{tag}</span>
              ))}
            </div>

            {/* 市场变化 */}
            {item.marketTrends?.map((t) => (
              <span key={t.ticker} className={`news-trend ${t.changeRate >= 0 ? "up" : "down"}`}>
                {t.ticker} {formatPercent(t.changeRate * 100)}
              </span>
            ))}

            {/* 阅读时间 */}
            {item.readTime && <span className="news-read-time">{item.readTime} min</span>}
          </div>
        </article>
      ))}
    </div>
  );
}
```

**输出尺寸**：max-width 560px，高度自适应

---

### 9. StockSnapshot（个股快照）

**用途**：全面展示单只股票行情、估值指标、sparkline 走势和分析师评级

**Props 类型**：
```typescript
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
  turnover: number;        // 成交额
  turnoverRate: number;    // 换手率%
  mktCap: number;
  pe: number;              // 市盈率TTM
  pb: number;              // 市净率
  roe: number;             // ROE%
  currency: string;
  mkt: string;
  sparkline: number[];     // 近20日收盘价，用于迷你折线
  analystRating?: "强烈推荐" | "推荐" | "中性" | "回避";
  targetPrice?: number;    // 分析师目标价
}
```

**UI 布局**：大字价格 + 右侧 SVG sparkline → 3列指标网格（开/高/低 | 市值/换手/成交额 | PE/PB/ROE） → 底部分析师评级 pill + 目标价

**实现特点**：迷你 sparkline 用纯 SVG path 绘制，无需 ECharts，轻量零依赖；颜色随涨跌切换绿/红。

**输出尺寸**：max-width 480px，高度自适应

---

### 10. SectorHeatmap（板块热力图）

**用途**：展示各行业/板块当日涨跌幅，颜色深浅映射涨跌，面积映射成交额

**Props 类型**：
```typescript
export interface SectorItem {
  name: string;    // 板块名
  chgPct: number;  // 涨跌幅%
  vol?: number;    // 成交额（影响矩形面积）
}

export interface SectorHeatmapData {
  title: string;
  date: string;
  items: SectorItem[];
}
```

**图表库**：ECharts Treemap；颜色梯度 -5%（深红）→ 0%（灰 #3f3f46）→ +5%（深绿），无边框紧凑布局

**输出尺寸**：100% 宽度 × 380px 高度

---

### 11. ResearchConsensus（研报评级汇总）

**用途**：汇总机构分析师评级分布、目标价区间和最新研报列表

**Props 类型**：
```typescript
export interface ResearchItem {
  institution: string;  // 机构名
  rating: string;       // 评级（买入/增持/中性/减持/卖出）
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
```

**UI 布局**：评级分布横条（绿/灰/红） → 目标价区间轨道（低←◆→高，当前价竖线） → 研报列表（最多5条，机构名+评级badge+目标价+日期）

**输出尺寸**：max-width 480px，高度自适应

---

### 12. FinancialHealth（财务健康仪表盘）

**用途**：从盈利能力、成长性、估值、安全性四维度综合评估公司财务健康

**Props 类型**：
```typescript
export interface FinancialDimension {
  label: string;   // 维度名
  score: number;   // 0-100
  metrics: { label: string; value: string; trend?: "up" | "down" | "flat" }[];
}

export interface FinancialHealthData {
  code: string;
  name: string;
  year: string;
  dimensions: FinancialDimension[];  // 建议4个维度
  summary?: string;
}
```

**UI 布局**：2×2 维度卡片网格，每卡片含：维度名 + 大字分数（颜色分级：<40红/40-70橙/≥70绿）+ 横向分数条 + 2-3 个关键指标 → 底部一句话摘要（灰斜体）

**输出尺寸**：100% 宽度，高度自适应

---

### 13. NewsFeed（情绪新闻流）

**用途**：以 Timeline 风格展示新闻，每条附带情绪判断（看涨/看跌/中性）和关联股票涨跌

**Props 类型**：
```typescript
export interface NewsFeedItem {
  id: string;
  title: string;
  summary?: string;
  tags: string[];
  publishTime: string;
  sentiment: "bullish" | "bearish" | "neutral";
  relatedTickers?: { ticker: string; chgPct: number }[];
}

export interface NewsFeedData {
  items: NewsFeedItem[];
  total: number;
}
```

**UI 布局**：左侧细竖线 timeline，每条：情绪圆点（绿/红/灰） + 时间戳 + 标题（加粗） + 摘要（2行截断） + tag badges + 关联股票涨跌

**输出尺寸**：max-width 560px，高度自适应

---

**Props 类型**：
```typescript
export interface FinanceBreakfastData {
  title: string;            // 早报标题
  tag: 1 | 2 | 3;           // 紧急程度标签
  keyword: string[];        // 关键词列表
  publish_time: string;     // 发布时间
  summary: string;          // 摘要内容
  newsCount: number;        // 包含新闻数
  sentiment: string;        // 市场情绪（看涨/看跌/中性）
  title_original?: string;  // 原标题
}
```

---

### 8. AIHotNews（AI热闻）

**Props 类型**：
```typescript
export interface AIHotNewsData {
  items: {
    news_id: string;
    xcf_id: string;
    tag: string[];
    title: string;
    summary: string;
    img_url?: string;
  }[];
}
```

---

## 技术栈与依赖

### 核心依赖
```json
{
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "typescript": "^5.x",
  
  "echarts": "^6.0.0",
  "echarts-for-react": "^3.0.6",
  "lightweight-charts": "^5.1.0",
  
  "antd": "^6.3.5",
  "tailwindcss": "^4.x",
  "@tailwindcss/vite": "^4.1.18",
  
  "@radix-ui/react-*": "^1.x",
  "lucide-react": "^0.562.0",
  "clsx": "^2.1.1"
}
```

### 图表库选择策略

| 图表类型 | 首选库 | 理由 | 备选方案 |
|---------|--------|------|---------|
| K线图 | lightweight-charts | 轻量 + 高性能 | TradingView Lightweight Charts |
| 柱状/折线 | echarts | 功能完整 + 灵活 | Victory.js, Recharts |
| 表格 | antd Table | 企业级 + 功能全 | Tanstack Table, 原生 |
| 简单卡片 | CSS Modules | 无需库 | tailwind + JSX |

---

## 样式方案

### CSS 变量体系

所有组件基于 CSS 变量实现暗黑主题：

```css
:root {
  /* 背景色 */
  --bg-primary:      #0f0f0f;     /* 主背景 */
  --bg-secondary:    #1a1a1a;     /* 次背景 */
  --bg-tertiary:     #27272a;     /* 卡片背景 */
  --bg-elevated:     #3f3f46;     /* 浮起背景 */

  /* 边框色 */
  --border:          #3f3f46;     /* 主边框 */
  --border-subtle:   #27272a;     /* 弱边框 */

  /* 文字色 */
  --text-primary:    #e4e4e7;     /* 主文本 */
  --text-secondary:  #a1a1aa;     /* 次文本 */
  --text-muted:      #71717a;     /* 弱文本 */

  /* 状态色 */
  --color-success:   #10B981;     /* 绿色上涨 */
  --color-danger:    #EF4444;     /* 红色下跌 */
  --accent-primary:  #06B6D4;     /* 主强调色 */
}
```

### CSS 模块化模式

每个组件的 CSS 文件独立，采用**命名空间**隔离：

```css
/* QuoteCard.css */
.quote-card { ... }
.quote-header { ... }
.quote-code { ... }
.quote-name { ... }

/* KLineChart.css */
.kline-chart { ... }
.kline-header { ... }
.kline-container { ... }
```

### 响应式设计

```css
@media (max-width: 768px) {
  .quote-grid {
    grid-template-columns: 1fr;  /* 单列 */
  }
  
  .kline-chart {
    padding: 12px;  /* 缩小内边距 */
  }
}
```

### Tailwind 集成

虽然主要用 CSS Modules，但某些地方用 Tailwind：

```typescript
<div className="my-3 flex flex-col gap-4">  {/* Suspense 包装 */}
  {artifacts.map((artifact) => renderSingleArtifact(artifact))}
</div>

<div className="h-20 animate-pulse rounded-lg bg-zinc-800/50" />  {/* 加载态 */}
```

---

## 新组件开发指南

### 步骤 1：定义类型

编辑 `src/shared/types/artifact.ts`，添加新类型：

```typescript
// 1. 添加到 ArtifactType 枚举
export type ArtifactType = 
  | "quote-card"
  | "kline-chart"
  | "bar-chart"
  | "line-chart"
  | "data-table"
  | "news-list"
  | "my-new-component";  // ← 新类型

// 2. 定义数据接口
export interface MyNewComponentData {
  title: string;
  // ... 你的数据字段
}

// 3. 更新 Artifact 联合类型
export interface Artifact {
  id: string;
  type: ArtifactType;
  data: QuoteCardData |
        KLineChartData |
        MyNewComponentData |  // ← 添加
        // ...
}
```

### 步骤 2：创建组件文件夹

```bash
mkdir -p src/components/htui/MyNewComponent
touch src/components/htui/MyNewComponent/MyNewComponent.tsx
touch src/components/htui/MyNewComponent/MyNewComponent.css
```

### 步骤 3：实现组件

**MyNewComponent.tsx**：
```typescript
import type { MyNewComponentData } from "@/shared/types/artifact";
import "./MyNewComponent.css";

interface MyNewComponentProps {
  data: MyNewComponentData;
}

function MyNewComponent({ data }: MyNewComponentProps) {
  return (
    <div className="my-new-component">
      <h3>{data.title}</h3>
      {/* 组件内容 */}
    </div>
  );
}

export default MyNewComponent;
```

**MyNewComponent.css**：
```css
.my-new-component {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  width: 100%;
}
```

### 步骤 4：注册到路由器

编辑 `src/components/htui/ArtifactRenderer.tsx`：

```typescript
// 1. 导入 lazy 组件
const MyNewComponent = lazy(() => import('./MyNewComponent/MyNewComponent'));

// 2. 添加 case
function renderSingleArtifact(artifact: Artifact, index: number) {
  switch (artifact.type) {
    // ... 其他 case
    case 'my-new-component':
      return <MyNewComponent key={key} data={artifact.data as MyNewComponentData} />;
    default:
      return null;
  }
}
```

### 步骤 5：更新导出

如果需要其他地方使用，编辑 `src/components/htui/index.ts`：
```typescript
export { default as MyNewComponent } from './MyNewComponent/MyNewComponent';
```

---

## 最佳实践清单

### ✅ 组件设计
- [ ] 单一职责：每个组件只处理一种数据类型
- [ ] 类型安全：完整的 TypeScript Props 定义
- [ ] 纯组件：不修改 props，无内部状态管理（除非必要）
- [ ] 响应式：支持不同屏幕尺寸

### ✅ 样式
- [ ] 使用 CSS 变量实现主题一致性
- [ ] 类名采用 BEM 命名规范：`.component-name__element--modifier`
- [ ] 避免硬编码颜色值，优先使用 CSS 变量
- [ ] 支持暗黑主题

### ✅ 性能
- [ ] 使用 React.lazy() 实现代码分割
- [ ] 避免不必要的 re-render（memoization）
- [ ] 图表库选择：轻量级优先（lightweight-charts vs echarts）
- [ ] 长列表使用虚拟滚动

### ✅ 可访问性
- [ ] 正确的 HTML 语义元素（`<article>`, `<table>` 等）
- [ ] 颜色对比度满足 WCAG AA 标准
- [ ] 键盘导航支持
- [ ] ARIA 标签补充

### ✅ 文档
- [ ] Props 类型文档齐全
- [ ] 数据示例包含边界情况（空数据、超大数据等）
- [ ] CSS 类名注释说明
- [ ] 使用 JSDoc 注释复杂逻辑

---

## 数据流示意图

```
后端 API
   ↓
返回 JSON 数据
   ↓
解析为 Artifact 对象
   {
     id: "...",
     type: "quote-card",
     data: { ... }
   }
   ↓
ArtifactRenderer
   ↓
类型匹配 (switch)
   ↓
懒加载组件
   ↓
渲染到 DOM
```

---

## 常见问题

### Q：如何添加新的数据字段到现有组件？
A：直接编辑 artifact.ts 中的 Interface，添加字段（标记为可选），然后在组件中使用 `data.newField`。

### Q：如何处理空数据？
A：在组件中判断 `if (!data || data.items.length === 0) return null;`，ArtifactRenderer 会自动处理。

### Q：能否在组件中修改数据？
A：不建议。组件应该是纯展示，数据流向应该是单向的（后端→前端）。

### Q：如何实现组件间联动（例如点击 BarChart 显示详情）？
A：可以通过 Context 或状态提升到父组件，但需要确保类型安全。

### Q：图表尺寸固定吗？
A：宽度默认 100%，高度大多数固定为 320px。可根据需求调整。

---

## 文件清单

| 文件路径 | 用途 |
|---------|------|
| `src/shared/types/artifact.ts` | 所有类型定义 |
| `src/components/htui/ArtifactRenderer.tsx` | 核心路由器 |
| `src/components/htui/*/[Component].tsx` | 各组件实现 |
| `src/components/htui/*/[Component].css` | 各组件样式 |
| `src/shared/lib/format.ts` | 数据格式化工具 |
| `package.json` | 依赖清单 |

---

**生成完成**：本文档涵盖了 Sage 前端组件系统的完整架构、13 个组件的详细实现（8 个原始组件 + 5 个新增可视化组件）、技术栈选择、样式方案、以及新组件开发的完整指南。

