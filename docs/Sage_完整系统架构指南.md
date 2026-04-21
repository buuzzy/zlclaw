# Sage 完整系统架构指南
**生成时间**: 2026-04-19
**范围**: 从后端数据源到前端组件的完整数据流、架构设计、最佳实践

---

## 快速导航

本指南包含 3 个独立但相关的文档：

1. **Sage_后端数据结构分析.md** - 后端 15+ Skills、返回字段、工具调用策略
2. **Sage_前端组件架构分析.md** - 前端 13 个组件、类型系统、渲染机制、开发指南
3. **Sage_完整系统架构指南.md** - 本文档，系统全景、数据流、设计决策

---

## 系统全景

### 1. 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户界面（React）                        │
│                    src/components/htui/  (13 个组件)             │
├─────────────────────────────────────────────────────────────────┤
│  QuoteCard │ KLineChart │ BarChart │ LineChart │ DataTable       │
│  NewsCard │ FinanceBreakfast │ AIHotNews │ StockSnapshot         │
│  SectorHeatmap │ ResearchConsensus │ FinancialHealth │ NewsFeed  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                ↓                     ↓
    ┌───────────────────────┐  ┌──────────────────┐
    │  ArtifactRenderer     │  │  Type System     │
    │  (路由、类型匹配)      │  │  (Type Safe)    │
    │  src/components/      │  │  artifact.ts    │
    │  htui/                │  │                  │
    └───────────┬───────────┘  └──────────────────┘
                │
        ┌───────┴───────┐
        ↓               ↓
   ┌─────────────┐  ┌─────────────┐
   │  Artifact   │  │  数据格式化  │
   │   Objects   │  │  format.ts  │
   │ (JSON)      │  │             │
   └──────┬──────┘  └─────────────┘
          │
          ↓
┌─────────────────────────────────────────────────────────────────┐
│                         后端 API 层                              │
├─────────────────────────────────────────────────────────────────┤
│   Westock API (腾讯)       │    iWencai API (同花顺问财)         │
├─────────────────────────────────────────────────────────────────┤
│ • westock-quote            │  • 行情数据查询                      │
│ • westock-market           │  • 财务数据查询                      │
│ • westock-research         │  • 行业数据查询                      │
│ • westock-screener         │  • 宏观数据查询                      │
│                            │  • 指数数据查询                      │
│                            │  • 基本资料查询                      │
│                            │  • 基金理财查询                      │
│                            │  • 研报搜索                          │
│                            │  • 新闻搜索                          │
│                            │  • 公告搜索                          │
│                            │  • 公司经营数据查询                  │
└─────────────────────────────────────────────────────────────────┘
          │                          │
          ↓                          ↓
    ┌──────────────┐         ┌──────────────────┐
    │ 实时数据库    │         │ 结构化查询 API    │
    │ (Redis等)    │         │ (自然语言支持)   │
    └──────────────┘         └──────────────────┘
```

### 2. 数据流示例

#### 用例 1：查询股票行情

```
用户输入: "查询贵州茅台今天的行情"
    ↓
意图识别: "查询实时行情" 
    ↓
选择 Skill: westock-quote 或 行情数据查询
    ↓
调用 API:
  POST /quote?code=600519.SH
  或
  POST /query2data?query=贵州茅台最新价
    ↓
返回原始数据:
  {
    code: "600519.SH",
    name: "贵州茅台",
    price: 1467.42,
    chgPct: 1.42,
    open: 1444.98,
    high: 1470.79,
    low: 1442.0,
    vol: 0,
    turnover: 0,
    mktCap: 0,
    currency: "CNY",
    mkt: "SH"
  }
    ↓
转换为 Artifact:
  {
    id: "artifact-1",
    type: "quote-card",
    data: { ... 上述数据 ... }
  }
    ↓
ArtifactRenderer 路由:
  switch("quote-card") 
    → 懒加载 QuoteCard 组件
    ↓
QuoteCard 渲染:
  ┌──────────────────────────┐
  │ 600519.SH · 贵州茅台      │
  │     1467.42 CNY           │
  │     +20.52 (+1.42%) ▲     │
  │ ─────────────────────────  │
  │ 开盘 1444.98  昨收 1446.9  │
  │ 最高 1470.79  最低 1442.0  │
  │ 成交量 0      市值 0        │
  └──────────────────────────┘
```

#### 用例 2：查询财务数据对比

```
用户输入: "对比茅台和五粮液的营业收入"
    ↓
意图识别: "财务指标对比" 
    ↓
选择 Skill: 财务数据查询
    ↓
调用 API（2次查询）:
  POST /query2data?query=贵州茅台营业收入
  POST /query2data?query=五粮液营业收入
    ↓
返回数据（合并处理）:
  [
    { company: "贵州茅台", revenue: 1505.2, year: "2025" },
    { company: "五粮液", revenue: 832.1, year: "2025" }
  ]
    ↓
转换为 Artifact:
  {
    id: "artifact-2",
    type: "bar-chart",
    data: {
      title: "2025年营业收入对比",
      categories: ["贵州茅台", "五粮液"],
      series: [{ name: "营业收入", data: [1505.2, 832.1] }],
      unit: "亿元"
    }
  }
    ↓
BarChart 渲染 (echarts):
  [ 柱状图表格 ]
```

#### 用例 3：K线走势查询

```
用户输入: "显示上证指数近30天的K线"
    ↓
意图识别: "K线查询"
    ↓
选择 Skill: 指数数据查询 或 westock-quote
    ↓
调用 API:
  GET /history?code=000001.SH&period=30
  或
  POST /query2data?query=上证指数近30个交易日OHLC
    ↓
返回数据（时间序列）:
  [
    { date: "2026-03-15", open: 3884.15, close: 3890.16, high: 3902.61, low: 3875.68 },
    { date: "2026-03-16", open: 3930.25, close: 3994.99, high: 3994.99, low: 3926.25 },
    ...
  ]
    ↓
转换为 Artifact:
  {
    id: "artifact-3",
    type: "kline-chart",
    data: {
      code: "000001.SH",
      name: "上证指数",
      ktype: "day",
      data: [ ... 转换后的数据 ... ]
    }
  }
    ↓
KLineChart 渲染 (lightweight-charts):
  [蜡烛图 + MA5/MA10/MA20 均线]
```

---

## 核心设计模式

### 1. 类型驱动的架构 (Type-Driven Architecture)

所有数据都通过 `ArtifactType` 进行路由：

```typescript
// 后端返回统一的 Artifact 包装
{
  id: string;
  type: "quote-card" | "kline-chart" | "bar-chart" | ...;
  data: QuoteCardData | KLineChartData | BarChartData | ...;
}

// 前端通过 switch 进行类型匹配
switch (artifact.type) {
  case 'quote-card': return <QuoteCard data={...} />;
  case 'kline-chart': return <KLineChart data={...} />;
  // ...
}
```

**优势**：
- ✅ 完全类型安全（TypeScript）
- ✅ 易于扩展新组件类型
- ✅ 前端自动知道渲染哪个组件
- ✅ 后端和前端紧密协作

### 2. Skill 多源协作 (Multi-Source Skill Orchestration)

后端通过多个数据源 Skill 满足不同需求：

```
用户查询
  ↓
意图路由表 (AGENTS.md)
  ├─ "查询实时行情" → westock-quote
  ├─ "财务对比" → 财务数据查询
  ├─ "K线走势" → 行情数据查询
  ├─ "板块排名" → 行业数据查询
  ├─ "新闻资讯" → 新闻搜索
  ├─ "宏观数据" → 宏观数据查询
  └─ ...
```

**调用策略**：
- 单一查询：直接调用对应 Skill
- 多维度查询：并行调用多个 Skill（Agent 协作）
- 自然语言理解：iWencai API 支持 NLP 查询

### 3. 响应式组件设计 (Responsive Component Design)

所有组件遵循统一的设计规范：

```typescript
// 1. Props 类型定义（TypeScript）
interface ComponentProps {
  data: ComponentData;  // 单一 data prop
}

// 2. 纯渲染函数
function Component({ data }: ComponentProps) {
  return <div>{/* 根据 data 渲染 */}</div>;
}

// 3. 静态样式（CSS Variables）
.component {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
}
```

**特点**：
- ✅ 无状态（除非需要）
- ✅ 单向数据流
- ✅ CSS Variables 支持主题切换
- ✅ 易于测试

### 4. 渐进式图表库选择 (Progressive Chart Library Selection)

根据使用场景选择合适的图表库：

| 场景 | 首选 | 理由 |
|------|------|------|
| K线图 | lightweight-charts | 轻量级、高性能、原生金融图表 |
| 财务数据对比 | echarts | 功能完整、配置灵活、报表场景 |
| 时间序列趋势 | echarts | 支持多线、面积图、丰富交互 |
| 表格数据 | antd Table | 企业级、分页、排序、过滤 |
| 简单卡片 | CSS Modules | 无需库，性能最优 |

---

## 从数据到组件的映射

### 完整映射表

| 用户需求 | 后端 Skill | 返回字段 | 前端组件 | 展示形式 |
|---------|-----------|---------|---------|---------|
| 查询股票行情 | westock-quote / 行情数据查询 | price, chgPct, open, high, low, vol | **quote-card** | 卡片 |
| K线走势 | westock-quote / 行情数据查询 | time, open, high, low, close | **kline-chart** | 蜡烛图 + 均线 |
| 多标的对比 | 财务数据查询 | 各标的指标值 | **bar-chart** | 柱状图 |
| 趋势分析 | 宏观数据查询 / 指数数据查询 | 历史时间序列数据 | **line-chart** | 折线图 |
| 财务报表 | 财务数据查询 / 基本资料查询 | 结构化表格数据 | **data-table** | 表格 |
| 新闻资讯 | 新闻搜索 | title, summary, tags, publishTime | **news-list** | 新闻卡片列表 |
| 金融早报 | westock-research | 摘要数据 | **finance-breakfast** | 早报卡片 |
| AI热点 | 新闻搜索 (AI过滤) | 热点新闻数据 | **ai-hot-news** | 热闻列表 |
| 个股综合快照 | 行情数据查询 + 财务数据查询 | price, pe, pb, roe, sparkline, analystRating | **stock-snapshot** | 大字价格 + sparkline + 估值三表 |
| 板块涨跌热力图 | 行业数据查询 | name, chgPct, vol | **sector-heatmap** | ECharts Treemap，颜色=涨跌幅 |
| 研报评级汇总 | 研报搜索 | institution, rating, targetPrice, date | **research-consensus** | 评级分布横条 + 目标价区间 |
| 财务健康分析 | 财务数据查询 + 公司经营数据查询 | 多维指标数据 | **financial-health** | 4维度 2×2 仪表盘 |
| 情绪新闻流 | 新闻搜索 | title, summary, sentiment, relatedTickers | **news-feed** | Timeline + 情绪圆点 |

---

## 扩展新组件的完整流程

### 需求场景：添加"持仓分析"组件

#### 第 1 步：设计数据结构

后端团队定义返回格式：
```json
{
  "title": "持仓成本分析",
  "stocks": [
    {
      "code": "600519.SH",
      "name": "贵州茅台",
      "cost": 1200.00,
      "current": 1467.42,
      "profit": 267.42,
      "profitRate": 22.28,
      "shares": 100
    }
  ]
}
```

#### 第 2 步：定义前端类型

编辑 `src/shared/types/artifact.ts`：
```typescript
export interface HoldingPosition {
  code: string;
  name: string;
  cost: number;
  current: number;
  profit: number;
  profitRate: number;
  shares: number;
}

export interface PortfolioAnalysisData {
  title: string;
  stocks: HoldingPosition[];
}

// 更新 ArtifactType
export type ArtifactType = 
  | "quote-card"
  | "kline-chart"
  | "bar-chart"
  | "line-chart"
  | "data-table"
  | "news-list"
  | "portfolio-analysis";  // ← 新类型

// 更新 Artifact
export interface Artifact {
  id: string;
  type: ArtifactType;
  data: QuoteCardData |
        KLineChartData |
        PortfolioAnalysisData |  // ← 添加
        // ...
}
```

#### 第 3 步：创建组件

```bash
mkdir src/components/htui/PortfolioAnalysis
```

`PortfolioAnalysis.tsx`：
```typescript
import type { PortfolioAnalysisData } from "@/shared/types/artifact";
import { formatPrice, formatPercent } from "@/shared/lib/format";
import "./PortfolioAnalysis.css";

interface PortfolioAnalysisProps {
  data: PortfolioAnalysisData;
}

function PortfolioAnalysis({ data }: PortfolioAnalysisProps) {
  const totalProfit = data.stocks.reduce((sum, s) => sum + s.profit, 0);
  const avgProfitRate = 
    data.stocks.reduce((sum, s) => sum + s.profitRate, 0) / data.stocks.length;

  return (
    <div className="portfolio-analysis">
      <h3 className="portfolio-title">{data.title}</h3>
      
      <div className="portfolio-summary">
        <div className="summary-item">
          <span>总收益</span>
          <span className={`amount ${totalProfit >= 0 ? "up" : "down"}`}>
            ¥{formatPrice(totalProfit)}
          </span>
        </div>
        <div className="summary-item">
          <span>平均收益率</span>
          <span className={`percent ${avgProfitRate >= 0 ? "up" : "down"}`}>
            {formatPercent(avgProfitRate)}
          </span>
        </div>
      </div>

      <table className="portfolio-table">
        <thead>
          <tr>
            <th>股票</th>
            <th>持仓数</th>
            <th>成本价</th>
            <th>现价</th>
            <th>浮盈</th>
            <th>收益率</th>
          </tr>
        </thead>
        <tbody>
          {data.stocks.map((stock) => (
            <tr key={stock.code}>
              <td>{stock.code} {stock.name}</td>
              <td>{stock.shares}</td>
              <td>{formatPrice(stock.cost)}</td>
              <td>{formatPrice(stock.current)}</td>
              <td className={stock.profit >= 0 ? "up" : "down"}>
                {formatPrice(stock.profit)}
              </td>
              <td className={stock.profitRate >= 0 ? "up" : "down"}>
                {formatPercent(stock.profitRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PortfolioAnalysis;
```

`PortfolioAnalysis.css`：
```css
.portfolio-analysis {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  width: 100%;
}

.portfolio-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.portfolio-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-elevated);
  border-radius: 8px;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.summary-item span:first-child {
  color: var(--text-secondary);
  font-size: 12px;
}

.summary-item span:last-child {
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
}

.amount.up, .percent.up { color: var(--color-success); }
.amount.down, .percent.down { color: var(--color-danger); }

.portfolio-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.portfolio-table th {
  text-align: left;
  padding: 8px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

.portfolio-table td {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.portfolio-table td.up { color: var(--color-success); }
.portfolio-table td.down { color: var(--color-danger); }
```

#### 第 4 步：注册到路由器

编辑 `src/components/htui/ArtifactRenderer.tsx`：
```typescript
// 1. 导入
const PortfolioAnalysis = lazy(() => 
  import('./PortfolioAnalysis/PortfolioAnalysis')
);

// 2. 在 switch 中添加 case
function renderSingleArtifact(artifact: Artifact, index: number) {
  switch (artifact.type) {
    // ... 其他 case
    case 'portfolio-analysis':
      return (
        <PortfolioAnalysis 
          key={key} 
          data={artifact.data as PortfolioAnalysisData} 
        />
      );
    default:
      return null;
  }
}
```

#### 第 5 步：测试与文档

- 添加 JSDoc 注释
- 编写单元测试
- 更新前端架构文档

---

## 性能优化建议

### 1. 组件层面

```typescript
// ✅ 使用 React.memo 避免不必要的重渲染
const QuoteCard = React.memo(function QuoteCard({ data }) {
  return <div>...</div>;
});

// ✅ 使用 useMemo 缓存计算结果
const columns = useMemo(
  () => data.columns.map((col) => ({ ... })),
  [data.columns]
);

// ✅ 使用 useCallback 缓存函数
const handleClick = useCallback((id) => {
  // 处理点击
}, []);
```

### 2. 图表层面

```typescript
// ✅ lightweight-charts：响应式布局但不频繁更新
useEffect(() => {
  const ro = new ResizeObserver((entries) => {
    chart.applyOptions({ width: entries[0].contentRect.width });
  });
  ro.observe(container);
  return () => ro.disconnect();
}, [data]);

// ✅ echarts：仅在数据变化时重绘
<ReactECharts
  option={option}
  notMerge={false}  // 增量更新
  lazyUpdate={true}  // 延迟更新
/>
```

### 3. 列表层面

```typescript
// ✅ 大列表使用虚拟滚动
<Table
  columns={columns}
  dataSource={data.rows}
  virtual  // Ant Design v6 内置虚拟滚动
  scroll={{ x: 'max-content' }}
/>
```

### 4. 加载策略

```typescript
// ✅ 使用 React.lazy + Suspense 代码分割
const PortfolioAnalysis = lazy(() => 
  import('./PortfolioAnalysis/PortfolioAnalysis')
);

// ✅ 异步加载大型图表库
const chartLib = await import('echarts');
```

---

## 最佳实践总结

### 后端（Skill 开发）
- ✅ 遵守统一的返回格式（Artifact 规范）
- ✅ 字段命名保持一致性（与前端类型定义匹配）
- ✅ 支持自然语言查询（NLP 友好）
- ✅ 处理边界情况（空数据、超大数据）
- ✅ 性能优化（缓存、分页）

### 前端（组件开发）
- ✅ 类型安全第一（完整 TypeScript 定义）
- ✅ 单一职责（一个组件处理一种数据类型）
- ✅ 纯组件设计（无副作用、可预测）
- ✅ CSS 变量化（支持主题切换）
- ✅ 文档齐全（Props、示例、边界情况）

### 架构设计
- ✅ 类型驱动路由（消除错误匹配）
- ✅ 松耦合设计（后端和前端独立演进）
- ✅ 可扩展性（新 Skill、新组件易添加）
- ✅ 性能优先（代码分割、懒加载、缓存）
- ✅ 用户体验（加载态、错误处理、响应式）

---

## 常见扩展场景

### 场景 1：添加新的数据维度

例如：为 QuoteCard 添加技术指标（RSI、MACD）

```typescript
// 1. 扩展 QuoteCardData
export interface QuoteCardData {
  // ... 现有字段
  rsi?: number;      // RSI 指标
  macd?: {           // MACD 指标
    macd: number;
    signal: number;
    histogram: number;
  };
}

// 2. 在组件中条件渲染
{data.rsi && (
  <div className="indicator-row">
    <span>RSI</span>
    <span className={data.rsi > 70 ? 'overbought' : 'normal'}>
      {data.rsi.toFixed(2)}
    </span>
  </div>
)}
```

### 场景 2：跨组件联动

例如：点击 BarChart 中的柱子，显示相应的 QuoteCard

```typescript
// 在父组件使用 Context 或状态管理
const [selectedStock, setSelectedStock] = useState(null);

return (
  <>
    <BarChart 
      data={barData}
      onBarClick={(category) => setSelectedStock(category)}
    />
    {selectedStock && <QuoteCard data={quoteData} />}
  </>
);
```

### 场景 3：实时数据更新

例如：行情价格每 5 秒更新一次

```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const newData = await fetchQuoteData(code);
    setData(newData);
  }, 5000);
  
  return () => clearInterval(interval);
}, [code]);
```

---

## 故障排查指南

### 问题：组件未渲染

**原因**：
1. artifact.type 不匹配任何 case
2. 组件未正确 lazy import
3. 数据为空

**解决**：
```typescript
// 检查 type 是否在 ArtifactType 中
// 检查 lazy import 路径
// 在组件中添加空数据处理
if (!data || !data.items?.length) return null;
```

### 问题：样式未应用

**原因**：
1. CSS 变量未定义
2. CSS 类名拼写错误
3. CSS 加载顺序问题

**解决**：
```css
/* 确保 CSS 变量已在全局定义 */
:root {
  --bg-tertiary: #27272a;
  /* ... */
}

/* 检查类名 */
<div className="component-name">  /* ✅ 正确 */
```

### 问题：性能差（卡顿）

**原因**：
1. 不必要的重渲染
2. 图表频繁更新
3. 列表未虚拟化

**解决**：
```typescript
// 使用 React.memo
const Component = React.memo(({ data }) => ...);

// 使用 useMemo、useCallback
const value = useMemo(() => expensiveCalculation(), [deps]);

// 图表仅在数据变化时更新
<ReactECharts option={option} notMerge={false} />
```

---

## 文档索引

### 详细参考文档
| 文档 | 用途 |
|------|------|
| Sage_后端数据结构分析.md | Skill 返回字段、API 规范 |
| Sage_前端组件架构分析.md | 组件实现、样式、开发指南 |
| src/shared/types/artifact.ts | TypeScript 类型定义 |
| src/components/htui/ | 8 个组件实现 |
| package.json | 依赖清单、版本信息 |

### 快速参考
- 新增组件：参考前端架构分析 → 新组件开发指南
- 新增 Skill：参考后端数据结构分析 → 工具调用策略
- 类型查询：参考 src/shared/types/artifact.ts
- 样式规范：参考前端架构分析 → 样式方案

---

**文档完成**：本指南提供了从需求分析到组件开发的完整流程，涵盖架构设计、最佳实践、扩展指南和故障排查。

