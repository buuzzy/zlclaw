import { lazy, Suspense } from 'react';
import type {
  AIHotNewsData,
  Artifact,
  BarChartData,
  DataTableData,
  FinanceBreakfastData,
  FinancialHealthData,
  KLineChartData,
  LineChartData,
  NewsFeedData,
  NewsListData,
  QuoteCardData,
  ResearchConsensusData,
  SectorHeatmapData,
  StockSnapshotData,
} from '@/shared/types/artifact';

// High-frequency components: static import to avoid Suspense flash on first render.
// These chunks are tiny (2-8KB each) so the bundle size cost is negligible.
import QuoteCard from './QuoteCard/QuoteCard';
import KLineChart from './KLineChart/KLineChart';
import DataTable from './DataTable/DataTable';

// Low-frequency components: keep lazy to reduce initial bundle size.
const NewsCard = lazy(() => import('./NewsCard/NewsCard'));
const FinanceBreakfast = lazy(
  () => import('./FinanceBreakfast/FinanceBreakfast')
);
const AIHotNews = lazy(() => import('./AIHotNews/AIHotNews'));
const BarChart = lazy(() => import('./BarChart/BarChart'));
const LineChart = lazy(() => import('./LineChart/LineChart'));
const StockSnapshot = lazy(() => import('./StockSnapshot/StockSnapshot'));
const SectorHeatmap = lazy(() => import('./SectorHeatmap/SectorHeatmap'));
const ResearchConsensus = lazy(
  () => import('./ResearchConsensus/ResearchConsensus')
);
const FinancialHealth = lazy(() => import('./FinancialHealth/FinancialHealth'));
const NewsFeed = lazy(() => import('./NewsFeed/NewsFeed'));

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
    case 'stock-snapshot':
      return (
        <StockSnapshot key={key} data={artifact.data as StockSnapshotData} />
      );
    case 'sector-heatmap':
      return (
        <SectorHeatmap key={key} data={artifact.data as SectorHeatmapData} />
      );
    case 'research-consensus':
      return (
        <ResearchConsensus
          key={key}
          data={artifact.data as ResearchConsensusData}
        />
      );
    case 'financial-health':
      return (
        <FinancialHealth
          key={key}
          data={artifact.data as FinancialHealthData}
        />
      );
    case 'news-feed':
      return <NewsFeed key={key} data={artifact.data as NewsFeedData} />;
    default:
      return null;
  }
}

export function ArtifactRenderer({ artifacts }: ArtifactRendererProps) {
  if (!artifacts || artifacts.length === 0) return null;

  return (
    <Suspense fallback={null}>
      <div className="my-3 flex flex-col gap-4">
        {artifacts.map((artifact, i) => renderSingleArtifact(artifact, i))}
      </div>
    </Suspense>
  );
}
