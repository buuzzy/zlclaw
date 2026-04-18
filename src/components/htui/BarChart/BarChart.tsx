import ReactECharts from "echarts-for-react";
import type { BarChartData } from "@/shared/types/artifact";
import "./BarChart.css";

interface BarChartProps {
  data: BarChartData;
}

function BarChart({ data }: BarChartProps) {
  const option = {
    title: {
      text: data.title,
      left: "center",
      textStyle: { color: "#e4e4e7", fontSize: 14, fontWeight: 500 },
    },
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "shadow" as const },
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
      data: data.categories,
      axisLabel: { color: "#a1a1aa", fontSize: 11 },
      axisLine: { lineStyle: { color: "#3f3f46" } },
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
      type: "bar" as const,
      data: s.data,
      barMaxWidth: 40,
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    })),
    backgroundColor: "transparent",
  };

  return (
    <div className="bar-chart-card">
      <ReactECharts
        option={option}
        style={{ height: 320, width: "100%" }}
        opts={{ renderer: "svg" }}
        theme="dark"
      />
    </div>
  );
}

export default BarChart;
