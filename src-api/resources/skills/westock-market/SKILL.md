---
name: westock-market
promptDescription: 腾讯市场总览：热搜股票、热门板块排行、新股日历、投资日历经济事件、股票搜索、股单排行
whenToUse: 热门,热搜,热股,今日热点,板块排行,涨幅榜,板块资金,新股,打新,IPO,上市日历,投资日历,经济数据,央行,财经日历,大事,搜索股票,查股票代码,股票搜索,北向,北向热门,换手率排行,股单,股单排行,热门股单,自选股单
---

# westock-market 使用指南

## 技能概述

市场总览与日历类数据技能，提供：
- **热搜股票**：平台实时热搜股票榜
- **热门板块**：行业/概念/地域板块涨跌排行、资金流向排行、北向热门板块
- **新股日历**：A股/港股近期新股申购信息
- **投资日历**：全球经济数据发布、央行会议、重大事件日历
- **股票搜索**：按名称/代码搜索股票、基金、板块

## 公共参数

```bash
API_KEY="${WESTOCK_API_KEY}"
QUERY="?app=openclaw&token=${API_KEY}&skill_channel=stockclaw"
```

- 环境变量：`WESTOCK_API_KEY`（在设置 → 环境变量中配置）
- 若未配置，脚本输出错误 JSON 并退出，由 Agent 提示用户填入

---

## 接口一：股票搜索 `GET /smartbox/search`

```python3
import urllib.request, json, os, sys

API_KEY = os.environ.get('WESTOCK_API_KEY', '')
if not API_KEY:
    print(json.dumps({"error": "WESTOCK_API_KEY 未配置。请在 Sage 设置 → 环境变量中填入腾讯金融数据接口 Key（WESTOCK_API_KEY）后重试。"}, ensure_ascii=False))
    sys.exit(0)

url = (
    f"https://proxy.finance.qq.com/cgi/cgi-bin/smartbox/search"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
    f"&query=腾讯&stockFlag=1&fundFlag=0&ptFlag=0"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
print(json.dumps(result, ensure_ascii=False, indent=2))
```

**参数**：`query` 搜索词，`stockFlag=1` 搜股票，`fundFlag=1` 搜基金，`ptFlag=1` 搜板块

---

## 接口二：热搜股票 `GET /HotStock/getHotStockDetail`

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/HotStock/getHotStockDetail"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

**响应字段**：`code` 股票代码，`name` 名称，`zdf` 涨跌幅，`zxj` 最新价，`stock_type` 类型

---

## 接口三：热门板块 `GET /board/index`

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/board/index"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

### 响应结构

```json
{
  "data": {
    "rank": {
      "plate": [...],      // 行业板块当日涨幅排名
      "plate_zdf5": [...], // 5日涨幅
      "plate_hsl": [...],  // 换手率排名
      "plate_lb": [...],   // 量比排名
      "concept": [...],    // 概念板块
      "area": [...]        // 地域板块
    },
    "fundflow": {
      "plate": { "top": [...], "bottom": [...] },  // 今日板块资金流入/流出排名
      "concept": {...},
      "area": {...}
    },
    "north_hot_plate": { "date": "...", "data": [...] }  // 北向热门板块
  }
}
```

**板块字段**（`bd_*` 前缀）：
| 字段 | 说明 |
|------|------|
| `bd_name` | 板块名称 |
| `bd_code` | 板块代码（`pt0180` 申万 / `pt02GN` 概念 / `pt0300` 地域） |
| `bd_zdf` | 今日涨跌幅(%) |
| `bd_zdf5/20/60/Y/W52` | 各周期涨跌幅 |
| `bd_hsl` | 换手率(%) |
| `nzg_code/name/zdf` | 领涨股代码/名称/涨幅 |

**资金流向字段**：`code/name` 板块，`zdf` 涨跌幅，`zllr/zllc/zljlr` 主力流入/流出/净流入（万元）

---

## 接口四：新股日历 `GET /ipo/search`

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqfinance/stock/notice/ipo/search"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
    f"&market=hs&period=90&detail=1"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

**参数**：`market` (`hs`=沪深，`hk`=港股)，`period` 天数，`detail=1` 返回详情

**响应字段**：`symbol` 代码，`name` 名称，`price` 发行价，`syl` 市盈率，`ssrq` 上市日期，`sgdm` 申购代码

---

## 接口五：投资日历 `GET /FinanceCalendar`

### 5.1 有事件日期列表

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/FinanceCalendar/getActive"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
# 返回：[{"date": "2026-01-02", "event": {"zy": "1"}}]
```

### 5.2 当日事件详情

```python3
url = (
    f"https://proxy.finance.qq.com/ifzqgtimg/appstock/app/FinanceCalendar/query"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
    f"&date=2026-04-17&limit=30&country=1&type=1"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

**参数**：`date` 查询日期，`country`（1=中国，2=美国，3=港股），`type`（1=经济数据，2=央行，3=重大事件，4=休市）

**响应字段**：
| 字段 | 说明 |
|------|------|
| `time` | 时间 |
| `Weightiness` | 重要程度（1-3，3最高） |
| `CountryName` | 国家 |
| `FinancialEvent` | 事件描述（中文） |
| `Previous` | 前值 |
| `Predict` | 预测值 |
| `CurrentValue` | 实际值 |

---

## 接口六：热门股单排行 `GET /watchlist/rank`

```python3
import urllib.request, json, os, sys

API_KEY = os.environ.get('WESTOCK_API_KEY', '')
if not API_KEY:
    print(json.dumps({"error": "WESTOCK_API_KEY 未配置。请在 Sage 设置 → 环境变量中填入腾讯金融数据接口 Key（WESTOCK_API_KEY）后重试。"}, ensure_ascii=False))
    sys.exit(0)
url = (
    f"https://proxy.finance.qq.com/cgi/cgi-bin/watchlist/rank"
    f"?app=openclaw&token={API_KEY}&skill_channel=stockclaw"
    f"&count=20&sort_type=updateTime"
)
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
print(json.dumps(result, ensure_ascii=False, indent=2))
```

**参数**：
| 参数 | 说明 |
|------|------|
| `count` | 返回数量（默认 20） |
| `sort_type` | 排序方式（`updateTime` = 按更新时间） |

**说明**：返回平台热门股单（自选股单/组合）排行榜，适合查询当前最受关注的股票组合。

---

## 输出建议

- **热搜股票**：输出 `artifact:data-table`，含代码、名称、涨跌幅、最新价
- **热门板块**：输出 `artifact:data-table`，含板块名、涨跌幅、领涨股
- **新股日历**：输出 `artifact:data-table`，含名称、发行价、申购代码、上市日期
- **投资日历**：输出 `artifact:data-table`，含时间、事件、重要程度、预测值/实际值
- **搜索结果**：文字回复，列出匹配的股票代码和名称
- **股单排行**：输出 `artifact:data-table`，含股单名称、收益率、关注人数
