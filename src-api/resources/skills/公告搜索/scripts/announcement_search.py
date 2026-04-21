import requests
import json
import time
import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime

from config import config
from utils import Utils

logger = logging.getLogger(__name__)

class AnnouncementSearch:
    def __init__(self):
        self.api_config = config.get_api_config()
        self.search_config = config.get_search_config()
        self.api_key = config.get_api_key()
        
        self.base_url = self.api_config["base_url"]
        self.endpoint = self.api_config["endpoint"]
        self.timeout = self.api_config["timeout"]
        self.max_retries = self.api_config["max_retries"]
        
        self.channels = self.search_config["channels"]
        self.app_id = self.search_config["app_id"]
        
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
    
    def search(self, query: str, limit: int = 10) -> Tuple[bool, List[Dict[str, Any]], str]:
        if not Utils.validate_query(query):
            return False, [], "查询参数无效"
        
        logger.info(f"搜索公告: {query}")
        
        payload = {
            "channels": self.channels,
            "app_id": self.app_id,
            "query": query
        }
        
        url = f"{self.base_url}{self.endpoint}"
        
        for attempt in range(self.max_retries):
            try:
                logger.debug(f"请求URL: {url}")
                logger.debug(f"请求参数: {payload}")
                
                response = requests.post(
                    url,
                    headers=self.headers,
                    json=payload,
                    timeout=self.timeout
                )
                
                logger.debug(f"响应状态码: {response.status_code}")
                
                if response.status_code == 200:
                    result = response.json()
                    data = result.get("data", [])
                    
                    if data:
                        processed_data = self._process_results(data[:limit])
                        logger.info(f"找到 {len(processed_data)} 条公告")
                        return True, processed_data, "搜索成功"
                    else:
                        logger.info("未找到相关公告")
                        return True, [], "未找到相关公告"
                
                elif response.status_code == 401:
                    logger.error("API认证失败")
                    return False, [], "API认证失败，请检查API Key"
                
                elif response.status_code == 400:
                    logger.error("请求参数错误")
                    return False, [], "请求参数错误"
                
                elif response.status_code == 429:
                    logger.warning("请求过于频繁，等待后重试")
                    if attempt < self.max_retries - 1:
                        time.sleep(2 ** attempt)
                        continue
                    else:
                        return False, [], "请求过于频繁，请稍后再试"
                
                else:
                    logger.error(f"API请求失败: {response.status_code}")
                    return False, [], f"API请求失败: {response.status_code}"
            
            except requests.exceptions.Timeout:
                logger.warning(f"请求超时 (尝试 {attempt + 1}/{self.max_retries})")
                if attempt < self.max_retries - 1:
                    time.sleep(1)
                    continue
                else:
                    logger.error("请求超时，已达到最大重试次数")
                    return False, [], "请求超时，请检查网络连接"
            
            except requests.exceptions.ConnectionError:
                logger.error("网络连接错误")
                return False, [], "网络连接错误，请检查网络连接"
            
            except requests.exceptions.RequestException as e:
                logger.error(f"请求异常: {e}")
                return False, [], f"请求异常: {str(e)}"
            
            except json.JSONDecodeError as e:
                logger.error(f"JSON解析错误: {e}")
                return False, [], "响应数据解析错误"
            
            except Exception as e:
                logger.error(f"未知错误: {e}")
                return False, [], f"未知错误: {str(e)}"
        
        return False, [], "搜索失败，已达到最大重试次数"
    
    def _process_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        processed = []
        
        for result in results:
            processed_result = {
                "title": result.get("title", ""),
                "summary": result.get("summary", ""),
                "url": result.get("url", ""),
                "publish_date": result.get("publish_date", "")
            }
            
            processed.append(processed_result)
        
        return processed
    
    def batch_search(self, queries: List[str], limit_per_query: int = 10) -> Dict[str, Tuple[bool, List[Dict[str, Any]], str]]:
        results = {}
        
        logger.info(f"开始批量搜索，共 {len(queries)} 个查询")
        
        for i, query in enumerate(queries, 1):
            logger.info(f"处理查询 {i}/{len(queries)}: {query}")
            
            success, data, message = self.search(query, limit_per_query)
            results[query] = (success, data, message)
            
            time.sleep(config.get_performance_config().get("request_delay", 0.5))
        
        logger.info("批量搜索完成")
        return results
    
    def smart_query_analysis(self, user_query: str) -> List[str]:
        logger.info(f"智能分析用户查询: {user_query}")
        
        queries = []
        
        if "和" in user_query or "与" in user_query or "、" in user_query:
            parts = user_query.replace("和", ",").replace("与", ",").replace("、", ",").split(",")
            for part in parts:
                part = part.strip()
                if part:
                    queries.append(f"{part} 公告")
        else:
            queries.append(user_query)
        
        logger.info(f"分析后的查询列表: {queries}")
        return queries
    
    def evaluate_results(self, query: str, results: List[Dict[str, Any]]) -> Tuple[bool, str]:
        if not results:
            return False, "未找到相关结果"
        
        query_keywords = set(query.lower().split())
        
        relevance_scores = []
        for result in results:
            title = result.get("title", "").lower()
            summary = result.get("summary", "").lower()
            
            score = 0
            for keyword in query_keywords:
                if keyword in title:
                    score += 3
                if keyword in summary:
                    score += 1
            
            relevance_scores.append(score)
        
        avg_score = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0
        
        if avg_score >= 2:
            return True, "结果相关性较高"
        elif avg_score >= 1:
            return True, "结果相关性一般"
        else:
            return False, "结果相关性较低"
    
    def generate_search_summary(self, query: str, results: List[Dict[str, Any]]) -> str:
        if not results:
            return f"对于查询 '{query}'，未找到相关公告信息。"
        
        summary_lines = []
        summary_lines.append(f"搜索查询：{query}")
        summary_lines.append(f"找到 {len(results)} 条相关公告：")
        summary_lines.append("")
        
        for i, result in enumerate(results[:5], 1):
            title = result.get("title", "")
            publish_date = result.get("publish_date", "")
            summary_lines.append(f"{i}. {title} ({publish_date})")
        
        if len(results) > 5:
            summary_lines.append(f"... 还有 {len(results) - 5} 条结果")
        
        summary_lines.append("")
        summary_lines.append("数据来源：同花顺问财")
        
        return "\n".join(summary_lines)

if __name__ == "__main__":
    Utils.setup_logging("INFO")
    
    search = AnnouncementSearch()
    
    test_queries = [
        "贵州茅台 公告",
        "上市公司业绩预告",
        "分红派息"
    ]
    
    for query in test_queries:
        print(f"\n测试查询: {query}")
        print("-" * 50)
        
        success, results, message = search.search(query, limit=3)
        
        if success:
            print(f"状态: {message}")
            print(f"找到 {len(results)} 条结果:")
            
            for i, result in enumerate(results, 1):
                print(f"{i}. {result.get('title', '')}")
                print(f"   发布时间: {result.get('publish_date', '')}")
                print(f"   摘要: {result.get('summary', '')[:50]}...")
                print()
        else:
            print(f"错误: {message}")
    
    print("\n测试智能查询分析:")
    complex_query = "贵州茅台和五粮液最近有什么公告"
    analyzed_queries = search.smart_query_analysis(complex_query)
    print(f"原始查询: {complex_query}")
    print(f"分析后的查询: {analyzed_queries}")
    
    print("\n测试结果评估:")
    test_results = [
        {"title": "贵州茅台2023年度业绩预告", "summary": "公司预计2023年度净利润增长", "url": "", "publish_date": ""},
        {"title": "五粮液分红公告", "summary": "公司宣布年度分红方案", "url": "", "publish_date": ""}
    ]
    relevance, evaluation = search.evaluate_results("贵州茅台 业绩预告", test_results)
    print(f"相关性: {relevance}, 评估: {evaluation}")