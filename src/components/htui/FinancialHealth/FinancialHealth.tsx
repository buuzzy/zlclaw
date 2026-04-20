import type {
  FinancialDimension,
  FinancialHealthData,
} from '@/shared/types/artifact';

import './FinancialHealth.css';

interface Props {
  data: FinancialHealthData;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score: number): string {
  if (score >= 80) return '优秀';
  if (score >= 60) return '良好';
  if (score >= 40) return '一般';
  return '偏弱';
}

function trendIcon(trend?: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '';
}

function DimensionCard({ dim }: { dim: FinancialDimension }) {
  const color = scoreColor(dim.score);
  return (
    <div className="fh-dim-card">
      <div className="fh-dim-header">
        <span className="fh-dim-label">{dim.label}</span>
        <span className="fh-dim-score" style={{ color }}>
          {dim.score}
        </span>
      </div>
      <div className="fh-score-bar-track">
        <div
          className="fh-score-bar-fill"
          style={{ width: `${dim.score}%`, background: color }}
        />
      </div>
      <div className="fh-dim-tag" style={{ color }}>
        {scoreLabel(dim.score)}
      </div>
      <div className="fh-dim-metrics">
        {(dim.metrics ?? []).map((m, i) => (
          <div key={i} className="fh-metric-row">
            <span className="fh-metric-label">{m.label}</span>
            <span
              className={`fh-metric-value ${
                m.trend === 'up' ? 'up' : m.trend === 'down' ? 'down' : ''
              }`}
            >
              {m.value}
              {m.trend && m.trend !== 'flat' && (
                <span className="fh-trend-icon">{trendIcon(m.trend)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinancialHealth({ data }: Props) {
  return (
    <div className="fh-card">
      <div className="fh-header">
        <div className="fh-title-group">
          <span className="fh-company">{data.name}</span>
          <span className="fh-code">{data.code}</span>
        </div>
        <span className="fh-year">{data.year}</span>
      </div>

      <div className="fh-grid">
        {(data.dimensions ?? []).map((dim, i) => (
          <DimensionCard key={i} dim={dim} />
        ))}
      </div>

      {data.summary && <div className="fh-summary">{data.summary}</div>}
    </div>
  );
}

export default FinancialHealth;
