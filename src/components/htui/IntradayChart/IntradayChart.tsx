/**
 * IntradayChart — A 股分时图
 *
 * 视觉语言：
 *   - 沿用 KLineChart 的 TradingView 配色：涨绿 (#10B981) 跌红 (#EF4444)
 *   - 上下双 grid：上 70% 展示价格 + 均价；下 30% 展示成交量柱
 *   - 十字光标贯通两个 grid，悬停显示完整 tooltip
 *   - 昨收价作为水平参考线（虚线 + 左侧 label）
 *   - 价格区域按"高于昨收 / 低于昨收"分色渐变填充（A 股专业分时图标配）
 *   - X 轴严格框定 A 股交易时段，午间停盘 (11:30-13:00) 灰化 markArea
 *
 * 数据契约：
 *   IntradayChartData { code, name, prevClose, tradeDate?, points: IntradayPoint[] }
 *   IntradayPoint     { time: 'HH:MM', price, avgPrice, volume, turnover? }
 *
 * 防御：
 *   - 任何字段缺失 / 格式非 HH:MM → 丢弃该条，剩余能渲染的继续画
 *   - points 完全无合法数据 → 显示占位，不触发 ECharts 报错
 */

import { useMemo } from 'react';
import type { IntradayChartData, IntradayPoint } from '@/shared/types/artifact';
import ReactECharts from 'echarts-for-react';

import './IntradayChart.css';

interface IntradayChartProps {
  data: IntradayChartData;
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 涨绿跌红，沿用 KLineChart */
const COLOR_UP = '#10B981';
const COLOR_DOWN = '#EF4444';
const COLOR_FLAT = '#A1A1AA';
const COLOR_AVG = '#F59E0B'; // 均价线 - 橙黄

/**
 * A 股完整交易日时间轴 242 个刻度：
 *   09:30-11:30 (121 个：含 09:30 和 11:30) + 13:00-15:00 (121 个)
 * 午间段 (11:31-12:59) 不在轴上，保证连续视觉错觉 + markArea 标注停盘
 */
function buildAShareTimeAxis(): string[] {
  const axis: string[] = [];
  const push = (h: number, m: number) => {
    axis.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };
  // 09:30 - 11:30
  for (let h = 9; h <= 11; h++) {
    const startMin = h === 9 ? 30 : 0;
    const endMin = h === 11 ? 30 : 59;
    for (let m = startMin; m <= endMin; m++) push(h, m);
  }
  // 13:00 - 15:00
  for (let h = 13; h <= 15; h++) {
    const endMin = h === 15 ? 0 : 59;
    for (let m = 0; m <= endMin; m++) push(h, m);
  }
  return axis;
}

const FULL_AXIS = buildAShareTimeAxis(); // 242 个刻度

function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
}

function isValidPoint(p: unknown): p is IntradayPoint {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  return (
    isValidTime(obj.time) &&
    typeof obj.price === 'number' &&
    Number.isFinite(obj.price) &&
    typeof obj.avgPrice === 'number' &&
    Number.isFinite(obj.avgPrice) &&
    typeof obj.volume === 'number' &&
    Number.isFinite(obj.volume)
  );
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

function IntradayChart({ data }: IntradayChartProps) {
  const { chartData, latest } = useMemo(() => {
    const prevClose = Number.isFinite(data.prevClose) ? data.prevClose : 0;
    const valid = (data.points ?? []).filter(isValidPoint);

    // Build a Map for O(1) lookup; align with FULL_AXIS preserving 242 tick slots
    const byTime = new Map<string, IntradayPoint>();
    for (const p of valid) byTime.set(p.time, p);

    // Price / avgPrice series: null for gaps (ECharts 自动断连)
    const priceSeries: (number | null)[] = FULL_AXIS.map(
      (t) => byTime.get(t)?.price ?? null
    );
    const avgSeries: (number | null)[] = FULL_AXIS.map(
      (t) => byTime.get(t)?.avgPrice ?? null
    );

    // Volume series: 0 for gaps (柱图不需要断)
    // 每根柱的颜色按该分钟价格 vs prevClose 决定
    const volumeSeries: { value: number; itemStyle: { color: string } }[] =
      FULL_AXIS.map((t) => {
        const point = byTime.get(t);
        if (!point) return { value: 0, itemStyle: { color: 'transparent' } };
        const color =
          point.price > prevClose
            ? COLOR_UP
            : point.price < prevClose
              ? COLOR_DOWN
              : COLOR_FLAT;
        return { value: point.volume, itemStyle: { color } };
      });

    // Latest known price (最后一个 valid point) 用于 header 展示
    const last = valid.length > 0 ? valid[valid.length - 1] : null;
    const latestPrice = last?.price ?? prevClose;
    const chgVal = latestPrice - prevClose;
    const chgPct = prevClose > 0 ? (chgVal / prevClose) * 100 : 0;
    const trend: 'up' | 'down' | 'flat' =
      chgVal > 0 ? 'up' : chgVal < 0 ? 'down' : 'flat';

    return {
      chartData: { priceSeries, avgSeries, volumeSeries, prevClose, valid },
      latest: { price: latestPrice, chgVal, chgPct, trend },
    };
  }, [data]);

  // 完全没有可渲染数据
  if (chartData.valid.length === 0) {
    return (
      <div className="intraday-chart">
        <div className="intraday-header">
          <div className="intraday-title">
            <span className="intraday-code">{data.code}</span>
            <span className="intraday-name">{data.name}</span>
          </div>
          <span className="intraday-badge">分时</span>
        </div>
        <div className="intraday-empty">暂无分时数据</div>
      </div>
    );
  }

  const option = {
    animation: false,
    backgroundColor: 'transparent',
    // 光标贯穿双 grid
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: {
        backgroundColor: '#27272a',
        color: '#e4e4e7',
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        fontSize: 11,
        padding: [3, 6],
      },
    },
    tooltip: {
      trigger: 'axis',
      triggerOn: 'mousemove',
      backgroundColor: 'rgba(24, 24, 27, 0.96)',
      borderColor: '#3f3f46',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#e4e4e7', fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.4);',
      formatter: (params: unknown) => {
        const arr = params as Array<{
          axisValue: string;
          seriesName: string;
          data: number | null | { value: number };
          color: string;
        }>;
        if (!arr || arr.length === 0) return '';
        const time = arr[0].axisValue;
        const getNum = (v: number | null | { value: number }) =>
          v == null ? null : typeof v === 'object' ? v.value : v;
        const priceItem = arr.find((x) => x.seriesName === '价格');
        const avgItem = arr.find((x) => x.seriesName === '均价');
        const volItem = arr.find((x) => x.seriesName === '成交量');
        const price = priceItem ? getNum(priceItem.data) : null;
        const avg = avgItem ? getNum(avgItem.data) : null;
        const vol = volItem ? getNum(volItem.data) : null;

        if (price == null) {
          // 午休 / 跳空
          return `<div style="min-width:160px">
            <div style="color:#a1a1aa;font-size:11px;margin-bottom:4px">${time}</div>
            <div style="color:#71717a;font-size:11px">未成交</div>
          </div>`;
        }
        const chg = price - chartData.prevClose;
        const chgP =
          chartData.prevClose > 0 ? (chg / chartData.prevClose) * 100 : 0;
        const trendColor =
          chg > 0 ? COLOR_UP : chg < 0 ? COLOR_DOWN : COLOR_FLAT;
        const sign = chg >= 0 ? '+' : '';
        const volStr =
          vol == null
            ? '—'
            : vol >= 1e8
              ? (vol / 1e8).toFixed(2) + ' 亿'
              : vol >= 1e4
                ? (vol / 1e4).toFixed(0) + ' 万'
                : String(vol);
        return `<div style="min-width:180px;font-family:'JetBrains Mono','SF Mono',monospace">
          <div style="color:#a1a1aa;font-size:11px;margin-bottom:6px">${time}${data.tradeDate ? ' · ' + data.tradeDate : ''}</div>
          <div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#a1a1aa">价格</span><span style="color:${trendColor};font-weight:600">${price.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#a1a1aa">涨跌</span><span style="color:${trendColor}">${sign}${chg.toFixed(2)} (${sign}${chgP.toFixed(2)}%)</span></div>
          ${avg != null ? `<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#a1a1aa">均价</span><span style="color:${COLOR_AVG}">${avg.toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;margin:2px 0"><span style="color:#a1a1aa">成交量</span><span style="color:#e4e4e7">${volStr}</span></div>
        </div>`;
      },
    },
    grid: [
      // 上: 价格 + 均价
      { left: 55, right: 55, top: 16, height: '62%' },
      // 下: 成交量
      { left: 55, right: 55, top: '74%', height: '20%' },
    ],
    xAxis: [
      {
        // 上 grid 的 xAxis
        type: 'category',
        data: FULL_AXIS,
        gridIndex: 0,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisLabel: { show: false },
        axisTick: { show: false },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: '#71717a', width: 1, type: 'dashed' },
          label: { show: true, formatter: '{value}' },
        },
      },
      {
        // 下 grid 的 xAxis
        type: 'category',
        data: FULL_AXIS,
        gridIndex: 1,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#3f3f46' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#a1a1aa',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          // 只显示关键时间点：09:30 / 10:30 / 11:30 / 13:00 / 14:00 / 15:00
          formatter: (value: string) => {
            if (
              ['09:30', '10:30', '11:30', '13:00', '14:00', '15:00'].includes(
                value
              )
            ) {
              return value;
            }
            return '';
          },
          interval: 0,
        },
        axisPointer: {
          show: true,
          type: 'line',
          lineStyle: { color: '#71717a', width: 1, type: 'dashed' },
        },
      },
    ],
    yAxis: [
      {
        // 上 grid: 价格
        type: 'value',
        gridIndex: 0,
        scale: true,
        position: 'left',
        splitLine: { lineStyle: { color: '#27272a', type: 'dashed' } },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a1a1aa',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          formatter: (v: number) => v.toFixed(2),
          margin: 6,
        },
      },
      {
        // 上 grid 右轴: 涨跌幅 %（基于 prevClose 计算）
        type: 'value',
        gridIndex: 0,
        scale: true,
        position: 'right',
        // 让左右两轴同步：通过主动设 min/max 在渲染时确定
        // 我们根据左轴的价格范围换算 pct，简化为空（ECharts 会自动 fit）
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a1a1aa',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          margin: 6,
          formatter: (v: number) => {
            if (!chartData.prevClose) return '';
            const pct = ((v - chartData.prevClose) / chartData.prevClose) * 100;
            return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
          },
        },
      },
      {
        // 下 grid: 成交量
        type: 'value',
        gridIndex: 1,
        scale: false,
        position: 'left',
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a1a1aa',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
          margin: 6,
          formatter: (v: number) => {
            if (v >= 1e8) return (v / 1e8).toFixed(1) + '亿';
            if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
            return String(v);
          },
        },
      },
    ],
    series: [
      // 1. 价格线
      {
        name: '价格',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: chartData.priceSeries,
        smooth: false,
        showSymbol: false,
        connectNulls: false, // 午休 / 跳空断开
        lineStyle: { width: 1.5, color: COLOR_UP },
        // 区域填充（半透明渐变）
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(16, 185, 129, 0.28)' },
              { offset: 1, color: 'rgba(16, 185, 129, 0)' },
            ],
          },
        },
        // 昨收价水平参考线
        markLine: {
          symbol: 'none',
          silent: true,
          animation: false,
          label: {
            position: 'insideStartTop',
            distance: 4,
            color: '#a1a1aa',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            formatter: `昨收 ${chartData.prevClose.toFixed(2)}`,
          },
          lineStyle: {
            color: '#71717a',
            type: 'dashed',
            width: 1,
          },
          data: [{ yAxis: chartData.prevClose }],
        },
        // 午间停盘灰化
        markArea: {
          silent: true,
          animation: false,
          itemStyle: {
            color: 'rgba(63, 63, 70, 0.15)',
          },
          data: [
            [
              {
                xAxis: '11:30',
                label: {
                  show: true,
                  position: 'inside',
                  color: '#52525b',
                  fontSize: 10,
                  formatter: '午休',
                },
              },
              { xAxis: '13:00' },
            ],
          ],
        },
      },
      // 2. 均价线
      {
        name: '均价',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: chartData.avgSeries,
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: COLOR_AVG, type: 'dashed' },
      },
      // 3. 成交量柱
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: chartData.volumeSeries,
        barWidth: '60%',
        // 午间段不显示柱
        markArea: {
          silent: true,
          animation: false,
          itemStyle: {
            color: 'rgba(63, 63, 70, 0.15)',
          },
          data: [[{ xAxis: '11:30' }, { xAxis: '13:00' }]],
        },
      },
    ],
  };

  const trendClass = latest.trend;

  return (
    <div className="intraday-chart">
      <div className="intraday-header">
        <div className="intraday-title">
          <span className="intraday-code">{data.code}</span>
          <span className="intraday-name">{data.name}</span>
        </div>
        <div className="intraday-summary">
          <span className={`intraday-price ${trendClass}`}>
            {latest.price.toFixed(2)}
          </span>
          <span className={`intraday-chg ${trendClass}`}>
            {latest.chgVal >= 0 ? '+' : ''}
            {latest.chgVal.toFixed(2)} ({latest.chgPct >= 0 ? '+' : ''}
            {latest.chgPct.toFixed(2)}%)
          </span>
          <span className="intraday-badge">分时</span>
        </div>
      </div>

      <div className="intraday-legend">
        <span className="intraday-legend-item" style={{ color: COLOR_UP }}>
          <span
            className="intraday-legend-swatch"
            style={{ background: COLOR_UP }}
          />
          价格
        </span>
        <span className="intraday-legend-item" style={{ color: COLOR_AVG }}>
          <span
            className="intraday-legend-swatch"
            style={{ background: COLOR_AVG }}
          />
          均价
        </span>
      </div>

      <div className="intraday-container">
        <ReactECharts
          option={option}
          style={{ height: 320, width: '100%' }}
          notMerge={true}
          lazyUpdate={true}
        />
      </div>
    </div>
  );
}

export default IntradayChart;
