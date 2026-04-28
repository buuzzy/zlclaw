---
name: westock-screener
promptDescription: 股票筛选：条件选股（涨停/跌停/估值/技术），指数板块成份，宏观数据（GDP/CPI/PMI）
whenToUse: 选股,筛选,涨停,跌停,停牌,涨幅,估值,PE,PB,ROE,板块成份,申万,指数成份,沪股通,深股通,宏观,GDP,CPI,PPI,PMI,M2,货币供应,社融,工业利润,社会消费
---

# westock-screener 使用指南

## 技能概述

条件选股与宏观数据技能，提供：
- **条件筛选**：按涨幅/估值/技术指标/停牌状态等多维度筛选股票
- **指数/板块成份**：查询指数成份股、申万行业成份股、陆股通成份
- **宏观数据**：GDP、CPI/PPI、PMI、货币供应量、社会消费等核心宏观指标

## 公共参数

```bash
API_KEY="${WESTOCK_API_KEY}"
BASE_URL="https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy"
URL="${BASE_URL}?app=openclaw&token=${API_KEY}&skill_channel=stockclaw"
```

- 环境变量：`WESTOCK_API_KEY`（在设置 → 环境变量中配置）
- 若未配置，脚本输出错误 JSON 并退出，由 Agent 提示用户填入

---

## 路由一：条件筛选 `stock_filter_query`

**功能**：根据表达式筛选符合条件的股票，返回指定字段列表。

```python3
import urllib.request, json, os, sys

API_KEY = os.environ.get('WESTOCK_API_KEY', '')
if not API_KEY:
    print(json.dumps({"error": "WESTOCK_API_KEY 未配置。请检查数据接口配置后重试。"}, ensure_ascii=False))
    sys.exit(0)
BASE_URL = "https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy"
url = f"{BASE_URL}?app=openclaw&token={API_KEY}&skill_channel=stockclaw"

payload = {
    "token": API_KEY,
    "route": "stock_filter_query",
    "params": {
        "selector": {
            "expression": "intersect([ClosePrice = PriceCeiling, PriceCeiling > 0])",
            "date": "2026-04-17",
            "limit": 50
        },
        "fields": [
            {"metric": "SecuCode", "name": "代码"},
            {"metric": "StockName", "name": "名称"},
            {"metric": "ClosePrice", "name": "价格"},
            {"metric": "ChangePCT", "name": "涨幅%"},
            {"metric": "PE_TTM", "name": "PE-TTM"},
            {"metric": "TotalMV", "name": "市值"}
        ]
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

### expression 语法

| 表达式 | 说明 |
|--------|------|
| `TotalMV > 0` | 全部股票 |
| `intersect([ClosePrice = PriceCeiling, PriceCeiling > 0])` | 涨停股 |
| `intersect([ClosePrice = PriceFloor, PriceFloor > 0])` | 跌停股 |
| `intersect([ChangePCT > 5, ChangePCT <= 7])` | 涨幅 5-7% |
| `intersect([ChangePCT > 2, PE_TTM < 20, PE_TTM > 0])` | 涨幅>2% 且 PE<20 |
| `intersect([Ifsuspend = 1])` | 停牌股 |
| `intersect([RSI_6 < 30])` | RSI 超卖 |
| `intersect([PE_TTM > 0, PE_TTM < 15, ROE_TTM > 15])` | 低估值高ROE |

### 可用 fields metrics

`SecuCode` 代码，`StockName` 名称，`ClosePrice` 价格，`ChangePCT` 涨幅，`PriceCeiling` 涨停价，`PriceFloor` 跌停价，`TurnoverRate` 换手率，`PE_TTM` PE-TTM，`PB` 市净率，`TotalMV` 总市值，`CircMV` 流通市值，`ROE_TTM` ROE，`MA_5/10/20` 均线，`RSI_6` RSI，`MACD` MACD

### 响应结构

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
          "condition_values": [{"disp": "363.19", "raw": "363.19"}, {"disp": "+20.00%", "raw": "20.00"}]
        }]
      },
      "selection_desc": "该策略回测1年的收益为: 42.82%"
    },
    "analyze_data": {"data": [{"code": "sh688807", "name": "优迅股份", "type": "stock"}]}
  }
}
```

`condition_values` 数组与 `fields` 顺序对应；`selection_desc` 包含策略回测收益说明。

---

## 路由二：列表数据 `query_list_data_by_date`

**功能**：指数清单、板块成份股、宏观经济指标。

```python3
payload = {
    "token": API_KEY,
    "route": "query_list_data_by_date",
    "params": {
        "list_codes": ["macro_cpi_ppi"],
        "date": "2026-04-17"
    }
}
```

响应：`data.data.<list_code>.list_data` 为 JSON 字符串，需解析。

### 指数/板块 list_codes

| list_code | 说明 | 关键字段 |
|-----------|------|---------|
| `index_list` | 有行情指数清单 | `IndexCode`, `IndexName` |
| `industry_list_sw1` | 申万一级行业 | `SectorCode`, `SectorName` |
| `industry_list_sw2` | 申万二级行业 | `SectorCode`, `SectorName` |
| `industry_list_sw3` | 申万三级行业 | `SectorCode`, `SectorName` |
| `sh_connected_stocks` | 沪股通成份股 | `StockCode`, `StockName` |
| `sz_connected_stocks` | 深股通成份股 | `StockCode`, `StockName` |
| `comp_sw1_<板块编码>` | 申万一级板块成份股 | `StockCode`, `StockName` |

### 宏观数据 list_codes

| list_code | 说明 | 关键字段 |
|-----------|------|---------|
| `macro_pmi` | PMI | `PMI_MANU`(制造业), `PMI_NON_MANU_BUSINESS_ACTIVITY`(非制造), `PMI_COMPREHENSIVE_CCZS`(综合), `PMI_ENDDATE` |
| `macro_gdp` | GDP | `REAL_GDP_CUR_YOY`(当季同比), `NOMINAL_GDP_CUR`(名义当季), `GDP_ENDDATE` |
| `macro_cpi_ppi` | CPI/PPI | `CPI_YOY`(CPI同比), `CPI_YOY_FOOD`(食品), `PPI_YOY`(PPI同比), `PPIRM_YOY`(原材料) |
| `macro_fundquantity` | 货币供应 | `M0`, `M1`, `M2`, `M0_YOY`, `M1_YOY`, `M2_YOY` |
| `macro_consumption` | 社会消费 | `CONSUMP_CUR`, `CONSUMP_CUM_YOY` |
| `macro_financing` | 社融规模 | — |
| `macro_profit` | 工业企业利润 | — |
| `macro_core_indicatros_cur` | 核心宏观全景 | 综合所有宏观指标 |

### 响应结构

```json
{
  "code": 0,
  "data": {
    "data": {
      "index_list": {
        "list_data": "[{\"IndexCode\": \"sh000001\", \"IndexName\": \"上证指数\"}, ...]"
      },
      "macro_cpi_ppi": {
        "list_data": "[{\"CPI_YOY\": 2.5, \"PPI_YOY\": 1.2}]"
      }
    }
  }
}
```

---

## 输出建议

- **选股结果**：输出 `artifact:data-table`，包含代码、名称、价格、涨幅等核心字段
- **宏观趋势**：输出 `artifact:line-chart`，展示时间序列变化
- **宏观快照**：输出 `artifact:data-table`，展示最新数据对比
