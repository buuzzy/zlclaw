import ReactECharts from "echarts-for-react";
import type { LineChartData } from "@/shared/types/artifact";
import "./LineChart.css";

interface LineChartProps {
  data: LineChartData;
}

function LineChart({ data }: LineChartProps) {
  const option = {
    title: {
      text: data.title,
      left: "center",
      textStyle: { color: "#e4e4e7", fontSize: 14, fontWeight: 500 },
    },
    tooltip: {
      trigger: "axis" as const,
      valueFormatter: (val: number) =>
        data.unit ? `${val} ${data.unit}` : String(val),
    },
    legend: {
      bottom: 0,
      textStyle: { color: "#a1a1aa", fontSize: 12 },
      show: data.series.length > 1,
    },
    grid: { left: 60, right: 20, top: 40, bottom: data.series.length > 1 ? 36 : 12 },
    xAxis: {
      type: "category" as const,
      data: data.xAxis,
      axisLabel: { color: "#a1a1aa", fontSize: 11 },
      axisLine: { lineStyle: { color: "#3f3f46" } },
      boundaryGap: false,
    },
    yAxis: {
      type: "value" as const,
      name: data.unit ?? "",
      nameTextStyle: { color: "#71717a", fontSize: 11 },
      axisLabel: { color: "#a1a1aa", fontSize: 11 },
      splitLine: { lineStyle: { color: "#27272a" } },
    },
    series: data.series.map((s) => ({
      name: s.name,
      type: "line" as const,
      data: s.data,
      smooth: true,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2 },
      areaStyle: data.series.length === 1 ? { opacity: 0.15 } : undefined,
    })),
    backgroundColor: "transparent",
  };

  return (
    <div className="line-chart-card">
      <ReactECharts
        option={option}
        style={{ height: 320, width: "100%" }}
        opts={{ renderer: "svg" }}
        theme="dark"
      />
    </div>
  );
}

export default LineChart;
