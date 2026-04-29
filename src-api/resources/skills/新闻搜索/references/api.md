# 财经资讯搜索接口文档

## 接口概述
- **接口名称**: 财经资讯搜索接口
- **接口说明**: 财经领域为主的资讯搜索引擎，囊获了各类型媒体：官媒、主流财经媒体、垂直行业网站、知名上市公司/非上市公司官网等，可以帮助你了解最新财经事件、政策动态、行业革新、企业业务进展等

## 基础信息
- **Base URL**: `https://openapi.iwencai.com`
- **接口路径**: `/v1/comprehensive/search`
- **请求方式**: POST
- **认证方式**: API Key (Bearer Token)

## 认证要求
在请求头中需要携带API Key及 X-Claw 系列 Header 进行认证。

## 请求头
| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | `application/json` |
| `Authorization` | 是 | `Bearer {IWENCAI_API_KEY}` |
| `X-Claw-Call-Type` | 是 | `normal`（正常请求）或 `retry`（重试） |
| `X-Claw-Skill-Id` | 是 | `新闻搜索` |
| `X-Claw-Skill-Version` | 是 | `1.0.0` |
| `X-Claw-Plugin-Id` | 是 | `none` |
| `X-Claw-Plugin-Version` | 是 | `none` |
| `X-Claw-Trace-Id` | 是 | 64 字符唯一追踪 ID（`secrets.token_hex(32)`） |

## 请求参数

### 固定参数
| 参数名 | 类型 | 说明 | 值 |
|--------|------|------|-----|
| channels | LIST | 搜索渠道类型 | `["news"]` |
| app_id | STRING | 应用ID | `AIME_SKILL` |

### 可变参数
| 参数名 | 类型 | 说明 | 必填 |
|--------|------|------|------|
| query | STRING | 用户问句，即搜索关键词 | 是 |

### 请求示例
```json
{
  "channels": ["news"],
  "app_id": "AIME_SKILL",
  "query": "人工智能行业最新动态"
}
```

## 响应参数

### 响应结构
```json
{
  "data": [
    {
      "title": "文章标题",
      "summary": "文章摘要",
      "url": "文章网址",
      "publish_date": "文章发布时间"
    }
  ]
}
```

### 字段说明
| 字段名 | 类型 | 说明 | 格式 |
|--------|------|------|------|
| data | LIST | 返回的文章信息列表 | - |
| title | STRING | 文章标题 | - |
| summary | STRING | 文章摘要 | - |
| url | STRING | 文章网址 | URL格式 |
| publish_date | STRING | 文章发布时间 | `YYYY-MM-DD HH:MM:SS` |

## 响应示例
```json
{
  "data": [
    {
      "title": "人工智能助力金融行业数字化转型",
      "summary": "近日，多家金融机构宣布采用人工智能技术优化风控系统...",
      "url": "https://example.com/article/123",
      "publish_date": "2024-01-15 10:30:00"
    },
    {
      "title": "AI芯片市场迎来爆发式增长",
      "summary": "随着人工智能应用的普及，AI芯片市场需求持续攀升...",
      "url": "https://example.com/article/124",
      "publish_date": "2024-01-14 14:20:00"
    }
  ]
}
```

## 错误码
| 状态码 | 说明 | 处理建议 |
|--------|------|----------|
| 200 | 请求成功 | - |
| 400 | 请求参数错误 | 检查请求参数格式和必填项 |
| 401 | 认证失败 | 检查API Key是否正确且有效 |
| 403 | 权限不足 | 检查API Key是否有访问此接口的权限 |
| 500 | 服务器内部错误 | 稍后重试或联系技术支持 |

## 使用限制
- 请求频率限制：请参考API提供商的具体限制
- 数据返回限制：每次请求返回的文章数量可能有上限
- 数据时效性：返回的文章按发布时间倒序排列

## 注意事项
1. API Key需要妥善保管，不要泄露
2. 请求参数中的`channels`和`app_id`为固定值，不要修改
3. `query`参数支持中文关键词搜索
4. 返回的文章实时市场数据，引用时请注明数据来源
5. 接口响应时间可能因网络状况和查询复杂度而异