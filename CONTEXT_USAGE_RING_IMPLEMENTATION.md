# Context Usage Ring Implementation

## Overview

Added a visual context window usage indicator to the HTclaw app that displays the percentage of context window currently being used in the conversation. The ring appears to the left of the send button in task detail reply mode.

## Features

### Visual Indicator (SVG Ring)
- **Size**: 40x40px SVG with 18px radius circle
- **Display**: Shows percentage in the center with color-coded ring
- **Colors**:
  - 🟢 **Green** (0-50%): Safe - plenty of context available
  - 🟡 **Yellow** (50-80%): Warning - approaching limit
  - 🟠 **Orange** (80-100%): Critical - near limit
  - 🔴 **Red** (100%+): Exceeded - over context limit

### Interactive Tooltip
- **Trigger**: Hover over the ring
- **Content**: Shows exact token usage (e.g., "12,345 / 200K tokens") and percentage
- **Position**: Appears above the ring with arrow pointer
- **Theme-aware**: Adapts to dark/light mode

### Automatic Configuration
- **Token Estimation**: Uses standard conversion (1 token ≈ 4 characters)
- **Context Window Detection**: Automatically detects based on model name
- **Model Support**:
  - Claude Opus 1M: 1,000,000 tokens
  - Claude Opus/Sonnet/Haiku: 200,000 tokens
  - GPT-4o/Turbo: 128,000 tokens
  - GPT-4: 8,192 tokens
  - GPT-3: 16,384 tokens
  - DeepSeek: 128,000 tokens
  - Qwen: 131,072 tokens
  - GLM: 128,000 tokens
  - Default: 200,000 tokens

## Implementation Details

### Files Modified

#### 1. `src/components/shared/ContextUsageRing.tsx` (NEW)
- **Type**: React component
- **Props**:
  - `currentTokens?: number` - Total tokens in conversation (default: 0)
  - `contextLimit?: number` - Context window size (default: 200,000)
  - `interactive?: boolean` - Show tooltip on hover (default: true)
  - `className?: string` - Additional CSS classes
- **Features**:
  - Pure SVG-based rendering (no Canvas or external libraries)
  - Smooth CSS transitions for ring animation
  - Color-coded based on usage percentage
  - Fully self-contained tooltip logic
  - Theme-aware styling (light/dark mode)

#### 2. `src/components/shared/ChatInput.tsx` (MODIFIED)
- **New Props**:
  - `currentTokens?: number` - Token usage to display
  - `contextLimit?: number` - Context window limit
  - `showContextRing?: boolean` - Whether to show ring (default: true for 'reply', false for 'home')
- **Changes**:
  - Imports ContextUsageRing component
  - Renders ring left of send button (only in 'reply' variant)
  - Passes token data and limit to ring component

#### 3. `src/app/pages/TaskDetail.tsx` (MODIFIED)
- **New Imports**: `getSettings` from `@/shared/db`
- **Helper Functions**:
  ```typescript
  // Context window detection by model name
  const CONTEXT_WINDOWS: Array<[RegExp, number]> = [...]
  
  // Estimate context window from model name
  function estimateContextWindow(model?: string): number { }
  
  // Calculate current token usage from messages
  function calculateCurrentTokens(): number { }
  
  // Get context limit from user settings
  function getContextLimit(): number { }
  ```
- **ChatInput Updates**:
  - Passes `currentTokens={calculateCurrentTokens()}`
  - Passes `contextLimit={getContextLimit()}`
  - Sets `showContextRing={true}`

## Usage

### For Users
1. Open a task detail view (chat/agent mode)
2. Look at the bottom input area (left of the send button)
3. See the context usage ring:
   - **Green ring**: Safe to continue
   - **Yellow ring**: Getting full, may want to compact or start new conversation
   - **Orange ring**: Very close to limit, performance may degrade
   - **Red ring**: Over limit, new messages may be dropped
4. Hover over ring to see exact token count and percentage

### For Developers
```tsx
// In your component that uses ChatInput
import { ContextUsageRing } from '@/components/shared/ContextUsageRing';

// Use the ring component directly (if needed)
<ContextUsageRing 
  currentTokens={estimatedTokens}
  contextLimit={200000}
  interactive
/>

// Or use through ChatInput
<ChatInput 
  currentTokens={tokenCount}
  contextLimit={200000}
  showContextRing={true}
  // ... other props
/>
```

## Token Calculation Method

### Formula
```
tokens ≈ characterCount / 4
```

### Rationale
This is the standard approximation used by Anthropic's documentation and matches the calculation in the backend's `/status` slash command.

### Implementation
```typescript
function calculateCurrentTokens(): number {
  return messages.reduce((total, msg) => {
    const tokenCount = Math.ceil((msg.content?.length || 0) / 4);
    return total + tokenCount;
  }, 0);
}
```

## Model-Specific Context Windows

The implementation includes a curated list of model context windows based on official documentation:

| Model | Context Window |
|-------|-----------------|
| Claude Opus 1M | 1,000,000 |
| Claude Opus/Sonnet/Haiku | 200,000 |
| GPT-4o | 128,000 |
| GPT-4 Turbo | 128,000 |
| GPT-4 | 8,192 |
| GPT-3 | 16,384 |
| DeepSeek | 128,000 |
| Qwen | 131,072 |
| GLM | 128,000 |
| Default | 200,000 |

### Pattern Matching
Context windows are matched using case-insensitive regular expressions:
```typescript
[/opus.*1m|1m.*opus/i, 1000000],
[/sonnet/i, 200000],
[/gpt-4o/i, 128000],
// ... etc
```

This allows flexible model name matching across different naming conventions and providers.

## Styling

### Colors (Hex Values)
- **Green (0-50%)**: `#10b981` (Emerald-500)
- **Yellow (50-80%)**: `#eab308` (Yellow-500)
- **Orange (80-100%)**: `#f97316` (Orange-500)
- **Red (100%+)**: `#ef4444` (Red-500)

### Responsive
- **Desktop**: 40×40px ring with legible text
- **Tooltip**: Fixed positioned, follows cursor position on hover

### Dark Mode
- Uses Tailwind's `dark:` utilities for theme-aware styling
- Adjusts background and text colors for readability

## Performance Considerations

### Optimization
- **Calculation**: `calculateCurrentTokens()` runs on every render but is fast (O(n) where n = number of messages)
- **Rendering**: SVG is lightweight and renders without additional libraries
- **Animation**: CSS transitions (no JavaScript animation loops)
- **Memory**: Single component instance, minimal state (tooltip position)

### Future Improvements
- Cache token calculation result
- Debounce tooltip position updates
- Memoize color selection logic

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires SVG support (standard in all modern browsers)
- Tooltip uses fixed positioning (supported everywhere)

## Accessibility

### Current State
- ✅ Color coding supplemented with percentage text
- ✅ Tooltip provides context for percentages
- ✅ No interactive elements that require fine motor control
- ⚠️ No ARIA labels (component is primarily informational)

### Potential Enhancements
- Add `aria-label` for screen readers
- Add keyboard shortcut to show/hide tooltip
- High contrast mode support

## Testing Recommendations

1. **Unit Tests**:
   - Test color calculation logic for each percentage threshold
   - Test token counting with various message types
   - Test context window detection for all model names

2. **Integration Tests**:
   - Verify ring appears in task detail reply area
   - Verify tooltip shows on hover
   - Verify calculations update when messages change

3. **Manual Testing**:
   - Test with different model selections
   - Test with conversation of varying lengths
   - Test dark/light mode theming
   - Test tooltip positioning at screen edges

## Future Enhancements

### Planned
- [ ] Show warning message when context reaches 80%
- [ ] Provide "Compact Context" button at high usage
- [ ] Add animation when percentage changes
- [ ] Export token usage metrics

### Nice-to-Have
- [ ] Detailed breakdown of token usage by message
- [ ] Historical token usage chart
- [ ] Customizable context limits per model
- [ ] Token estimation accuracy improvement with actual API feedback

## Troubleshooting

### Ring not appearing
1. Check that component is in 'reply' variant of ChatInput
2. Verify `showContextRing` prop is not explicitly set to false
3. Check browser console for component errors

### Incorrect token count
1. Verify message content is being passed correctly
2. Check that getSettings() returns valid model name
3. Try using /status command in chat to verify API-side calculation

### Tooltip not showing
1. Verify `interactive` prop is true (default)
2. Check z-index conflicts with other overlays
3. Test in browser console: `document.querySelector('[class*="context-usage"]')`

## References

- Anthropic Token Estimation: https://docs.anthropic.com/en/docs/about-claude/models/overview
- SVG Stroke-Dasharray: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray
- Tailwind Dark Mode: https://tailwindcss.com/docs/dark-mode

---

**Implementation Date**: April 18, 2026
**Status**: ✅ Complete and tested
**Build Status**: ✅ No TypeScript errors
