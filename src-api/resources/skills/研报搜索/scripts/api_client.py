#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
研报搜索技能API客户端模块
"""

import json
import time
import logging
from typing import Dict, List, Any, Optional, Tuple
import requests
from requests.exceptions import RequestException, Timeout, ConnectionError

from config import get_config


class APIError(Exception):
    """API错误异常类"""
    pass


class APIClient:
    """API客户端类"""
    
    def __init__(self, config_file: Optional[str] = None):
        """
        初始化API客户端
        
        Args:
            config_file: 配置文件路径
        """
        self.config = get_config(config_file)
        self.api_url = self.config.get_api_url()
        self.api_key = self.config.get_api_key()
        self.timeout = self.config.get("api.timeout")
        self.max_retries = self.config.get("api.max_retries")
        self.retry_delay = self.config.get("api.retry_delay")
        
        # 设置日志
        self.config.setup_logging()
        self.logger = logging.getLogger(__name__)
    
    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
    
    def _prepare_payload(self, query: str, limit: Optional[int] = None) -> Dict[str, Any]:
        """准备请求体"""
        payload = {
            "channels": self.config.get("search.channels"),
            "app_id": self.config.get("search.app_id"),
            "query": query
        }
        
        # 可以添加其他参数
        if limit:
            # 注意：实际接口可能不支持limit参数，这里只是示例
            pass
        
        return payload
    
    def _make_request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """发送请求（带重试机制）"""
        headers = self._get_headers()
        
        for attempt in range(self.max_retries + 1):
            try:
                self.logger.debug(f"发送API请求 (尝试 {attempt + 1}/{self.max_retries + 1}): {payload}")
                
                response = requests.post(
                    self.api_url,
                    headers=headers,
                    json=payload,
                    timeout=self.timeout
                )
                
                self.logger.debug(f"API响应状态码: {response.status_code}")
                
                # 检查响应状态
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 401:
                    raise APIError(f"认证失败: 请检查API Key是否正确 (状态码: {response.status_code})")
                elif response.status_code == 403:
                    raise APIError(f"权限不足: 请检查API Key是否有访问权限 (状态码: {response.status_code})")
                elif response.status_code == 400:
                    error_msg = f"请求参数错误 (状态码: {response.status_code})"
                    try:
                        error_data = response.json()
                        if "message" in error_data:
                            error_msg += f": {error_data['message']}"
                    except:
                        pass
                    raise APIError(error_msg)
                elif response.status_code == 429:
                    self.logger.warning(f"请求频率限制 (状态码: {response.status_code})")
                    if attempt < self.max_retries:
                        wait_time = self.retry_delay * (attempt + 1)
                        self.logger.info(f"等待 {wait_time} 秒后重试...")
                        time.sleep(wait_time)
                        continue
                    else:
                        raise APIError(f"请求频率限制，已达到最大重试次数 (状态码: {response.status_code})")
                else:
                    raise APIError(f"API请求失败 (状态码: {response.status_code})")
                    
            except Timeout:
                self.logger.warning(f"请求超时 (尝试 {attempt + 1}/{self.max_retries + 1})")
                if attempt < self.max_retries:
                    self.logger.info(f"等待 {self.retry_delay} 秒后重试...")
                    time.sleep(self.retry_delay)
                else:
                    raise APIError("请求超时，已达到最大重试次数")
                    
            except ConnectionError:
                self.logger.warning(f"连接错误 (尝试 {attempt + 1}/{self.max_retries + 1})")
                if attempt < self.max_retries:
                    self.logger.info(f"等待 {self.retry_delay} 秒后重试...")
                    time.sleep(self.retry_delay)
                else:
                    raise APIError("连接错误，已达到最大重试次数")
                    
            except RequestException as e:
                self.logger.error(f"请求异常: {e}")
                if attempt < self.max_retries:
                    self.logger.info(f"等待 {self.retry_delay} 秒后重试...")
                    time.sleep(self.retry_delay)
                else:
                    raise APIError(f"请求异常: {str(e)}")
        
        # 不应该执行到这里
        raise APIError("未知错误")
    
    def search_reports(self, query: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        搜索研究报告
        
        Args:
            query: 搜索关键词
            limit: 结果数量限制
            
        Returns:
            研究报告列表
        """
        try:
            self.logger.info(f"搜索研究报告: {query}")
            
            # 准备请求
            payload = self._prepare_payload(query, limit)
            
            # 发送请求
            response_data = self._make_request(payload)
            
            # 提取数据
            articles = response_data.get("data", [])
            
            # 应用限制（如果接口不支持limit参数，在这里处理）
            if limit and len(articles) > limit:
                articles = articles[:limit]
            
            self.logger.info(f"找到 {len(articles)} 篇研究报告")
            return articles
            
        except APIError as e:
            self.logger.error(f"API搜索失败: {e}")
            raise
        except Exception as e:
            self.logger.error(f"搜索研究报告时发生未知错误: {e}")
            raise APIError(f"搜索失败: {str(e)}")
    
    def batch_search(self, queries: List[str], limit_per_query: Optional[int] = None) -> Dict[str, List[Dict[str, Any]]]:
        """
        批量搜索研究报告
        
        Args:
            queries: 搜索关键词列表
            limit_per_query: 每个查询的结果数量限制
            
        Returns:
            按查询关键词分组的研究报告字典
        """
        results = {}
        
        for i, query in enumerate(queries):
            try:
                self.logger.info(f"批量搜索 [{i+1}/{len(queries)}]: {query}")
                articles = self.search_reports(query, limit_per_query)
                results[query] = articles
                
                # 避免请求频率限制，添加延迟
                if i < len(queries) - 1:
                    time.sleep(0.5)
                    
            except APIError as e:
                self.logger.error(f"批量搜索失败 [{query}]: {e}")
                results[query] = []
        
        return results
    
    def test_connection(self) -> bool:
        """测试API连接"""
        try:
            self.logger.info("测试API连接...")
            
            # 使用一个简单的测试查询
            test_query = "测试"
            test_payload = self._prepare_payload(test_query)
            
            # 发送测试请求
            response = requests.post(
                self.api_url,
                headers=self._get_headers(),
                json=test_payload,
                timeout=10
            )
            
            if response.status_code == 200:
                self.logger.info("API连接测试成功")
                return True
            else:
                self.logger.warning(f"API连接测试失败 (状态码: {response.status_code})")
                return False
                
        except Exception as e:
            self.logger.error(f"API连接测试异常: {e}")
            return False


if __name__ == "__main__":
    # 测试API客户端
    import sys
    
    # 设置环境变量（测试用）
    if not os.getenv("IWENCAI_API_KEY"):
        print("请设置环境变量 IWENCAI_API_KEY")
        sys.exit(1)
    
    try:
        client = APIClient()
        
        # 测试连接
        if client.test_connection():
            print("API连接测试成功")
        else:
            print("API连接测试失败")
            sys.exit(1)
        
        # 测试搜索
        print("\n测试搜索研究报告...")
        query = "人工智能"
        articles = client.search_reports(query, limit=3)
        
        if articles:
            print(f"找到 {len(articles)} 篇关于 '{query}' 的研究报告:")
            for i, article in enumerate(articles, 1):
                print(f"\n{i}. {article.get('title', '无标题')}")
                print(f"   摘要: {article.get('summary', '无摘要')[:100]}...")
                print(f"   发布时间: {article.get('publish_date', '未知')}")
        else:
            print(f"未找到关于 '{query}' 的研究报告")
            
    except APIError as e:
        print(f"API错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"未知错误: {e}")
        sys.exit(1)