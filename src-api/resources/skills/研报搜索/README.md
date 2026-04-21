# 研报搜索技能

财经研究报告搜索引擎，调用同花顺问财的财经资讯搜索接口，专门搜索和分析主流投研机构发布的研究报告。

## 功能特点

- **研究报告搜索**: 专门搜索各类财经研究报告和分析文章
- **专业查询处理**: 自动拆解复杂查询为多个专业查询，生成标准化关键词
- **数据质量评估**: 自动评估搜索结果的专业性和完整性
- **关键信息提取**: 提取分析逻辑、投资评级、目标价等关键信息
- **多种输出格式**: 支持CSV、JSON、Markdown等多种输出格式
- **批量处理**: 支持从文件读取多个查询并批量处理
- **错误处理**: 完善的错误处理和重试机制
- **详细日志**: 详细的运行日志和调试信息

## 数据来源

**所有研究搜索结果均来源于同花顺问财财经资讯搜索接口**，使用时请注明数据来源。

## 安装要求

- Python 3.7+
- requests库（通过requirements.txt安装）

## 快速开始

### 1. 设置API密钥

```bash
# 设置环境变量
export IWENCAI_API_KEY="your_api_key_here"
```

### 2. 基本使用

```bash
# 搜索研究报告
python research_report_search.py -q "人工智能行业研究报告"

# 搜索最近30天的研究报告
python research_report_search.py -q "芯片行业" -d 30

# 限制返回结果数量
python research_report_search.py -q "新能源汽车" -l 5

# 导出为CSV格式
python research_report_search.py -q "人工智能" -o results.csv -f csv

# 导出为JSON格式
python research_report_search.py -q "人工智能" -o results.json -f json

# 导出为Markdown报告格式
python research_report_search.py -q "医药行业" -o report.md -f markdown
```

### 3. 批量处理

```bash
# 从文件读取多个查询并批量处理
python research_report_search.py -i queries.txt -o ./results

# 指定输出格式为JSON
python research_report_search.py -i queries.txt -o ./results -f json
```

### 4. 时间范围搜索

```bash
# 搜索指定时间范围的研究报告
python research_report_search.py -q "新能源车" --date-from "2024-01-01" --date-to "2024-03-31"

# 搜索最近7天的研究报告
python research_report_search.py -q "人工智能" -d 7
```

## 命令行参数

### 基本搜索参数
- `-q, --query`: 搜索关键词（支持中文）
- `-o, --output`: 输出文件路径
- `-f, --format`: 输出格式（csv, json, text, markdown）
- `-l, --limit`: 结果数量限制（默认10）

### 批量处理参数
- `-i, --input`: 输入文件路径（支持批量查询）
- `--input-format`: 输入文件格式（txt, csv, json）
- `--output-dir`: 输出目录（批量处理时使用）

### 过滤与排序参数
- `--date-from`: 开始日期（YYYY-MM-DD）
- `--date-to`: 结束日期（YYYY-MM-DD）
- `-d, --days`: 最近N天（与date-from/date-to互斥）
- `--sort-by`: 排序字段（date, relevance）
- `--sort-order`: 排序顺序（asc, desc）

### 其他参数
- `-v, --verbose`: 详细输出模式
- `--debug`: 调试模式
- `-h, --help`: 显示帮助信息

## 配置文件

技能使用 `config.example.json` 作为配置文件示例，实际配置应通过环境变量或自定义配置文件设置。

### 配置示例 (config.example.json)
```json
{
  "api": {
    "base_url": "https://openapi.iwencai.com",
    "endpoint": "/v1/comprehensive/search",
    "timeout": 30,
    "max_retries": 3,
    "retry_delay": 1.0
  },
  "search": {
    "channels": ["report"],
    "app_id": "AIME_SKILL",
    "default_limit": 10,
    "default_days": 30,
    "min_articles_for_sufficient": 3
  },
  "output": {
    "default_format": "text",
    "csv_encoding": "utf-8-sig",
    "json_indent": 2
  },
  "logging": {
    "level": "INFO",
    "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
  },
  "注意": "API密钥应从环境变量 IWENCAI_API_KEY 获取，不要在此配置文件中硬编码",
  "数据来源": "本技能所有数据均来源于同花顺问财财经资讯搜索接口，使用时请注明数据来源"
}
```

## 使用示例

### 示例1：基本搜索
```bash
python research_report_search.py --query "人工智能行业研究报告" --output ai_reports.csv --format csv
```

### 示例2：批量处理
```bash
# queries.txt 内容：
# 人工智能
# 芯片行业
# 新能源汽车
# 医药行业

python research_report_search.py --input queries.txt --output-dir ./reports --format json
```

### 示例3：专业分析报告
```bash
python research_report_search.py --query "特斯拉投资评级目标价" --output tesla_analysis.md --format markdown --limit 5
```

### 示例4：时间范围搜索
```bash
python research_report_search.py --query "央行货币政策" --date-from "2024-01-01" --date-to "2024-03-31" --output monetary_policy.json --format json
```

## 数据来源声明

**重要**：在使用本技能返回的数据时，必须明确标注数据来源：

```
根据同花顺问财提供的研究报告数据，以下是相关分析：

1. 《2024年人工智能行业发展趋势报告》
   数据来源：同花顺问财
   发布时间：2024-01-15
   投资评级：买入
   目标价：120元
   
2. 《金融科技AI应用研究报告》
   数据来源：同花顺问财
   发布时间：2024-01-14
   投资评级：增持
   目标价：95元
```

## 注意事项

1. **API密钥安全**: API密钥必须通过环境变量设置，不要硬编码在代码中
2. **认证方式**: 必须使用Bearer Token认证方式
3. **数据来源标注**: 必须明确标注数据来源于同花顺问财
4. **使用限制**: 遵守接口调用频率限制
5. **错误处理**: 技能包含完善的错误处理和重试机制

## 技术支持

如有问题，请参考：
- `SKILL.md`: 技能详细说明文档
- `references/api.md`: 接口文档
- 示例代码：`scripts/example_usage.py`

---

**技能版本**: 1.0  
**最后更新**: 2024年  
**数据来源**: 同花顺问财财经资讯搜索接口  
**技能状态**: 正常使用