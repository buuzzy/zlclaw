# westock-data API 文档

> 腾讯金融行情数据 API，HTClaw 专用数据源。

## 基本信息

- **API Key**: `30fc4280ff39cf4caa1c909cc8778af5ed6f3de82e6ff5b4768d4906ca079f0e`
- **Base URL**: `https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy`
- **协议**: HTTPS POST
- **数据格式**: JSON

---

## 请求格式

### Query 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `app` | ✅ | 固定值 `openclaw` |
| `token` | ✅ | API Key |
| `skill_channel` | ✅ | 固定值 `stockclaw` |

### 请求体 (JSON)

```json
{
  "token": "<APIKEY>",
  "route": "<路由名称>",
  "params": {
    "codes": "sh600519",
    "fields": "ClosePrice,OpenPrice,...",
    "date": "2026-04-17"   // 可选，日期筛选
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `token` | string | API Key |
| `route` | string | 数据路由名称 |
| `params.codes` | string | 股票代码，逗号分隔（如 `sh600519,sh000001`） |
| `params.fields` | string | 返回字段列表，逗号分隔 |
| `params.date` | string | 可选，日期筛选（YYYY-MM-DD） |

### 响应格式

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "stocks": [
      {
        "code": "sh600519",
        "name": "贵州茅台",
        "data": {
          "ClosePrice": "1407.24",
          ...
        }
      }
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| `code` | 0 = 成功，非 0 = 失败 |
| `msg` | 错误信息 |
| `data.stocks[].code` | 股票代码 |
| `data.stocks[].name` | 股票名称 |
| `data.stocks[].data` | 字段数据 |

---

## 已验证路由 & 字段

### 1. 实时行情快照 `stock_quote_snapshot`

最核心的路由，通过不同的 `fields` 组合返回各类数据。

#### 1.1 行情价格

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `ClosePrice` | 最新价/收盘价 | `"1407.24"` |
| `OpenPrice` | 开盘价 | `"1400.00"` |
| `PrevClosePrice` | 昨收价 | `"1390.00"` |
| `HighPrice` | 最高价 | `"1415.00"` |
| `LowPrice` | 最低价 | `"1395.00"` |
| `LastestTradedPrice` | 最新成交价 | `"1407.24"` |
| `FwdClosePrice` | 复权收盘价 | `"1407.24"` |
| `FwdHighPrice` | 复权最高价 | `"1415.00"` |
| `FwdLowPrice` | 复权最低价 | `"1395.00"` |
| `FwdOpenPrice` | 复权开盘价 | `"1400.00"` |
| `Change` | 涨跌额 | `"17.24"` |
| `ChangeRatio` | 涨跌幅(%) | `"1.24"` |
| `EndDate` | 数据日期 | `"2026-04-17"` |
| `SecuCode` | 证券代码 | `"sh600519"` |

**请求示例**：
```json
{
  "token": "30fc4280ff39cf4caa1c909cc8778af5ed6f3de82e6ff5b4768d4906ca079f0e",
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600519,sh000001",
    "fields": "ClosePrice,Change,ChangeRatio,PrevClosePrice,OpenPrice,HighPrice,LowPrice"
  }
}
```

**响应示例**：
```json
{
  "code": 0,
  "data": {
    "stocks": [
      {
        "code": "sh600519",
        "name": "贵州茅台",
        "data": {
          "ClosePrice": "1407.24",
          "Change": "17.24",
          "ChangeRatio": "1.24",
          "EndDate": "2026-04-17",
          "LastestTradedPrice": "1407.24",
          "SecuCode": "sh600519"
        }
      },
      {
        "code": "sh000001",
        "name": "上证指数",
        "data": {
          "ClosePrice": "4051.43",
          "EndDate": "2026-04-17",
          "LastestTradedPrice": "4051.43",
          "SecuCode": "sh000001"
        }
      }
    ]
  }
}
```

---

#### 1.2 技术指标

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `MA_5` | 5日均线 | `"1445.558"` |
| `MA_10` | 10日均线 | `"1450.728"` |
| `MA_20` | 20日均线 | — |
| `MACD` | MACD | `"-3.2359"` |
| `KDJ_K` | KDJ K值 | `"45.8812"` |
| `KDJ_D` | KDJ D值 | — |
| `KDJ_J` | KDJ J值 | — |
| `RSI_6` | RSI(6) | `"28.9642"` |
| `RSI_12` | RSI(12) | — |
| `BOLL_UPPER` | 布林上轨 | — |
| `BOLL_LOWER` | 布林下轨 | — |

**请求示例**：
```json
{
  "token": "30fc4280ff39cf4caa1c909cc8778af5ed6f3de82e6ff5b4768d4906ca079f0e",
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600519",
    "fields": "MA_5,MA_10,MACD,KDJ_K,RSI_6"
  }
}
```

---

#### 1.3 筹码成本

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `ChipAvgCost` | 平均筹码成本 | `"1432.06"` |
| `ChipConcentration90` | 90%筹码集中度 | `"5.71"` |
| `ChipProfitRate` | 筹码收益率(%) | `"27.04"` |

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600519",
    "fields": "ChipAvgCost,ChipConcentration90,ChipProfitRate"
  }
}
```

---

#### 1.4 A股资金流向

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `MainNetFlow` | 主力净流入(元) | `"-50688248.00"` |
| `JumboNetFlow` | 超大单净流入(元) | `"-65056485.00"` |

> ⚠️ 需配合 `date` 参数指定日期。

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600000",
    "date": "2026-04-17",
    "fields": "MainNetFlow,JumboNetFlow"
  }
}
```

---

#### 1.5 港股资金流向

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `TotalNetFlow` | 总净流入(港元) | `"-55419100.00"` |
| `MainNetFlow` | 主力净流入(港元) | `"-265784050.00"` |
| `ShortRatio` | 卖空比率(%) | `"17.49"` |

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "hk00700",
    "date": "2026-04-17",
    "fields": "TotalNetFlow,MainNetFlow,ShortRatio"
  }
}
```

---

#### 1.6 公司简况

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `CompanyName` | 公司全称 | `"贵州茅台酒股份有限公司"` |
| `ListedDate` | 上市日期 | `"2001-08-27"` |
| `MainBusiness` | 主营业务 | `"贵州茅台酒系列产品的生产与销售..."` |
| `SW1Name` | 申万一级行业 | `"食品饮料"` |

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600519",
    "fields": "CompanyName,ListedDate,MainBusiness,SW1Name"
  }
}
```

---

#### 1.7 机构评级

| 字段名 | 说明 |
|--------|------|
| `TargetPriceAvg` | 平均目标价 |
| `RatingBuyCnt` | 买入评级数 |
| `RatingCnt` | 总评级数 |

> ⚠️ 无数据时返回空 `data: {}`

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh600519",
    "fields": "TargetPriceAvg,RatingBuyCnt,RatingCnt"
  }
}
```

---

#### 1.8 一致预期

| 字段名 | 说明 |
|--------|------|
| `ConEarningsForecast` | 一致预期净利润 |
| `ConTargetPrice` | 一致预期目标价 |

---

#### 1.9 股东结构

| 字段名 | 说明 |
|--------|------|
| `Top10Shareholder` | 十大股东 |
| `Top10FloatShareholder` | 十大流通股东 |

---

#### 1.10 龙虎榜

| 字段名 | 说明 |
|--------|------|
| `LhbInfos` | 龙虎榜信息 |
| `LhbTradingDetails` | 龙虎榜交易明细 |

> ⚠️ 需配合 `date` 参数。仅沪深。

---

#### 1.11 大宗交易

| 字段名 | 说明 |
|--------|------|
| `BlockTradingInfos` | 大宗交易记录 |

> ⚠️ 需配合 `date` 参数。仅沪深。

---

#### 1.12 融资融券

| 字段名 | 说明 |
|--------|------|
| `MarginTradeInfos` | 两融数据 |

> ⚠️ 需配合 `date` 参数。仅沪深。

---

#### 1.13 业绩预告

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `PerformanceReserve` | 业绩预告 JSON | 详见下方 |

**响应格式**：
```json
{
  "PerformanceReserve": "[{\"ReserveDisclosureDate\":\"20260425\",\"ReserveDisclosureDesc\":\"公司预计于2026-04-25披露2026第一季报\",\"ReserveDisclosureEndDate\":\"20260331\"}]"
}
```

---

#### 1.14 分红方案

| 字段名 | 说明 |
|--------|------|
| `DividendPlans` | 分红方案 |

---

#### 1.15 风险事件

| 字段名 | 说明 |
|--------|------|
| `SpecialTrade` | 特别处理/风险警示 |
| `SharesPledge` | 股份质押 |

---

#### 1.16 ETF详情

| 字段名 | 说明 | 示例值 |
|--------|------|--------|
| `EtfNav` | 单位净值 | `"4.6957"` |
| `EtfSize` | 基金规模(元) | `"206237434092.89"` |
| `EtfType` | 基金类型 | `"规模"` |
| `EtfTrackIndexName` | 跟踪指数 | `"沪深300"` |
| `ListedDate` | 上市日期 | `"2012-05-28"` |

**请求示例**：
```json
{
  "route": "stock_quote_snapshot",
  "params": {
    "codes": "sh510300",
    "fields": "EtfNav,EtfSize,EtfType,EtfTrackIndexName"
  }
}
```

---

#### 1.17 ETF持仓

| 字段名 | 说明 |
|--------|------|
| `EtfPrlistDetail` | 重仓股明细 |
| `EtfPrlistDate` | 重仓股日期 |

---

#### 1.18 财报数据

| 字段名 | 说明 |
|--------|------|
| `TotalOperatingRevenue` | 营业总收入 |
| `NPParentCompanyOwners` | 归母净利润 |

> ⚠️ 需配合 `date` 参数指定财报期（如 `2025-12-31`）。

---

## 2. 历史数据 `stock_quote_history`

历史K线、分红、股东户数等时间序列数据。**注意：单码模式（`code` 非 `codes`），日期用 `start_date`/`end_date`**。

### 2.1 K线

| 参数 | 说明 |
|------|------|
| `code` | 股票代码（单码，非 `codes`） |
| `start_date` | 开始日期（YYYY-MM-DD） |
| `end_date` | 结束日期（YYYY-MM-DD） |
| `fields` | 字段列表 |

**请求示例**：
```json
{
  "route": "stock_quote_history",
  "params": {
    "code": "sh600519",
    "start_date": "2026-04-04",
    "end_date": "2026-04-17",
    "fields": "OpenPrice,ClosePrice,HighPrice,LowPrice,TurnoverVolume"
  }
}
```

**响应格式**（`series` 数组，每天一条）：
```json
{
  "code": 0,
  "data": {
    "code": "sh600519",
    "name": "贵州茅台",
    "series": [
      {
        "date": "2026-04-07",
        "data": {
          "ClosePrice": "1440.02",
          "HighPrice": "1470.00",
          "LowPrice": "1435.05",
          "OpenPrice": "1460.05",
          "TurnoverVolume": "24152"
        }
      }
    ]
  }
}
```

### 2.2 分红历史

**fields**: `DividendPlans`

```json
{
  "route": "stock_quote_history",
  "params": {
    "code": "sh600519",
    "start_date": "2025-04-17",
    "end_date": "2026-04-17",
    "fields": "DividendPlans"
  }
}
```

### 2.3 股东户数

**fields**: `SHNum`（返回 JSON 字符串）

```json
{
  "route": "stock_quote_history",
  "params": {
    "code": "sh600519",
    "start_date": "2025-04-17",
    "end_date": "2026-04-17",
    "fields": "SHNum"
  }
}
```

### 2.4 其他历史字段

| 字段 | 说明 |
|------|------|
| `BuybackAttach` | 公司回购 |
| `SharesUnlock` | 解禁数据 |
| `LawSuit` | 诉讼风险 |

---

## 3. 筛选查询 `stock_filter_query` ✅

**功能**：条件筛选股票（涨停、跌停、停牌、涨幅区段、估值筛选等）

**请求格式**：
```json
{
  "route": "stock_filter_query",
  "params": {
    "selector": {
      "expression": "<表达式>",
      "date": "2026-04-17",
      "limit": 100
    },
    "fields": [
      {"metric": "SecuCode", "name": "代码"},
      {"metric": "StockName", "name": "名称"},
      {"metric": "ClosePrice", "name": "价格"},
      {"metric": "ChangePCT", "name": "涨幅"},
      {"metric": "PE_TTM", "name": "PE"}
    ]
  }
}
```

**selector.expression 语法**：
| 表达式 | 说明 |
|--------|------|
| `TotalMV > 0` | 全部股票 |
| `intersect([ClosePrice = PriceCeiling, PriceCeiling > 0])` | 涨停 |
| `intersect([ClosePrice = PriceFloor, PriceFloor > 0])` | 跌停 |
| `intersect([ChangePCT > 5, ChangePCT <= 7])` | 涨幅 5-7% |
| `intersect([ChangePCT > 2, PE_TTM < 20, PE_TTM > 0])` | 涨幅>2%且PE<20 |
| `intersect([Ifsuspend = 1])` | 停牌 |

**响应格式**：
```json
{
  "code": 0,
  "data": {
    "component_data": {
      "total_stocks": 69,
      "data": {
        "columns": [{"display_name": "最新价", "enable_sort": true}],
        "stocks": [{
          "code": "sh688807",
          "name": "优迅股份",
          "secu_type": "GP-A-KCB",
          "condition_values": [{"disp": "363.19", "raw": "363.19"}, {"disp": "+20.00%", "raw": "20.00"}]
        }]
      },
      "selection_desc": "该策略回测1年的收益为: 42.82%"
    },
    "analyze_data": {"data": [{"code": "sh688807", "name": "优迅股份", "type": "stock"}]}
  }
}
```

**响应字段**：
| 路径 | 说明 |
|------|------|
| `component_data.total_stocks` | 符合条件总数 |
| `component_data.data.stocks[].code` | 股票代码 |
| `component_data.data.stocks[].name` | 股票名称 |
| `component_data.data.stocks[].condition_values` | 字段值数组，与 fields 顺序对应 |
| `component_data.data.columns[].display_name` | 列名 |
| `component_data.selection_desc` | AI 策略回测收益说明 |
| `analyze_data.data[]` | AI 分析的股票列表 |

---

## 4. 列表数据 `query_list_data_by_date` ✅

**功能**：指数/板块列表、陆股通成份、宏观指标

**请求格式**：
```json
{
  "route": "query_list_data_by_date",
  "params": {
    "list_codes": ["<list_code>"],
    "date": "2026-04-17"
  }
}
```

### 4.1 指数/板块类

| list_code | 说明 | 字段 |
|-----------|------|------|
| `index_list` | 有行情指数清单 ✅ | `IndexCode`, `IndexName` |
| `industry_list_sw1` | 申万一级行业 ✅ | `SectorCode`, `SectorName` |
| `industry_list_sw2` | 申万二级行业 | `SectorCode`, `SectorName` |
| `industry_list_sw3` | 申万三级行业 | `SectorCode`, `SectorName` |
| `sh_connected_stocks` | 沪股通成份股 ✅ | `StockCode`, `StockName` |
| `sz_connected_stocks` | 深股通成份股 ✅ | `StockCode`, `StockName` |
| `comp_sw1_<板块编码>` | 申万一级板块成份股 | `StockCode`, `StockName` |
| `comp_sw2_<板块编码>` | 申万二级板块成份股 | `StockCode`, `StockName` |
| `comp_sw3_<板块编码>` | 申万三级板块成份股 | `StockCode`, `StockName` |

### 4.2 宏观数据类

| list_code | 说明 | 关键字段 |
|-----------|------|---------|
| `macro_pmi` | PMI制造业指数 ✅ | `PMI_MANU`, `PMI_NON_MANU_*`, `PMI_ENDDATE` |
| `macro_gdp` | GDP数据 ✅ | `REAL_GDP_CUR_YOY`, `NOMINAL_GDP_CUM`, `GDP_ENDDATE` |
| `macro_cpi_ppi` | CPI/PPI ✅ | `CPI_YOY`, `PPI_YOY`, `PPIRM_YOY` |
| `macro_profit` | 工业企业利润 ✅ | — |
| `macro_consumption` | 社会消费品零售 ✅ | `CONSUMP_CUR`, `CONSUMP_CUM_YOY` |
| `macro_financing` | 社会融资规模 ✅ | — |
| `macro_fundquantity` | 货币供应量M0/M1/M2 ✅ | `M0`, `M1`, `M2`, `M0_YOY`, `M1_YOY`, `M2_YOY` |
| `macro_core_indicatros_cur` | 核心宏观指标全景 ✅ | 综合所有宏观指标 |

**宏观指标详细字段**：

**PMI**：`PMI_MANU`(制造业), `PMI_MANU_ORDER_NEW`(新订单), `PMI_MANU_PRODUCE`(生产), `PMI_NON_MANU_BUSINESS_ACTIVITY`(非制造), `PMI_COMPREHENSIVE_CCZS`(综合), `PMI_ENDDATE`, `PMI_INFOPUBLDATE`

**GDP**：`NOMINAL_GDP_CUR`(名义当季), `REAL_GDP_CUR_YOY`(实际当季同比), `PULL_FIRST_CUM`(一产拉动), `PULL_SECOND_CUM`(二产拉动), `PULL_THIRD_CUM`(三产拉动)

**CPI/PPI**：`CPI_YOY`(CPI同比), `CPI_YOY_FOOD`(食品), `PPI_YOY`(PPI同比), `PPIRM_YOY`(原材料购进价格)

**货币供应量**：`M0`, `M1`, `M2` 及其同比 `M0_YOY`, `M1_YOY`, `M2_YOY`

**响应格式**（`list_data` 为 JSON 字符串）：
```json
{
  "code": 0,
  "data": {
    "data": {
      "index_list": {
        "list_data": "[{\"IndexCode\":\"sh000001\",\"IndexName\":\"上证指数\"}]",
        "list_info": { "list_name": "有行情指数清单", "list_code": "index_list" }
      }
    }
  }
}
```

---

## 5. 研报列表 `research_report_list_get` ✅

**功能**：获取脱水研报列表

**请求格式**：
```json
{
  "route": "research_report_list_get",
  "params": {
    "page": 1,
    "size": 10,
    "type": 1
  }
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码 |
| `size` | number | 每页数量 |
| `type` | number | 1=研报, 2=业绩会, 3=无数据 |
```

**响应字段**：
| 字段 | 说明 | 示例值 |
|------|------|--------|
| `id` | 研报ID | `"1092"` |
| `title` | 标题 | `"机构调研\|..."` |
| `preview` | 摘要 | `"这家模拟芯片龙头..."` |
| `publish_time` | 发布时间（毫秒时间戳） | `"1775611800000"` |
| `img` | 封面图URL | `"https://...jpg"` |
| `has_more` | 是否有更多 | `true` |

---

## 股票代码规则

| 市场 | 前缀 | 示例 |
|------|------|------|
| 上海A股 | `sh` | `sh600519`（贵州茅台） |
| 深圳A股 | `sz` | `sz000001`（平安银行） |
| 上海指数 | `sh` | `sh000001`（上证指数） |
| 深圳指数 | `sz` | `sz399001`（深证成指） |
| 港股 | `hk` | `hk00700`（腾讯控股） |
| ETF | `sh`/`sz` | `sh510300`（沪深300ETF） |

---

## 错误码

| code | 说明 |
|------|------|
| `0` | 成功 |
| `1620053003` | 参数错误（route 不存在或 fields 格式错误） |

---

## 使用限制

- 暂无明确频率限制
- API Key 有效期与腾讯内部账号绑定
- 部分字段需要权限（如机构评级可能返回空）

---

## 公共参数

所有接口都需要以下参数：

| 参数 | 值 | 说明 |
|------|------|------|
| `app` | `openclaw` | 应用标识 |
| `token` | `<APIKEY>` | 认证令牌 |
| `skill_channel` | `stockclaw` | 渠道标识 |

---

## 其他接口（GET / 非主数据）

### 1. 股票搜索 `GET /cgi/cgi-bin/smartbox/search` ✅

**功能**：按名称/代码搜索股票、基金、板块

**验证结果**：搜索"腾讯"返回 `hk00700 腾讯控股`，支持 `type=GP`

**请求**：
```
GET https://proxy.finance.qq.com/cgi/cgi-bin/smartbox/search
    ?app=openclaw
    &token=<APIKEY>
    &query=腾讯
    &stockFlag=1
    &fundFlag=0
    &ptFlag=0
    &skill_channel=stockclaw
```

| 参数 | 说明 |
|------|------|
| `query` | 搜索关键词 |
| `stockFlag` | 1=搜索股票 |
| `fundFlag` | 1=搜索基金 |
| `ptFlag` | 1=搜索板块 |

---

### 2. 热搜股票 `GET /ifzqgtimg/appstock/app/HotStock/getHotStockDetail` ✅

**功能**：获取平台热搜股票榜

**验证结果**：返回 `code`, `name`, `zdf`(涨跌幅), `zxj`(最新价), `stock_type`

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/HotStock/getHotStockDetail
    ?app=openclaw
    &token=<APIKEY>
    &skill_channel=stockclaw
```

---

### 3. 热门板块 `GET /ifzqgtimg/appstock/app/board/index` ✅

**功能**：获取热门板块排行（行业/概念/地域，资金流向，北向热门板块）

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/board/index
    ?app=openclaw
    &token=<APIKEY>
    &skill_channel=stockclaw
```

**响应结构**：
```json
{
  "code": 0,
  "data": {
    "rank": {
      "plate": [{...}],       // 行业板块当日涨幅排名
      "plate_zdf5": [...],     // 5日涨幅
      "plate_zdf20": [...],    // 20日涨幅
      "plate_zdf60": [...],    // 60日涨幅
      "plate_zdfY": [...],     // 年初至今
      "plate_zdfW52": [...],   // 52周涨幅
      "plate_hsl": [...],      // 换手率排名
      "plate_lb": [...],       // 量比排名
      "plate_zs": [...],       // 涨速排名
      "concept": [...],        // 概念板块（同样子结构）
      "area": [...]             // 地域板块
    },
    "fundflow": {
      "plate": { "top": [...], "bottom": [...], "top_d5": [...], "bottom_d5": [...], "top_d20": [...], "bottom_d20": [...] },
      "concept": {...},
      "area": {...}
    },
    "north_hot_plate": { "date": "...", "data": [...], "date_5": "...", "data_5": [...], "date_20": "...", "data_20": [...] }
  }
}
```

**板块字段**（`bd_*` 前缀）：
| 字段 | 说明 |
|------|------|
| `bd_name` | 板块名称 |
| `bd_code` | 板块代码（pt0180 申万 / pt02GN 概念 / pt0300 地域） |
| `bd_zdf` | 涨跌幅（%） |
| `bd_zdf5/20/60/Y/W52` | 各周期涨跌幅 |
| `bd_hsl` | 换手率（%） |
| `bd_lb` | 量比 |
| `nzg_code/name/zdf` | 领涨股代码/名称/涨幅 |

**资金流向字段**：
| 字段 | 说明 |
|------|------|
| `code/name` | 板块代码/名称 |
| `zdf` | 涨跌幅 |
| `cje` | 成交额（万元） |
| `zllr/zllc/zljlr` | 主力流入/流出/净流入（万元） |
| `lzg.code/name/zdf` | 领涨股 |

---

### 4. 热门股单 `GET /cgi/cgi-bin/watchlist/rank`

**功能**：获取股单排行榜

**请求**：
```
GET https://proxy.finance.qq.com/cgi/cgi-bin/watchlist/rank
    ?app=openclaw
    &token=<APIKEY>
    &count=20
    &sort_type=updateTime
    &skill_channel=stockclaw
```

| 参数 | 说明 |
|------|------|
| `count` | 返回数量 |
| `sort_type` | 排序方式（如 `updateTime`） |

---

### 5. 分时数据 `GET /ifzqgtimg/appstock/app/minute/query` ✅

**功能**：获取分钟级分时行情（支持多日）

**验证结果**：格式为 `"0930 1400.00 4423 619220000.00"` = 时间 + 价格 + 成交量 + 成交额

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query
    ?app=openclaw
    &token=<APIKEY>
    &code=sh600000
    &p=1
    &skill_channel=stockclaw
```

| 参数 | 说明 |
|------|------|
| `code` | 股票代码 |
| `p` | 页码/天数 |

---

### 6. 公告列表 `GET /appstock/news/noticeList/searchByType` ✅

**功能**：获取个股公告列表

**⚠️ 注意**：必须加 `-L` 跟随重定向

**请求**：
```
GET http://ifzq.gtimg.cn/appstock/news/noticeList/searchByType
    ?app=openclaw
    &token=<APIKEY>
    &symbol=sh600000
    &noticeType=0
    &page=1
    &n=20
    &skill_channel=stockclaw
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol` | string | 股票代码 |
| `noticeType` | number | 公告类型（见下表） |
| `page` | number | 页码 |
| `n` | number | 每页数量 |

**公告类型**：
| 值 | 类型 |
|---|------|
| 0 | 全部 |
| 1 | 财务 |
| 2 | 配股 |
| 3 | 增发 |
| 4 | 股权变动 |
| 5 | 重大事项 |
| 6 | 风险 |
| 7 | 其他 |

**响应格式**：
```json
{
  "code": 0,
  "data": {
    "total_num": 1586,
    "total_page": 80,
    "data": [{
      "id": "nos1225062336",
      "symbol": "sh600000",
      "title": "浦发银行：2025年年度报告",
      "time": "2026-03-30 20:48:34",
      "type": "0",
      "url": "",
      "newstype": "01010503,010113,010301",
      "update_time": "2026-03-30 20:48:34",
      "Ftranslate": "0"
    }]
  }
}
```

**newstype 代码说明**：
| 代码 | 说明 |
|------|------|
| `01010501` | 上交所 |
| `01010503` | 上市公司公告 |
| `01010701` | 券商公告 |
| `01010903` | 审计报告 |
| `010113` | 其他 |
| `010301` | 年度报告 |
| `011301` | 利润分配 |
| `012301` | 聘请中介机构 |
| `012303` | 人事变动 |
| `012330` | 可持续发展报告 |
| `012913` | 内部控制 |

**公告全文查询 `GET /ifzqgtimg/appstock/news/content/content` ✅**：

**功能**：获取公告正文内容（A股返回纯文本，港股/美股返回PDF）

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/news/content/content
    ?app=openclaw
    &token=<APIKEY>
    &id=<公告ID>
    &skill_channel=stockclaw
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `id` | string | 公告ID（见下表） |

**ID 格式**：
| 市场 | 前缀 | 示例 |
|------|------|------|
| A股 | `nos` | `nos1225062336`（年报）/`nos1225062338`（普通公告）|
| 港股 | `nok` | `nokHKEX-EPS-20260409-12100490` |
| 美股 | `nou` | `nou5130558` |

**响应格式**：
```json
{
  "success": true,
  "data": [{
    "id": "1225062336",
    "title": "浦发银行：2025年年度报告",
    "time": "2026-03-30 20:48:34",
    "detail": "http://file.finance.qq.com/...PDF",
    "pdf": "http://file.finance.qq.com/...PDF",
    "content": "",
    "stockcode": [{"symbol": "sh600000", "name": "浦发银行"}]
  }]
}
```

**内容获取策略**：
| 公告类型 | 推荐字段 | 说明 |
|---------|---------|------|
| A股普通公告 | `detail` | 纯文本内容 |
| A股普通公告（带格式） | `content` | HTML格式 |
| A股大型公告（年报等） | `detail` 或 `pdf` | PDF URL |
| 港股公告 | `pdf` | PDF URL |
| 美股原文 | `pdf` | 英文PDF |
| 美股中文翻译 | `content_tr` | 中文翻译PDF |

---

### 7. 研报列表 `GET /appstock/app/investRate/getReport` ✅

**功能**：获取个股研报列表

**⚠️ 注意**：必须加 `-L` 跟随重定向

**请求**：
```
GET http://ifzq.gtimg.cn/appstock/app/investRate/getReport
    ?app=openclaw
    &token=<APIKEY>
    &symbol=sh600519
    &page=1
    &n=20
    &withConference=1
    &skill_channel=stockclaw
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol` | string | 股票代码（如 `sh600519`） |
| `n` | number | 每页数量 |
| `page` | number | 页码 |
| `withConference` | number | 是否含业绩会（1=是） |

**响应字段**：
| 字段 | 说明 |
|------|------|
| `id` | 研报ID |
| `title` | 标题（格式：【机构】股票(代码)：标题） |
| `time` | 发布时间 |
| `typeStr` | 类型描述（如"年度点评"） |
| `type` | 1=研报, 2=业绩会 |
| `src` | 来源机构 |
| `tzpj` | 投资评级（买入/增持/持有/减持/卖出） |
| `url` | 研报链接（可能为空） |
| `summary` | 摘要 |

---

### 8. 新股日历 `GET /ifzqfinance/stock/notice/ipo/search` ✅

**功能**：获取新股日历

**验证结果**：返回 `symbol`, `name`, `price`, `syl`(市盈率), `ssrq`(上市日期), `sgdm`(申购代码)

**请求**：
```
GET https://proxy.finance.qq.com/ifzqfinance/stock/notice/ipo/search
    ?app=openclaw
    &token=<APIKEY>
    &market=hs
    &period=90
    &detail=1
    &skill_channel=stockclaw
```

| 参数 | 说明 |
|------|------|
| `market` | `hs`=沪深，`hk`=港股 |
| `period` | 查询天数 |
| `detail` | 是否返回详情 |

---

### 9. 投资日历 `GET /ifzqgtimg/appstock/app/FinanceCalendar/getActive` ✅

**功能**：获取有事件的日期列表

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/FinanceCalendar/getActive
    ?app=openclaw
    &token=<APIKEY>
    &skill_channel=stockclaw
```

**响应**：`[{date: "2026-01-02", event: {zy: "1"}}]`

---

### 9b. 投资日历详情 `GET /ifzqgtimg/appstock/app/FinanceCalendar/query` ✅

**功能**：查询具体日期的经济事件/央行动态

**请求**：
```
GET https://proxy.finance.qq.com/ifzqgtimg/appstock/app/FinanceCalendar/query
    ?app=openclaw
    &token=<APIKEY>
    &date=2026-04-17
    &limit=30
    &country=1
    &type=1
    &skill_channel=stockclaw
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `date` | string | 查询日期 |
| `limit` | number | 返回数量 |
| `country` | number | 1=中国, 2=美国, 3=港股 |
| `type` | number | 1=经济数据, 2=央行, 3=重大事件, 4=休市 |

**响应格式**：
```json
{
  "code": 0,
  "data": [{
    "date": "2026-04-17",
    "list": [{
      "oid": "17763552000003658",
      "time": "00:00",
      "Weightiness": "2",
      "CountryName": "法国",
      "FinancialEvent": "法国总统马克龙和英国首相斯塔默主持视频会议",
      "Previous": "",
      "Predict": "",
      "CurrentValue": ""
    }]
  }]
}
```

| 字段 | 说明 |
|------|------|
| `time` | 时间 |
| `Weightiness` | 重要程度（1-3，3最高） |
| `CountryName` | 国家 |
| `FinancialEvent` | 事件描述（中文） |
| `Content` | 事件内容（英文） |
| `Previous` | 前值 |
| `Predict` | 预测值 |
| `CurrentValue` | 实际值 |

---

### 10. 市场资讯 `GET /appstock/news/info/search` ✅

**功能**：获取市场资讯新闻

**⚠️ 注意**：必须加 `-L` 跟随重定向（`ifzq.gtimg.cn` → 实际接口）

**请求**：
```
GET http://ifzq.gtimg.cn/appstock/news/info/search
    ?app=openclaw
    &token=<APIKEY>
    &symbol=sh000001
    &type=2
    &n=20
    &page=1
    &skill_channel=stockclaw
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol` | string | 指数代码（如 `sh000001` 上证、`hkHSI` 恒生） |
| `type` | number | 资讯类型（固定 2） |
| `n` | number | 每页数量 |
| `page` | number | 页码 |

**symbol 常用值**：
| 市场 | 指数 | symbol |
|------|------|--------|
| 沪深 | 上证指数 | `sh000001` |
| 沪深 | 深证成指 | `sz399001` |
| 沪深 | 创业板指 | `sz399006` |
| 港股 | 恒生指数 | `hkHSI` |
| 港股 | 恒生科技 | `hkHSTECH` |

**响应格式**：
```json
{
  "code": 0,
  "data": {
    "total_num": 9999,
    "total_page": 2000,
    "data": [{
      "time": "2026-04-17 22:42:51",
      "title": "国际油价持续下挫，WTI原油跌幅扩大至14%",
      "src": "腾讯自选股",
      "importance": 0,
      "url": "http://gu.qq.com/resources/...",
      "symbols": ["sh000001"],
      "title_mention": "sz300750,sz300308",
      "summary": "...",
      "predictTimestamp": 1776436971
    }]
  }
}
```

| 字段 | 说明 |
|------|------|
| `importance` | 0=普通, 1=重要 |
| `symbols` | 关联指数代码 |
| `title_mention` | 标题提及的股票代码 |
| `body_mention` | 正文提及的股票代码 |
| `predictTimestamp` | 发布时间（Unix 秒） |
| `url` | 腾讯财经详情页 |

---

### 11. 遥测日志 `POST /v1/logs`

**功能**：记录技能运行日志（非数据接口）

**域名**：`https://galileotelemetry.tencent.com`

---

## 完整端点汇总

| 域名 | 路径 | 方法 | 功能 |
|------|------|------|------|
| `proxy.finance.qq.com` | `/cgi/cgi-bin/openai/openclaw/proxy` | POST | 主数据接口 |
| `proxy.finance.qq.com` | `/cgi/cgi-bin/smartbox/search` | GET | 股票搜索 |
| `proxy.finance.qq.com` | `/cgi/cgi-bin/watchlist/rank` | GET | 股单排行 |
| `proxy.finance.qq.com` | `/ifzqgtimg/appstock/app/HotStock/getHotStockDetail` | GET | 热搜股票 |
| `proxy.finance.qq.com` | `/ifzqgtimg/appstock/app/board/index` | GET | 热门板块 |
| `proxy.finance.qq.com` | `/ifzqgtimg/appstock/app/minute/query` | GET | 分时数据 |
| `proxy.finance.qq.com` | `/ifzqgtimg/appstock/app/FinanceCalendar/getActive` | GET | 投资日历 |
| `proxy.finance.qq.com` | `/ifzqfinance/stock/notice/ipo/search` | GET | 新股日历 |
| `ifzq.gtimg.cn` | `/appstock/news/noticeList/searchByType` | GET | 公告列表 |
| `ifzq.gtimg.cn` | `/appstock/app/investRate/getReport` | GET | 研报列表 |
| `ifzq.gtimg.cn` | `/appstock/news/info/search` | GET | 市场资讯 |
| `galileotelemetry.tencent.com` | `/v1/logs` | POST | 遥测日志 |
