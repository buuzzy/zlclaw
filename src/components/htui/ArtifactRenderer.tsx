import { Suspense, lazy } from 'react';
import type { Artifact } from '@/shared/types/artifact';
import type {
  QuoteCardData,
  KLineChartData,
  NewsListData,
  FinanceBreakfastData,
  AIHotNewsData,
  BarChartData,
  LineChartData,
  DataTableData,
} from '@/shared/types/artifact';

const QuoteCard = lazy(() => import('./QuoteCard/QuoteCard'));
const KLineChart = lazy(() => import('./KLineChart/KLineChart'));
const NewsCard = lazy(() => import('./NewsCard/NewsCard'));
const FinanceBreakfast = lazy(() => import('./FinanceBreakfast/FinanceBreakfast'));
const AIHotNews = lazy(() => import('./AIHotNews/AIHotNews'));
const BarChart = lazy(() => import('./BarChart/BarChart'));
const LineChart = lazy(() => import('./LineChart/LineChart'));
const DataTable = lazy(() => import('./DataTable/DataTable'));

interface ArtifactRendererProps {
  artifacts: Artifact[];
}

function renderSingleArtifact(artifact: Artifact, index: number) {
  const key = `artifact-${artifact.type}-${index}`;

  switch (artifact.type) {
    case 'quote-card':
      return <QuoteCard key={key} data={artifact.data as QuoteCardData} />;
    case 'kline-chart':
      return <KLineChart key={key} data={artifact.data as KLineChartData} />;
    case 'news-list':
      return <NewsCard key={key} data={artifact.data as NewsListData} />;
    case 'finance-breakfast':
      return (
        <FinanceBreakfast
          key={key}
          data={artifact.data as FinanceBreakfastData}
        />
      );
    case 'ai-hot-news':
      return <AIHotNews key={key} data={artifact.data as AIHotNewsData} />;
    case 'bar-chart':
      return <BarChart key={key} data={artifact.data as BarChartData} />;
    case 'line-chart':
      return <LineChart key={key} data={artifact.data as LineChartData} />;
    case 'data-table':
      return <DataTable key={key} data={artifact.data as DataTableData} />;
    default:
      return null;
  }
}

export function ArtifactRenderer({ artifacts }: ArtifactRendererProps) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <Suspense fallback={<div className="h-20 animate-pulse rounded-lg bg-zinc-800/50" />}>
      <div className="my-3 flex flex-col gap-4">
        {artifacts.map((artifact, i) => renderSingleArtifact(artifact, i))}
      </div>
    </Suspense>
  );
}
