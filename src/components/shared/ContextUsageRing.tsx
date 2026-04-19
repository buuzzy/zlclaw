/**
 * Context Usage Ring Component
 *
 * A minimal ambient indicator of context window usage.
 * Intentionally unobtrusive: stays near-invisible at low usage,
 * only grows in visual weight as the context approaches its limit.
 *
 * - 20×20px ring — smaller than the send button
 * - No center text: color + fill level communicate status silently
 * - Opacity scales with urgency (0.25 → 1.0)
 * - Hover tooltip shows exact token count and percentage
 * - Color: green → yellow → orange → red
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

function getStrokeColor(percentage: number): string {
  if (percentage < 50) return '#10b981'; // emerald-500
  if (percentage < 80) return '#eab308'; // yellow-500
  if (percentage < 100) return '#f97316'; // orange-500
  return '#ef4444'; // red-500
}

/** Opacity scales up with urgency so the ring "appears" as context fills */
function getOpacity(percentage: number): number {
  if (percentage < 50) return 0.25;
  if (percentage < 80) return 0.55;
  if (percentage < 100) return 0.85;
  return 1;
}

export function ContextUsageRing({
  currentTokens = 0,
  contextLimit = 200000,
  interactive = true,
  className,
}: ContextUsageRingProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const percentage = Math.min((currentTokens / contextLimit) * 100, 100);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const strokeColor = getStrokeColor(percentage);
  const opacity = getOpacity(percentage);

  return (
    <div
      className={cn('relative flex items-center justify-center', className)}
      onMouseEnter={() => interactive && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{ opacity, transition: 'opacity 0.4s ease-out' }}
    >
      {/* SVG Ring — 20×20px, no center text */}
      <svg width="20" height="20" viewBox="0 0 20 20">
        {/* Background track */}
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-slate-300 dark:text-slate-600"
        />
        {/* Progress arc */}
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '10px 10px',
            transition: 'stroke-dashoffset 0.3s ease-out, stroke 0.3s ease-out',
          }}
        />
      </svg>

      {/* Tooltip */}
      {showTooltip && interactive && (
        <div
          className={cn(
            'absolute bottom-full left-1/2 mb-2 -translate-x-1/2',
            'z-50 rounded-lg px-3 py-2 text-xs font-medium text-white',
            'pointer-events-none bg-slate-900 whitespace-nowrap dark:bg-slate-800',
            'animate-in fade-in duration-150'
          )}
        >
          <div className="font-semibold">
            {currentTokens.toLocaleString()} /{' '}
            {(contextLimit / 1000).toFixed(0)}K tokens
          </div>
          <div className="text-slate-400">
            {Math.round(percentage)}% context used
          </div>
          {/* Arrow */}
          <div
            className="absolute top-full left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900 dark:bg-slate-800"
            style={{ marginTop: '-4px' }}
          />
        </div>
      )}
    </div>
  );
}
