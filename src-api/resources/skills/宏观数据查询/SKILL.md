---
name: 宏观数据查询
description: 查询 GDP、CPI、PPI、利率、汇率、社融等宏观经济指标，支持自然语言问句输入，返回相关宏观经济数据结果。当用户询问宏观经济数据、GDP、CPI、PPI、利率、汇率、社融、M2、PMI、工业增加值、消费、投资、进出口等宏观经济指标查询问题时，必须使用此技能。
promptDescription: 宏观查询：GDP、CPI、PPI、利率、汇率、PMI、M2等宏观指标
whenToUse: 宏观,GDP,CPI,PPI,利率,汇率,PMI,M2,社融,货币政策,宏观数据,经济数据
---

# 宏观数据查询 使用指南

## 技能概述

本技能提供宏观数据查询能力，支持：
- GDP、CPI、PPI 等国民经济核算指标
- 利率、汇率、社融等金融指标
- PMI、工业增加值、消费、投资、进出口等经济运行指标
- 支持自然语言问句输入，返回相关宏观经济数据结果

## 核心处理流程

### 步骤 1: 接收用户 Query

接收用户的自然语言查询请求，分析用户意图。

### 步骤 2: Query 改写

将用户问句适当改写为标准的金融查询问句，保持原意不变：

**改写规则：**
- 保留用户核心意图（如：GDP、CPI、利率等）
- 将口语化表达转为标准金融术语
- 适当简化过于复杂的复合条件
- 改写后需保持原意不变
- 不需要在空数据时改写问句和尝试

**思维链拆解（如果需要）：**
根据用户需求自行决定是否拆解思维链：
- **单次查询**：如果用户问题可以直接用单个 query 回答，直接进入下一步
- **多次查询**：如果用户问题涉及多个指标（如"GDP和CPI数据"），需要拆分为多个标准 query 分别调用接口

### 步骤 3: API 调用

使用 python3 调用金融查询接口获取数据：

```python3
# 使用 Python 标准库
import urllib.request
import json
import os

url = "https://openapi.iwencai.com/v1/query2data"
headers = {
    "Authorization": f"Bearer {os.environ['IWENCAI_API_KEY']}",
    "Content-Type": "application/json",
    "X-Claw-Call-Type": "normal",
    "X-Claw-Skill-Id": "宏观数据查询",
    "X-Claw-Skill-Version": "1.0.0",
    "X-Claw-Plugin-Id": "none",
    "X-Claw-Plugin-Version": "none",
    "X-Claw-Trace-Id": __import__('secrets').token_hex(32),
}
payload = {
    "query": "改写后的查询语句",
    "page": "1",
    "limit": "10",
    "is_cache": "1",
    "expand_index": "true"
}

data = json.dumps(payload).encode("utf-8")
request = urllib.request.Request(url, data=data, headers=headers, method="POST")
response = urllib.request.urlopen(request, timeout=30)
result = json.loads(response.read().decode("utf-8"))

# 判断接口返回状态
datas = result.get("datas", [])
code_count = result.get("code_count", 0)  # 共查到多少只标的的信息
chunks_info = result.get("chunks_info", {})  # 用户问句查询返回的字句信息

# 注意：status_code 为 0 代表接口请求成功，不为 0 代表错误，status_msg 包含错误信息
```

### 步骤 4: 数据解析

解析返回的 `datas` 数组，提取相关字段：

```python3
for item in datas:
    # 根据查询类型提取相应宏观经济数据字段
    # 如：指标名称、数值、时间等
    # 返回数据通常以表格形式呈现，包含多个字段列
```

**返回数据格式说明：**
- `datas`：金融数据列表，对象数组，每个对象代表一条记录
- `code_count`：共查到多少只标的的信息（总数量，可能大于当前返回的datas长度）
- `chunks_info`：用户问句查询返回的字句信息

### 步骤 5: 数据扩展决策

skill 需要自行决策当前数据是否足够回答用户问题：
- 如果数据完整：直接返回格式化后的结果
- 如果需要更多背景信息：可以调用其他金融工具或者搜索工具获取相关资讯

### 步骤 6: 回答用户

组织语言回答用户问题，确保：
- 结果清晰易懂
- 如果改写了问句，需特别说明最终使用的查询问句
- **必须强调实时市场数据**
- **默认返回10条数据，如需查看更多请使用翻页参数（page和limit）**

## API 接口

### 认证方式
- 请求头：`Authorization: Bearer {IWENCAI_API_KEY}`
- 环境变量：`IWENCAI_API_KEY`

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| query | STRING | 是 | 用户问句 |
| page | STRING | 否 | 分页参数，默认值：1 |
| limit | STRING | 否 | 分页参数，默认值：10（每页条数） |
| is_cache | STRING | 否 | 缓存参数，默认值：1 |
| expand_index | STRING | 否 | 是否展开指数，默认值：true |

**分页说明：**
- 默认返回第1页，每页10条数据（page=1, limit=10）
- 如需查看更多数据，请调整 page 和 limit 参数进行翻页

### 响应参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| datas | ARRAY | 金融数据列表，对象数组 |
| code_count | INTEGER | 共查到多少只标的的信息（总数量） |
| chunks_info | OBJECT | 用户问句查询返回的字句信息 |
| status_code | INTEGER | 接口状态码，0代表成功，非0代表错误 |
| status_msg | STRING | 错误信息（status_code不为0时） |

**响应示例：**
```json
{
  "datas": [
    {
      "指标名称": "GDP",
      "数值": "126.06万亿",
      "时间": "2024年"
    }
  ],
  "code_count": 50,
  "chunks_info": {},
  "status_code": 0,
  "status_msg": ""
}
```

## CLI 使用方式

### 命令行参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--query` | STRING | 是 | 直接传入查询字符串 |
| `--page` | STRING | 否 | 分页参数，默认值：1 |
| `--limit` | STRING | 否 | 每页条数，默认值：10 |
| `--is-cache` | STRING | 否 | 缓存参数，默认值：1 |
| `--api-key` | STRING | 否 | API密钥（默认从环境变量读取）|

### 使用示例

```bash
# 查询2024年中国GDP
python3 scripts/cli.py --query "2024年中国GDP"

# 查询最近一期CPI
python3 scripts/cli.py --query "最近一期CPI"

# 查询LPR利率
python3 scripts/cli.py --query "LPR利率"

# 翻页查询
python3 scripts/cli.py --query "GDP数据" --page 2 --limit 20
```

## 回答要求

- 如果没有查询到数据，告知用户"暂未查到相关数据，请稍后重试或更换关键词"

## 错误处理

- **status_code 判断**：接口返回的 `status_code` 为 0 代表接口请求成功，不为 0 代表错误，`status_msg` 包含错误信息
- API调用失败：给出友好错误提示
- 无数据返回：告知用户"暂未查到相关数据，请稍后重试或更换关键词"

## 代码结构

```
hithink-macro-query/
├── SKILL.md       # Skill 配置文件
├── references/
│   ├── api.md     # API 接口文档
│   └── requirement.md  # 构建要求文档
└── scripts/
    └── cli.py     # CLI 入口（单一脚本，内含API调用和数据处理）
```
