/**
 * Context Usage Ring Component
 *
 * Displays a circular visual indicator of how much of the context window
 * is currently being used by the conversation history.
 *
 * - Shows as a thin ring with a percentage indicator
 * - Hover tooltip shows current usage in tokens and percentage
 * - Color changes based on usage level (green → yellow → red)
 */

import { useState } from 'react';
import { cn } from '@/shared/lib/utils';

export interface ContextUsageRingProps {
  /** Total tokens used in the conversation */
  currentTokens?: number;
  /** Context window limit (default: 200000) */
  contextLimit?: number;
  /** Whether the component is interactive (show tooltip on hover) */
  interactive?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get stroke color based on usage percentage
 * - 0-50%: Green (safe)
 * - 50-80%: Yellow (warning)
 * - 80-100%: Orange (critical)
 * - 100%+: Red (exceeded)
 */
function getStrokeColor(percentage: number): string {
  if (percentage < 50) return '#10b981'; // emerald-500
  if (percentage < 80) return '#eab308'; // yellow-500
  if (percentage < 100) return '#f97316'; // orange-500
  return '#ef4444'; // red-500
}

function getTextColor(percentage: number): string {
  if (percentage < 50) return '#059669'; // emerald-600
  if (percentage < 80) return '#ca8a04'; // yellow-600
  if (percentage < 100) return '#c2410c'; // orange-600
  return '#dc2626'; // red-600
}

export function ContextUsageRing({
  currentTokens = 0,
  contextLimit = 200000,
  interactive = true,
  className,
}: ContextUsageRingProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const percentage = Math.min((currentTokens / contextLimit) * 100, 100);
  const circumference = 2 * Math.PI * 18; // radius = 18
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const strokeColor = getStrokeColor(percentage);
  const textColor = getTextColor(percentage);

  return (
    <div
      className={cn('relative flex items-center justify-center', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* SVG Ring */}
      <svg width="40" height="40" viewBox="0 0 40 40" className="drop-shadow-sm">
        {/* Background ring (light gray) */}
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-slate-200 dark:text-slate-700"
        />

        {/* Usage ring (colored progress) */}
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ 
            transform: 'rotate(-90deg)', 
            transformOrigin: '20px 20px',
            transition: 'stroke-dashoffset 0.3s ease-out, stroke 0.3s ease-out'
          }}
        />

        {/* Center text showing percentage */}
        <text
          x="20"
          y="24"
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill={textColor}
          style={{ pointerEvents: 'none' }}
        >
          {Math.round(percentage)}%
        </text>
      </svg>

      {/* Tooltip */}
      {showTooltip && interactive && (
        <div
          className={cn(
            'absolute z-50 px-3 py-2 text-xs font-medium text-white rounded-lg',
            'bg-slate-900 dark:bg-slate-800 whitespace-nowrap pointer-events-none',
            'animate-in fade-in duration-200'
          )}
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="font-semibold">
            {currentTokens.toLocaleString()} / {(contextLimit / 1000).toFixed(0)}K tokens
          </div>
          <div className="text-slate-300">
            {Math.round(percentage)}% context used
          </div>
          {/* Arrow pointer */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-slate-900 dark:bg-slate-800 rotate-45"
            style={{ marginTop: '-4px' }}
          />
        </div>
      )}
    </div>
  );
}
