import { useEffect, useRef } from 'react';
import type { KLineChartData, KLineDataPoint } from '@/shared/types/artifact';
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  type IChartApi,
} from 'lightweight-charts';

import './KLineChart.css';

function calculateMA(
  points: KLineDataPoint[],
  period: number
): { time: string; value: number }[] {
  const result: { time: string; value: number }[] = [];
  for (let i = period - 1; i < points.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += points[j].close;
    result.push({ time: points[i].time, value: sum / period });
  }
  return result;
}

const MA_CONFIG = [
  { period: 5, color: '#F59E0B', label: 'MA5' },
  { period: 10, color: '#06B6D4', label: 'MA10' },
  { period: 20, color: '#A855F7', label: 'MA20' },
] as const;

const KTYPE_LABELS: Record<string, string> = {
  day: '日K',
  week: '周K',
  month: '月K',
};

interface KLineChartProps {
  data: KLineChartData;
}

function KLineChart({ data }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.data.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { color: '#1e1e1e' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderUpColor: '#10B981',
      borderDownColor: '#EF4444',
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    candleSeries.setData(
      data.data.map((d) => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
    );

    for (const ma of MA_CONFIG) {
      const maData = calculateMA(data.data, ma.period);
      if (maData.length > 0) {
        const series = chart.addSeries(LineSeries, {
          color: ma.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(maData);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      chart.applyOptions({ width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  return (
    <div className="kline-chart">
      <div className="kline-header">
        <div className="kline-title">
          <span className="kline-code">{data.code}</span>
          <span className="kline-name">{data.name}</span>
        </div>
        <div className="kline-type-switcher">
          {(['day', 'week', 'month'] as const).map((t) => (
            <button
              key={t}
              className={`ktype-btn ${data.ktype === t ? 'active' : ''}`}
            >
              {KTYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="kline-legend">
        {MA_CONFIG.map((ma) => (
          <span key={ma.label} className="ma-tag" style={{ color: ma.color }}>
            {ma.label}
          </span>
        ))}
      </div>

      <div className="kline-container" ref={containerRef} />
    </div>
  );
}

export default KLineChart;
