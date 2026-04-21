# Sage 后端数据结构完整分析报告
**生成时间**: 2026-04-19
**范围**: 所有可用的 Skill 数据能力与字段映射

---

## 目录
1. [系统架构概览](#系统架构概览)
2. [数据源分类](#数据源分类)
3. [各 Skill 详细数据能力](#各skill详细数据能力)
4. [Artifact 组件类型](#artifact-组件类型)
5. [返回字段完整映射](#返回字段完整映射)
6. [工具调用策略](#工具调用策略)

---

## 系统架构概览

Sage 采用 **多数据源 + 多 Skill 协作** 的架构：

### 数据源组成
- **腾讯金融 API** (westock-* 系列): 实时行情、研报、市场数据
- **同花顺问财 API** (中文名 skill): 金融查询、财务数据、新闻搜索
- **Web 爬虫** (web-access): 联网访问第三方网站

### Skill 层级结构
```
├── Westock API (腾讯)
│   ├── westock-quote      [行情数据]
│   ├── westock-market     [市场总览]
│   ├── westock-research   [研报资讯]
│   └── westock-screener   [选股条件]
│
├── 同花顺问财 API (iWencai)
│   ├── 行情数据查询       [实时行情、技术指标]
│   ├── 财务数据查询       [财务指标、盈利能力]
│   ├── 行业数据查询       [板块排名、行业财务]
│   ├── 宏观数据查询       [GDP/CPI/PMI等]
│   ├── 指数数据查询       [指数行情]
│   ├── 基本资料查询       [静态信息]
│   ├── 基金理财查询       [基金业绩、持仓]
│   ├── 公司经营数据查询   [客户、供应商、业务]
│   ├── 研报搜索           [机构研报、评级]
│   ├── 新闻搜索           [财经新闻、资讯]
│   └── 公告搜索           [年报、分红、重组]
│
└── 其他
    ├── web-access         [Web 爬虫、联网操作]
    └── 定时任务管理       [监控告警]
```

---

## 数据源分类

| 分类 | 数据源 | 更新频率 | 覆盖范围 |
|------|--------|---------|---------|
| **实时行情** | 腾讯金融/同花顺 | 实时 | 股票/指数/ETF |
| **财务数据** | 同花顺问财 | 季度/年度 | A股、港股、美股 |
| **宏观指标** | 同花顺问财 | 月度/季度 | GDP/CPI/PMI 等 |
| **研报评级** | 腾讯/同花顺 | 实时 | 机构评级、目标价 |
| **新闻资讯** | 同花顺问财 | 实时 | 财经新闻、公告 |
| **基本资料** | 同花顺问财 | 实时 | 公司信息、基金详情 |

---

## 各Skill详细数据能力

### 1️⃣ **westock-quote** (腾讯行情数据)

**核心功能**: 获取股票、ETF、指数的实时行情、K线、技术指标、资金流向

#### 返回字段分组

**A. 实时行情价格** 
```
- ClosePrice          最新价 ✓
- OpenPrice           开盘价 ✓
- HighPrice           最高价 ✓
- LowPrice            最低价 ✓
- PrevClosePrice      昨收价 ✓
- Change              涨跌额 ✓
- ChangeRatio         涨跌幅(%) ✓
- LastestTradedPrice  最新成交价
- EndDate             数据日期
- SecuCode            证券代码
```

**B. 成交数据**
```
- TurnoverVolume      成交量
- TurnoverAmount      成交额
- TurnoverRate        换手率
```

**C. 技术指标**
```
- MA_5, MA_10, MA_20  均线 ✓
- MACD                MACD ✓
- KDJ_K/D/J           KDJ 指标 ✓
- RSI_6, RSI_12       RSI ✓
- BOLL_UPPER/LOWER    布林轨 ✓
```

**D. 筹码成本数据**
```
- ChipAvgCost         平均筹码成本 ✓
- ChipConcentration90 90%集中度 ✓
- ChipProfitRate      筹码收益率(%) ✓
```

**E. 资金流向** (需带 date 参数)
```
[A股]
- MainNetFlow         主力净流入(元) ✓
- JumboNetFlow        超大单净流入(元) ✓

[港股]
- TotalNetFlow        总净流入 ✓
- MainNetFlow         主力净流入 ✓
- ShortRatio          卖空比率(%) ✓
```

**F. 股东结构**
```
- Top10Shareholder    十大股东
- Top10FloatShareholder 十大流通股东
```

**G. 机构评级** ⭐ **关键字段**
```
- TargetPriceAvg      平均目标价 ✓✓✓
- RatingBuyCnt        买入评级数 ✓
- RatingCnt           总评级数
- ConEarningsForecast 一致预期净利润 ✓
- ConTargetPrice      一致预期目标价 ✓✓✓
```

**H. ETF 详情**
```
- EtfNav              单位净值
- EtfSize             基金规模
- EtfType             基金类型
- EtfTrackIndexName   跟踪指数
```

**I. 财报数据** (需带 date 参数，如 `2025-12-31`)
```
- TotalOperatingRevenue   营业总收入
- NPParentCompanyOwners   归母净利润
```

**J. 事件数据** (需带 date 参数，仅沪深)
```
- LhbInfos            龙虎榜信息
- LhbTradingDetails   龙虎榜交易明细
- BlockTradingInfos   大宗交易
- MarginTradeInfos    融资融券
```

#### API 路由
- `stock_quote_snapshot` - 批量查询快照 (codes 参数)
- `stock_quote_history` - 历史 K 线 (code 参数)

---

### 2️⃣ **westock-market** (腾讯市场总览)

**核心功能**: 热搜股票、热门板块、新股日历、投资日历

#### 返回字段

**A. 热搜股票**
```
- code            股票代码
- name            股票名称
- zdf             涨跌幅(%)
- zxj             最新价
- stock_type      类型
```

**B. 热门板块** (板块字段 `bd_*` 前缀)
```
- bd_name         板块名称 ✓
- bd_code         板块代码 ✓
- bd_zdf          今日涨跌幅(%) ✓✓
- bd_zdf5/20/60   5日/20日/60日涨跌幅 ✓
- bd_hsl          换手率(%) ✓
- nzg_code        领涨股代码 ✓
- nzg_name        领涨股名称 ✓
- nzg_zdf         领涨股涨幅 ✓
```

**C. 资金流向**
```
- code            板块代码
- name            板块名称
- zdf             涨跌幅
- zllr            主力流入(万元) ✓
- zllc            主力流出(万元)
- zljlr           主力净流入(万元) ✓
```

**D. 新股日历**
```
- symbol          股票代码
- name            股票名称
- price           发行价 ✓
- syl             市盈率
- ssrq            上市日期 ✓
- sgdm            申购代码
```

**E. 投资日历**
```
- time            发生时间
- Weightiness     重要程度 (1-3，3最高) ✓
- CountryName     国家
- FinancialEvent  事件描述 ✓
- Previous        前值 ✓
- Predict         预测值 ✓
- CurrentValue    实际值 ✓
```

**F. 股单排行**
```
- 股单名称
- 关注人数
- 收益率
```

---

### 3️⃣ **westock-research** (腾讯研报资讯)

**核心功能**: 个股研报、公告查询、新闻资讯

#### 返回字段

**A. 个股研报** ⭐ **关键字段**
```
- id              研报ID
- title           标题
- time            发布时间
- typeStr         类型 (如"年度点评")
- type            1=研报, 2=业绩会
- src             来源机构 ✓
- tzpj            投资评级 (买入/增持/持有/减持/卖出) ✓✓
- summary         摘要 ✓
```

**B. 精选研报**
```
- id              研报ID
- title           标题
- preview         摘要
- publish_time    发布时间 (毫秒戳)
- img             封面图
- has_more        是否有更多
```

**C. 公告列表**
```
- id              公告ID
- title           标题
- time            时间
- type            类型
- newstype        细分类代码
```

**D. 公告正文**
```
[A股普通公告]
- detail          纯文本内容

[大型公告]
- pdf             PDF URL

[港美股]
- pdf             PDF URL
- content_tr      翻译内容
```

**E. 市场资讯/新闻** ✓ **返回字段**
```
- time            发布时间
- title           新闻标题 ✓
- src             来源媒体 ✓
- importance      重要程度 (0=普通, 1=重要)
- summary         摘要/正文 ✓
- url             新闻链接
- title_mention   涉及股票代码
```

---

### 4️⃣ **westock-screener** (腾讯选股/宏观)

**核心功能**: 条件筛选、指数成份、宏观数据

#### 返回字段

**A. 选股筛选结果**
```
- code            股票代码 ✓
- name            股票名称 ✓
- ClosePrice      股价
- ChangePCT       涨幅(%) ✓
- PE_TTM          市盈率 ✓✓
- PB              市净率 ✓✓
- TotalMV         总市值 ✓
- CircMV          流通市值
- ROE_TTM         ROE(%) ✓✓
- MA_5/10/20      均线
- RSI_6           RSI
```

**B. 指数/板块成份**
```
- IndexCode       指数代码
- IndexName       指数名称
- SectorCode      板块代码
- SectorName      板块名称
- StockCode       成份股代码
- StockName       成份股名称
```

**C. 宏观数据** ⭐ **关键指标**

```
[PMI]
- PMI_MANU                       制造业PMI ✓
- PMI_NON_MANU_BUSINESS_ACTIVITY 非制造业PMI ✓
- PMI_COMPREHENSIVE_CCZS         综合PMI ✓
- PMI_ENDDATE                    数据日期

[GDP]
- REAL_GDP_CUR_YOY       当季同比(%) ✓
- NOMINAL_GDP_CUR        名义当季(万亿) ✓
- GDP_ENDDATE            数据日期

[CPI/PPI]
- CPI_YOY                CPI同比(%) ✓✓
- CPI_YOY_FOOD           食品CPI同比
- PPI_YOY                PPI同比(%) ✓✓
- PPIRM_YOY              原材料PPI同比

[货币供应]
- M0                     现金 ✓
- M1                     狭义货币 ✓
- M2                     广义货币 ✓✓
- M0_YOY / M1_YOY / M2_YOY  同比增速

[社会消费]
- CONSUMP_CUR            当期社会消费 ✓
- CONSUMP_CUM_YOY        累计同比增速

[社融规模]
- 新增社融总额           ✓

[工业利润]
- 工业企业利润           ✓
```

---

### 5️⃣ **行情数据查询** (同花顺 - 自然语言)

**API**: `https://openapi.iwencai.com/v1/query2data`

#### 返回字段示例
```json
{
  "datas": [
    {
      "股票代码": "300033.SZ",
      "股票简称": "同花顺",
      "最新价": "120.50",
      "涨跌幅": "2.35%",
      "成交量": "1234万手",
      "换手率": "3.2%",
      "主力净流入": "1234万元",
      "技术指标": "..."
    }
  ],
  "code_count": 5236,
  "chunks_info": {},
  "status_code": 0
}
```

#### 典型字段
- 股票代码、股票简称
- 最新价、涨跌幅、成交量
- 换手率、技术指标、资金流向

---

### 6️⃣ **财务数据查询** (同花顺 - 自然语言)

**核心能力**: 查询财务指标、盈利能力、偿债能力、现金流

#### 返回字段
```
[盈利指标]
- 营业收入 / 营收          ✓✓
- 净利润 / 归母净利润        ✓✓
- 毛利率 / 毛利             ✓
- 净利率                   ✓
- 营业利润                 ✓

[回报指标]
- ROE (净资产收益率)         ✓✓
- ROA                      ✓
- ROIC                     

[偿债指标]
- 负债率                   ✓✓
- 资产负债率                ✓
- 流动比率                  ✓

[现金流]
- 经营性现金流              ✓
- 投资性现金流              ✓
- 自由现金流                ✓
- 现金流比率                

[估值指标]
- 市盈率 (PE)               ✓✓
- 市净率 (PB)               ✓✓
- 市销率 (PS)               ✓
- EV/EBITDA
```

---

### 7️⃣ **行业数据查询** (同花顺 - 自然语言)

**核心能力**: 行业估值、财务对比、板块排名

#### 返回字段
```
- 行业名称                 ✓
- 行业估值 (PE/PB)          ✓✓
- 涨跌幅                   ✓
- 板块排名                 ✓
- 行业财务指标              ✓
- 行业盈利数据              ✓
- 行业ROE平均值             ✓
```

---

### 8️⃣ **宏观数据查询** (同花顺 - 自然语言)

**覆盖指标**:
```
- GDP (名义/实际/YoY)       ✓✓
- CPI / PPI (YoY)          ✓✓
- PMI (制造业/非制造业)      ✓✓
- M2 / M1 / M0 (货币供应)   ✓✓
- 利率 (LPR/存款/贷款)       ✓
- 汇率                     ✓
- 社融规模                 ✓
- 工业增加值                ✓
- 消费/投资/进出口          ✓
```

---

### 9️⃣ **指数数据查询** (同花顺 - 自然语言)

**覆盖指数**:
```
[A股]
- 上证指数、深证成指、创业板指     ✓
- 沪深300、中证500、上证50        ✓

[香港]
- 恒生指数、恒生科技              ✓

[美国]
- 纳斯达克、道琼斯、标普500       ✓

[返回字段]
- 指数名称
- 最新点位 / 最新价
- 涨跌幅 (%)
- 成交量
- 开高低收价
```

---

### 🔟 **基本资料查询** (同花顺 - 自然语言)

**覆盖品类**: 股票、指数、基金、期货、期权、转债、债券

#### 返回字段
```
[股票基本信息]
- 股票代码、股票简称
- 上市日期                  ✓✓
- 所属行业                  ✓
- 上市板块 (主板/创业板/科创)
- 注册资本                  ✓
- 总股本 / 流通股本           ✓

[股东结构]
- 实际控制人                ✓
- 董事长、总经理
- 十大股东                  ✓

[基金基本信息]
- 基金代码、基金名称
- 基金类型 (混合/债券/股票)
- 基金经理                  ✓
- 基金规模                  ✓
- 费率 (管理费/托管费)       ✓✓
- 成立日期                  ✓

[债券信息]
- 债券代码、名称
- 发行主体                  ✓
- 票面利率                  ✓
- 到期日期                  ✓
- 评级                      ✓
```

---

### 1️⃣1️⃣ **基金理财查询** (同花顺 - 自然语言)

#### 返回字段
```
- 基金代码、基金名称
- 基金类型
- 基金经理                  ✓
- 成立以来收益              ✓✓
- 近1年/3年/5年收益率        ✓
- 基金规模                  ✓
- 净值                      ✓
- 风险等级                  ✓
- 基金公司                  ✓
- 持仓前十大股票             ✓
```

---

### 1️⃣2️⃣ **研报搜索** (同花顺)

**API**: `/v1/comprehensive/search` (channels: ["report"])

#### 返回字段
```
- 研报标题                  ✓
- 发布时间                  ✓
- 来源机构                  ✓
- 投资评级 (买入/增持/持有/减持/卖出)  ✓✓
- 目标价                    ✓✓
- 摘要                      ✓
- 分析逻辑                  ✓
- 风险提示                  ✓
```

---

### 1️⃣3️⃣ **新闻搜索** (同花顺)

**API**: `/v1/comprehensive/search` (channels: ["news"])

#### 返回字段
```
- 新闻标题                  ✓
- 发布时间                  ✓
- 来源媒体                  ✓
- 摘要 / 正文                ✓
- 新闻链接                  ✓
- 涉及标的代码               ✓
- 重要程度标签               ✓
```

---

### 1️⃣4️⃣ **公告搜索** (同花顺)

**API**: `/v1/comprehensive/search` (channels: ["announcement"])

#### 返回字段
```
- 公告标题                  ✓
- 公告类型 (财报/分红/重组等)
- 发布时间                  ✓
- 发布主体                  ✓
- 公告摘要                  ✓
- 公告链接                  ✓
- 完整内容 (纯文本/PDF)
```

**公告类型**:
- 定期财务报告 (年报/季报/半年报)
- 分红派息、股权激励
- 回购增持、重大合同
- 资产重组、融资事项
- 业绩预告、重大事项

---

### 1️⃣5️⃣ **公司经营数据查询** (同花顺 - 自然语言)

#### 返回字段
```
- 股票代码、股票简称
- 主营业务类型              ✓
- 主营业务收入占比           ✓

[主要客户]
- 客户名称                  ✓
- 销售金额                  ✓
- 销售占比                  ✓

[主要供应商]
- 供应商名称                ✓
- 采购金额                  ✓
- 采购占比                  ✓

[参控股公司]
- 子公司名称                ✓
- 持股比例                  ✓
- 经营范围

[股权投资]
- 被投资公司                ✓
- 投资比例                  ✓

[重大合同]
- 合同类型                  ✓
- 合同金额                  ✓
- 生效日期                  ✓
```

---

## Artifact 组件类型

**共6种官方组件类型**:

| 组件类型 | 用途 | 返回字段 |
|---------|------|---------|
| **quote-card** | 行情卡片 | code, name, price, chgVal, chgPct, prevClose, open, high, low, vol, turnover, mktCap |
| **kline-chart** | K线图表 | code, name, ktype, data[{time, open, high, low, close, vol}] |
| **bar-chart** | 柱状图 | title, categories, series[{name, data}], unit |
| **line-chart** | 折线图 | title, xAxis, series[{name, data}], unit |
| **data-table** | 数据表格 | title, columns[{key, label}], rows[{}] |
| **news-list** | 新闻列表 | items[{newId, title, summary, tags, publishTime}], total, hasMore |

---

## 返回字段完整映射

### 按数据维度分类

#### 📈 **行情数据字段** (所有 skill 通用)
```
实时价格:
  - price / 最新价 / ClosePrice
  - open / 开盘价 / OpenPrice
  - high / 最高价 / HighPrice
  - low / 最低价 / LowPrice
  - prevClose / 昨收 / PrevClosePrice
  - chgVal / Change
  - chgPct / ChangeRatio / 涨跌幅

成交数据:
  - vol / TurnoverVolume
  - turnover / TurnoverAmount
  - 换手率 / TurnoverRate

时间标记:
  - time / date / EndDate / 发布时间
```

#### 💰 **财务数据字段** (财务/基本资料 skill)
```
盈利能力:
  - 营业收入 / revenue / TotalOperatingRevenue
  - 净利润 / profit / NPParentCompanyOwners
  - ROE / ROE_TTM
  - 毛利率 / 净利率
  
估值指标:
  - PE / PE_TTM / 市盈率
  - PB / 市净率
  - PS / 市销率
  
财务状况:
  - 负债率 / 资产负债率
  - 现金流 / 流动性指标
```

#### 🎯 **投资建议字段** (研报/评级 skill)
```
投资评级:
  - 投资评级 (买入/增持/持有/减持/卖出)
  - RatingBuyCnt / 买入评级数
  - tzpj / 评级标签

目标价格:
  - TargetPriceAvg / 平均目标价
  - ConTargetPrice / 一致预期目标价
  - 目标价

风险:
  - 风险提示
  - 风险等级
```

#### 🌍 **宏观数据字段** (宏观/行业 skill)
```
经济增长:
  - REAL_GDP_CUR_YOY / GDP
  - 工业增加值
  - 消费/投资增速

物价:
  - CPI_YOY / CPI
  - PPI_YOY / PPI
  - 食品价格指数

金融:
  - M0 / M1 / M2
  - 利率 (LPR/存款利率)
  - 汇率

景气:
  - PMI (制造业/非制造业)
  - 社融规模
  - 新增信贷
```

---

## 工具调用策略

### 意图 → Skill 路由表

| 用户意图 | 优先 Skill | 次选 | 返回字段重点 |
|---------|-----------|------|-----------|
| 股价、涨跌、成交量 | 行情数据查询 | westock-quote | price, chgPct, vol |
| K线、走势图 | westock-quote | 行情数据查询 | time, open, high, low, close |
| 技术指标 (MACD/KDJ) | westock-quote | 行情数据查询 | MACD, KDJ, RSI, BOLL |
| **目标价、评级** ⭐ | 研报搜索 | westock-quote | TargetPriceAvg, tzpj, ConTargetPrice |
| **板块涨跌幅数据** ⭐ | westock-market | 行业数据查询 | bd_zdf, bd_zdf5 |
| **财务指标** (营收/净利) | 财务数据查询 | westock-quote | 营业收入, 净利润, ROE |
| PE/PB/ROE 估值 | 财务数据查询 | westock-screener | PE_TTM, PB, ROE_TTM |
| 宏观数据 (GDP/CPI) | 宏观数据查询 | westock-screener | GDP, CPI_YOY, M2 |
| 行业对比、排名 | 行业数据查询 | westock-market | 行业名称, 涨跌幅, 板块排名 |
| 基金业绩、持仓 | 基金理财查询 | - | 净值, 收益率, 持仓股票 |
| 研报、分析 | 研报搜索 | westock-research | 标题, 评级, 目标价, 摘要 |
| 新闻资讯 | 新闻搜索 | westock-research | 标题, 摘要, 来源, 发布时间 |
| 公告 (年报/分红) | 公告搜索 | westock-research | 公告标题, 类型, 内容 |
| 基本信息 (上市日期) | 基本资料查询 | - | 代码, 名称, 上市日期, 行业 |
| 主力资金、大单 | 行情数据查询 | westock-quote | MainNetFlow, JumboNetFlow |
| 主营业务、客户 | 公司经营数据查询 | - | 主营业务, 客户名称, 供应商 |

---

## 关键字段识别

### 🌟 **最常用字段** (优先级最高)

```
必须字段:
  ✓✓✓ 股票代码 / code
  ✓✓✓ 股票名称 / name
  ✓✓✓ 最新价 / price / ClosePrice
  ✓✓✓ 涨跌幅 / chgPct / ChangeRatio
  ✓✓✓ 目标价 / TargetPriceAvg / ConTargetPrice
  ✓✓✓ 投资评级 / tzpj

高频字段:
  ✓✓ 成交量 / vol / TurnoverVolume
  ✓✓ PE / PE_TTM
  ✓✓ PB / 市净率
  ✓✓ ROE / ROE_TTM
  ✓✓ 净利润 / profit
  ✓✓ 营业收入 / revenue
  ✓✓ K线数据 {time, open, high, low, close}
  ✓✓ 板块涨跌幅 / bd_zdf
  ✓✓ PMI / GDP / CPI / M2
  ✓✓ 基金收益率
  ✓✓ 研报摘要 / summary
  ✓✓ 新闻标题 / title

常用字段:
  ✓ 换手率 / TurnoverRate
  ✓ 主力净流入 / MainNetFlow
  ✓ 技术指标 (MACD/KDJ/RSI/BOLL)
  ✓ 上市日期 / ListedDate
  ✓ 基金经理
  ✓ 筹码数据 / ChipAvgCost
```

---

## 常见问题解答

**Q: 能否获取评级和目标价?**
A: ✓ 可以。通过 `研报搜索` skill (同花顺) 或 `westock-quote` (腾讯)，返回字段: `TargetPriceAvg`, `ConTargetPrice`, `tzpj`, `RatingBuyCnt`

**Q: 能否获取板块涨跌幅数据?**
A: ✓ 可以。通过 `westock-market` 的 `板块排行` 接口，返回字段: `bd_zdf`, `bd_zdf5`, `bd_hsl`，或使用 `行业数据查询`

**Q: 能否获取主力资金流向?**
A: ✓ 可以。通过 `行情数据查询` 或 `westock-quote`，返回字段: `MainNetFlow`, `JumboNetFlow`

**Q: 宏观数据有哪些?**
A: ✓ 通过 `宏观数据查询` 或 `westock-screener`，包括: GDP, CPI, PPI, PMI, M2, 社融, 利率, 汇率等

**Q: 是否支持实时更新?**
A: ✓ 行情数据实时更新。财务/宏观数据按季度/月度更新

---

## 版本历史

- **v2.0** (2026-04-19): 完整数据能力分析，涵盖所有15个Skill
- **v1.0** (2026-04-15): 初始文档

---

## 关键文件位置

- **Skill 文档**: `/Users/nakocai/.htclaw/skills/*/SKILL.md`
- **Westock Skill**: `/Users/nakocai/Documents/Projects/Start/Sage/htclaw-app/src-api/resources/skills/westock-*/`
- **工具策略**: `/Users/nakocai/.htclaw/AGENTS.md` (## 工具调用策略 部分)

