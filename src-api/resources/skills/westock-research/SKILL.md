---
name: westock-research
promptDescription: 腾讯研报与资讯：个股研报列表、公告查询、公告正文、市场资讯新闻
whenToUse: 研报,研究报告,机构报告,公告,年报,季报,分红公告,增发,重组,新闻,资讯,市场新闻,财经新闻,公告正文,全文
---

# westock-research 使用指南

## 技能概述

研报、公告、资讯类数据技能，提供：
- **个股研报**：按股票查询机构研报列表（标题/评级/来源/摘要）
- **精选研报**：平台精选脱水研报列表
- **公告列表**：按股票/类型查询公告，支持财报/分红/增发/重组等
- **公告正文**：获取公告详细内容（A股纯文本/PDF，港美股PDF）
- **市场资讯**：按指数查询财经新闻（沪深/港股）

## 公共参数

```bash
API_KEY="30fc4280ff39cf4caa1c909cc8778af5ed6f3de82e6ff5b4768d4906ca079f0e"
QUERY="?app=openclaw&token=${API_KEY}&skill_channel=stockclaw"
```

---

## 接口一：个股研报列表 `GET /investRate/getReport`

**注意**：需要 `-L` 跟随重定向（域名为 `ifzq.gtimg.cn`）

```python3
import urllib.request, json

API_KEY = "30fc4280ff39cf4caa1c909cc8778af5ed6f3de82e6ff5b4768d4906ca079f0e"
base = "http://ifzq.gtimg.cn/appstock/app/investRate/getReport"
url = f"{base}?app=openclaw&token={API_KEY}&skill_channel=stockclaw&symbol=sh600519&page=1&n=20&withConference=1"

# 手动处理重定向
import urllib.request
opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
with opener.open(url) as resp:
    result = json.loads(resp.read())
print(json.dumps(result, ensure_ascii=False, indent=2))
```

**参数**：`symbol` 股票代码（如 `sh600519`），`n` 每页数量，`page` 页码，`withConference=1` 含业绩会

**响应字段**：
| 字段 | 说明 |
|------|------|
| `id` | 研报ID |
| `title` | 标题（格式：【机构】股票(代码)：标题） |
| `time` | 发布时间 |
| `typeStr` | 类型（如"年度点评"） |
| `type` | 1=研报, 2=业绩会 |
| `src` | 来源机构 |
| `tzpj` | 投资评级（买入/增持/持有/减持/卖出） |
| `summary` | 摘要 |

---

## 接口二：精选研报列表 `POST research_report_list_get`

```python3
BASE_URL = "https://proxy.finance.qq.com/cgi/cgi-bin/openai/openclaw/proxy"
url = f"{BASE_URL}?app=openclaw&token={API_KEY}&skill_channel=stockclaw"

payload = {
    "token": API_KEY,
    "route": "research_report_list_get",
    "params": {"page": 1, "size": 10, "type": 1}  # type: 1=研报, 2=业绩会
}
req = urllib.request.Request(
    url, data=json.dumps(payload).encode(), method="POST",
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
```

**响应字段**：`id`, `title`, `preview`(摘要), `publish_time`(毫秒时间戳), `img`(封面图), `has_more`

---

## 接口三：公告列表 `GET /noticeList/searchByType`

**注意**：需要 `-L` 跟随重定向（域名为 `ifzq.gtimg.cn`）

```python3
base = "http://ifzq.gtimg.cn/appstock/news/noticeList/searchByType"
url = f"{base}?app=openclaw&token={API_KEY}&skill_channel=stockclaw&symbol=sh600000&noticeType=0&page=1&n=20"

opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
with opener.open(url) as resp:
    result = json.loads(resp.read())
```

**公告类型 `noticeType`**：0=全部，1=财务，2=配股，3=增发，4=股权变动，5=重大事项，6=风险，7=其他

**响应字段**：`id`(公告ID), `title`, `time`, `type`, `newstype`(更细分类代码)

---

## 接口四：公告正文 `GET /news/content/content`

```python3
url = f"https://proxy.finance.qq.com/ifzqgtimg/appstock/news/content/content?app=openclaw&token={API_KEY}&skill_channel=stockclaw&id=nos1225062336"
with urllib.request.urlopen(url) as resp:
    result = json.loads(resp.read())
```

**ID 格式**：A股 `nos...`，港股 `nok...`，美股 `nou...`

**内容获取策略**：
| 类型 | 字段 | 说明 |
|------|------|------|
| A股普通公告 | `detail` | 纯文本 |
| A股大型公告（年报） | `pdf` | PDF URL |
| 港股公告 | `pdf` | PDF URL |
| 美股中文翻译 | `content_tr` | 翻译PDF |

---

## 接口五：市场资讯 `GET /news/info/search`

**注意**：需要 `-L` 跟随重定向（域名为 `ifzq.gtimg.cn`）

```python3
base = "http://ifzq.gtimg.cn/appstock/news/info/search"
url = f"{base}?app=openclaw&token={API_KEY}&skill_channel=stockclaw&symbol=sh000001&type=2&n=20&page=1"

opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
with opener.open(url) as resp:
    result = json.loads(resp.read())
```

**symbol 常用值**：
| 市场 | symbol |
|------|--------|
| 上证指数 | `sh000001` |
| 深证成指 | `sz399001` |
| 创业板指 | `sz399006` |
| 恒生指数 | `hkHSI` |
| 恒生科技 | `hkHSTECH` |

**响应字段**：`time`, `title`, `src`(来源), `importance`(0=普通/1=重要), `summary`, `url`, `title_mention`(提及股票代码)

---

## 输出建议

- **研报列表**：输出 `artifact:data-table`，包含标题、机构、日期、评级、摘要
- **公告列表**：输出 `artifact:data-table`，包含标题、日期、类型
- **新闻列表**：输出 `artifact:news-list`，包含标题、来源、时间、摘要
