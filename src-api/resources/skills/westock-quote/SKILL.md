---
name: westock-quote
promptDescription: 腾讯行情数据：实时价格、K线历史、分时、技术指标、资金流向、筹码、股东、ETF详情
whenToUse: 股价,行情,现价,涨跌,K线,日K,周K,均线,MACD,KDJ,RSI,布林线,技术指标,资金流向,主力,筹码,股东,分时,分钟,ETF净值,ETF规模,机构评级,目标价,一致预期,龙虎榜,大宗交易,融资融券,业绩预告,分红,解禁,回购
---

# westock-quote 使用指南

## 技能概述

腾讯金融行情数据技能，提供：
- **实时行情快照**：价格、涨跌幅、成交量、换手率
- **历史 K 线**：日/周/月级 OHLCV 数据
- **分时数据**：分钟级分时行情
- **技术指标**：MA、MACD、KDJ、RSI、BOLL
- **资金流向**：主力净流入、超大单（A股/港股）
- **筹码数据**：平均筹码成本、集中度、收益率
- **股东结构**：十大股东、十大流通股东
- **ETF 详情**：净值、规模、跟踪指数、重仓股
- **机构评级**：目标价、评级数、一致预期
- **事件数据**：龙虎榜、大宗交易、融资融券、业绩预告、分红方案、解禁数据

## 核心处理流程

### 步骤 1：分析意图

识别用户需要哪类数据，选择对应路由和 fields。

### 步骤 2：股票代码规范化

将用户输入的股票名称/代码转换为带前缀格式：

| 市场 | 前缀 | 示例 |
|------|------|------|
| 上海A股 | `sh` | `sh600519`（贵州茅台） |
| 深圳A股 | `sz` | `sz000001`（平安银行） |
| 上海指数 | `sh` | `sh000001`（上证指数） |
| 深圳指数 | `sz` | `sz399001`（深证成指） |
| 港股 | `hk` | `hk00700`（腾讯控股） |
| ETF | `sh/sz` | `sh510300`（沪深300ETF） |

### 步骤 3：调用 API

#### 公共参数

```bash
BASE_URL="https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy"
API_KEY="***WESTOCK_KEY_REDACTED***"
```

请求时需带 query 参数：`?app=openclaw&token=<API_KEY>&skill_channel=stockclaw`

---

## 路由一：实时行情快照 `stock_quote_snapshot`

**功能**：多码批量查询，通过不同 `fields` 组合覆盖所有快照类数据。

```python3
import urllib.request
import json

API_KEY = "***WESTOCK_KEY_REDACTED***"
BASE_URL = "https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy"
url = f"{BASE_URL}?app=openclaw&token={API_KEY}&skill_channel=stockclaw"

payload = {
    "token": API_KEY,
    "route": "stock_quote_snapshot",
    "params": {
        "codes": "sh600519,sh000001",
        "fields": "ClosePrice,Change,ChangeRatio,OpenPrice,HighPrice,LowPrice,PrevClosePrice"
    }
}
req = urllib.request.Request(
    url, data=json.dumps(payload).encode(), method="POST",
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
print(json.dumps(result, ensure_ascii=False, indent=2))
```

### 常用 fields 分组

**行情价格**：
`ClosePrice` 最新价，`OpenPrice` 开盘，`HighPrice` 最高，`LowPrice` 最低，`PrevClosePrice` 昨收，
`Change` 涨跌额，`ChangeRatio` 涨跌幅(%)，`LastestTradedPrice` 最新成交价，
`FwdClosePrice/HighPrice/LowPrice/OpenPrice` 复权价，`EndDate` 数据日期，`SecuCode` 代码

**技术指标**：
`MA_5`, `MA_10`, `MA_20` 均线，`MACD` MACD，`KDJ_K/D/J` KDJ，
`RSI_6`, `RSI_12` RSI，`BOLL_UPPER`, `BOLL_LOWER` 布林轨

**筹码成本**：
`ChipAvgCost` 平均筹码成本，`ChipConcentration90` 90%集中度，`ChipProfitRate` 筹码收益率(%)

**A股资金流向**（需带 `date` 参数）：
`MainNetFlow` 主力净流入(元)，`JumboNetFlow` 超大单净流入(元)

**港股资金流向**（需带 `date` 参数）：
`TotalNetFlow` 总净流入，`MainNetFlow` 主力净流入，`ShortRatio` 卖空比率(%)

**公司简况**：
`CompanyName` 全称，`ListedDate` 上市日期，`MainBusiness` 主营业务，`SW1Name` 申万一级行业

**机构评级**：
`TargetPriceAvg` 平均目标价，`RatingBuyCnt` 买入评级数，`RatingCnt` 总评级数

**一致预期**：
`ConEarningsForecast` 一致预期净利润，`ConTargetPrice` 一致预期目标价

**股东结构**：
`Top10Shareholder` 十大股东，`Top10FloatShareholder` 十大流通股东

**ETF详情**：
`EtfNav` 单位净值，`EtfSize` 基金规模，`EtfType` 基金类型，`EtfTrackIndexName` 跟踪指数

**财报数据**（需带 `date` 参数，如 `2025-12-31`）：
`TotalOperatingRevenue` 营业总收入，`NPParentCompanyOwners` 归母净利润

**事件数据**（需带 `date` 参数，仅沪深）：
`LhbInfos` 龙虎榜信息，`LhbTradingDetails` 龙虎榜交易明细，
`BlockTradingInfos` 大宗交易，`MarginTradeInfos` 融资融券

**其他**：
`PerformanceReserve` 业绩预告，`DividendPlans` 分红方案，
`SpecialTrade` 特别处理/风险警示，`SharesPledge` 股份质押

### 响应结构

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
          "EndDate": "2026-04-17"
        }
      }
    ]
  }
}
```

---

## 路由二：历史 K 线 `stock_quote_history`

**功能**：时间序列数据（K线、分红历史、股东户数等）。
**注意**：单码模式，参数用 `code`（非 `codes`），日期用 `start_date`/`end_date`。

```python3
payload = {
    "token": API_KEY,
    "route": "stock_quote_history",
    "params": {
        "code": "sh600519",
        "start_date": "2026-01-01",
        "end_date": "2026-04-17",
        "fields": "OpenPrice,ClosePrice,HighPrice,LowPrice,TurnoverVolume"
    }
}
```

**K线字段**：`OpenPrice`, `ClosePrice`, `HighPrice`, `LowPrice`, `TurnoverVolume` 成交量, `TurnoverAmount` 成交额

**其他历史字段**：`DividendPlans` 分红历史，`SHNum` 股东户数，`BuybackAttach` 回购，`SharesUnlock` 解禁，`LawSuit` 诉讼

### 响应结构

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

---

## 接口三：分时数据 `GET /minute/query`

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/minute/query"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
    f"&code=sh600519&p=1"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

返回格式：`"0930 1400.00 4423 619220000.00"` = 时间 + 价格 + 成交量 + 成交额

---

## 输出建议

- **实时行情**：输出 `artifact:quote-card`，包含代码、名称、价格、涨跌幅、开高低、成交量
- **K线图表**：输出 `artifact:kline-chart`，提供 series 数组 `[{time, open, high, low, close, volume}]`
- **技术指标**：表格展示，或结合 K 线图叠加
- **资金流向/筹码**：表格展示关键指标
- **股东/机构**：表格展示
