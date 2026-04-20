import type { SectorHeatmapData } from '@/shared/types/artifact';
import ReactECharts from 'echarts-for-react';

import './SectorHeatmap.css';

interface Props {
  data: SectorHeatmapData;
}

// Map a chgPct value to a color using a red-gray-green gradient
function chgColor(pct: number): string {
  // Clamp to [-5, 5]
  const t = Math.max(-1, Math.min(1, pct / 5));
  if (t >= 0) {
    // 0 → #3f3f46, +1 → #16a34a
    const r = Math.round(63 + (22 - 63) * t);
    const g = Math.round(63 + (163 - 63) * t);
    const b = Math.round(70 + (74 - 70) * t);
    return `rgb(${r},${g},${b})`;
  } else {
    // 0 → #3f3f46, -1 → #dc2626
    const r = Math.round(63 + (220 - 63) * -t);
    const g = Math.round(63 + (38 - 63) * -t);
    const b = Math.round(70 + (38 - 70) * -t);
    return `rgb(${r},${g},${b})`;
  }
}

function SectorHeatmap({ data }: Props) {
  const treeData = (data.items ?? []).map((item) => ({
    name: item.name,
    value: item.vol && item.vol > 0 ? item.vol : 1,
    chgPct: item.chgPct,
    itemStyle: { color: chgColor(item.chgPct) },
    label: {
      show: true,
      formatter: (params: { data: { name: string; chgPct: number } }) =>
        `${params.data.name}\n${params.data.chgPct >= 0 ? '+' : ''}${params.data.chgPct.toFixed(2)}%`,
    },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item' as const,
      formatter: (params: {
        data: { name: string; chgPct: number; value: number };
      }) =>
        `${params.data.name}<br/>涨跌幅: ${
          params.data.chgPct >= 0 ? '+' : ''
        }${params.data.chgPct.toFixed(2)}%`,
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        data: treeData,
        label: {
          show: true,
          color: 'rgba(255,255,255,0.9)',
          fontSize: 11,
          fontWeight: 'bold' as const,
          lineHeight: 16,
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: 'var(--bg-secondary, #1c1c1e)',
          gapWidth: 2,
        },
        emphasis: {
          itemStyle: {
            borderWidth: 2,
            borderColor: '#ffffff33',
          },
        },
      },
    ],
  };

  return (
    <div className="sh-card">
      <div className="sh-header">
        <span className="sh-title">{data.title}</span>
        <span className="sh-date">{data.date}</span>
      </div>
      <div className="sh-legend">
        <span className="sh-legend-item down">-5%</span>
        <div className="sh-legend-bar" />
        <span className="sh-legend-item neutral">0%</span>
        <div className="sh-legend-bar green" />
        <span className="sh-legend-item up">+5%</span>
      </div>
      <ReactECharts
        option={option}
        style={{ height: 340, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    </div>
  );
}

export default SectorHeatmap;
