import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentMessage } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Code,
  FileText,
  Globe,
  Loader2,
  Maximize2,
  MessageSquare,
  Monitor,
  Pencil,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Terminal,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Step output type definition
interface StepOutput {
  index: number;
  toolName: string;
  toolIcon: 'terminal' | 'file' | 'edit' | 'search' | 'globe' | 'code';
  description: string;
  input?: Record<string, unknown>;
  content: {
    type: 'markdown' | 'code' | 'terminal' | 'json' | 'text';
    value: string;
    filename?: string;
    language?: string;
  } | null;
}

// Tool icon mapping
const toolIconMap: Record<string, StepOutput['toolIcon']> = {
  Read: 'file',
  Write: 'file',
  Edit: 'edit',
  Bash: 'terminal',
  Grep: 'search',
  Glob: 'search',
  WebFetch: 'globe',
  WebSearch: 'globe',
  LSP: 'code',
};

// Get icon component based on tool type
function getToolIcon(iconType: StepOutput['toolIcon']) {
  switch (iconType) {
    case 'terminal':
      return Terminal;
    case 'file':
      return FileText;
    case 'edit':
      return Pencil;
    case 'search':
      return Search;
    case 'globe':
      return Globe;
    case 'code':
      return Code;
    default:
      return Monitor;
  }
}

// Get file extension language
function getLanguageFromFilename(filename?: string): string {
  if (!filename) return 'text';
  const ext = filename.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
  };
  return langMap[ext || ''] || 'text';
}

// Extract step outputs from messages
function extractStepOutputs(messages: AgentMessage[]): StepOutput[] {
  // Collect tool_result messages for matching with tool_use
  const toolResultMessages: AgentMessage[] = [];
  messages.forEach((msg) => {
    if (msg.type === 'tool_result') {
      toolResultMessages.push(msg);
    }
  });

  return messages
    .filter((m) => m.type === 'tool_use' && m.name)
    .map((m, index) => {
      const input = m.input as Record<string, unknown> | undefined;
      const toolName = m.name || 'Unknown';
      const toolIcon = toolIconMap[toolName] || 'code';

      // Get associated tool_result by index
      const toolResult = toolResultMessages[index];
      const output = toolResult?.output || '';

      let description = '';
      let content: StepOutput['content'] = null;

      switch (toolName) {
        case 'Read': {
          const filePath = input?.file_path as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = `Reading ${filename}`;
          content = {
            type: 'code',
            value: output || `// Reading file: ${filePath || 'unknown'}`,
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Write': {
          const filePath = input?.file_path as string | undefined;
          const fileContent = input?.content as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = `Creating file ${filename}`;
          content = {
            type: 'code',
            value: fileContent || '',
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Edit': {
          const filePath = input?.file_path as string | undefined;
          const oldStr = input?.old_string as string | undefined;
          const newStr = input?.new_string as string | undefined;
          const filename = filePath?.split('/').pop() || 'file';
          description = `Editing ${filename}`;
          content = {
            type: 'code',
            value: `// Replacing:\n${oldStr || ''}\n\n// With:\n${newStr || ''}`,
            filename,
            language: getLanguageFromFilename(filename),
          };
          break;
        }
        case 'Bash': {
          const command = input?.command as string | undefined;
          description = `Running command`;
          content = {
            type: 'terminal',
            value: output
              ? `$ ${command || ''}\n${output}`
              : `$ ${command || ''}`,
          };
          break;
        }
        case 'Grep': {
          const pattern = input?.pattern as string | undefined;
          description = `Searching for "${pattern || ''}"`;
          content = {
            type: 'text',
            value: output || `Search pattern: ${pattern || ''}`,
          };
          break;
        }
        case 'Glob': {
          const pattern = input?.pattern as string | undefined;
          description = `Finding files "${pattern || ''}"`;
          content = {
            type: 'text',
            value: output || `File pattern: ${pattern || ''}`,
          };
          break;
        }
        case 'WebFetch': {
          const url = input?.url as string | undefined;
          description = `Fetching ${url?.slice(0, 30) || 'URL'}...`;
          content = {
            type: 'markdown',
            value: output || `Fetching content from:\n${url || ''}`,
          };
          break;
        }
        case 'WebSearch': {
          const query = input?.query as string | undefined;
          description = `Searching "${query || ''}"`;
          content = {
            type: 'text',
            value: output || `Search query: ${query || ''}`,
          };
          break;
        }
        default: {
          description = `Using ${toolName}`;
          content = output
            ? { type: 'text', value: output }
            : input
              ? {
                  type: 'json',
                  value: JSON.stringify(input, null, 2),
                }
              : null;
        }
      }

      return {
        index,
        toolName,
        toolIcon,
        description,
        input,
        content,
      };
    });
}

interface VirtualComputerProps {
  messages: AgentMessage[];
  isRunning: boolean;
  selectedStepIndex?: number | null;
  onStepSelect?: (index: number) => void;
}

// Get tool action description
function getToolActionText(
  toolName: string,
  input?: Record<string, unknown>
): string {
  switch (toolName) {
    case 'Bash':
      const cmd = input?.command as string | undefined;
      return `Executing command  ${cmd?.slice(0, 40) || '...'}${(cmd?.length || 0) > 40 ? '...' : ''}`;
    case 'Read':
      return `Reading file  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Write':
      return `Writing file  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Edit':
      return `Editing file  ${(input?.file_path as string)?.split('/').pop() || 'file'}`;
    case 'Grep':
      return `Searching for  "${input?.pattern || ''}"`;
    case 'Glob':
      return `Finding files  "${input?.pattern || ''}"`;
    case 'WebFetch':
      return `Fetching  ${(input?.url as string)?.slice(0, 30) || 'URL'}...`;
    case 'WebSearch':
      return `Searching web  "${input?.query || ''}"`;
    default:
      return `Using ${toolName}`;
  }
}

// Get tool type label
function getToolTypeLabel(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'Terminal';
    case 'Read':
    case 'Write':
      return 'File';
    case 'Edit':
      return 'Editor';
    case 'Grep':
    case 'Glob':
      return 'Search';
    case 'WebFetch':
    case 'WebSearch':
      return 'Browser';
    default:
      return 'Tool';
  }
}

export function VirtualComputer({
  messages,
  isRunning,
  selectedStepIndex,
  onStepSelect,
}: VirtualComputerProps) {
  const steps = useMemo(() => extractStepOutputs(messages), [messages]);
  const [internalStep, setInternalStep] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [isProgressExpanded, setIsProgressExpanded] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Use external selection if provided, otherwise use internal state
  const currentStep =
    selectedStepIndex !== null && selectedStepIndex !== undefined
      ? selectedStepIndex
      : internalStep;

  const setCurrentStep = (step: number) => {
    if (onStepSelect) {
      onStepSelect(step);
    } else {
      setInternalStep(step);
    }
  };

  // Auto-advance to latest step when running and live mode is on
  useEffect(() => {
    if (steps.length > 0 && isLive && selectedStepIndex === null) {
      setInternalStep(steps.length - 1);
    }
  }, [steps.length, isLive, selectedStepIndex]);

  // Scroll terminal to bottom when content updates in live mode
  useEffect(() => {
    if (isLive && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [steps, currentStep, isLive]);

  const currentStepData = steps[currentStep];
  const IconComponent = currentStepData
    ? getToolIcon(currentStepData.toolIcon)
    : Terminal;

  const handlePrevStep = () => {
    setCurrentStep(Math.max(0, currentStep - 1));
    setIsLive(false);
  };

  const handleNextStep = () => {
    if (currentStep === steps.length - 1) {
      setIsLive(true);
    } else {
      setCurrentStep(Math.min(steps.length - 1, currentStep + 1));
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    setCurrentStep(newValue);
    setIsLive(newValue === steps.length - 1);
  };

  const jumpToLive = () => {
    setIsLive(true);
    if (steps.length > 0) {
      setCurrentStep(steps.length - 1);
    }
  };

  // Empty state
  if (steps.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {/* Window Header */}
        <WindowHeader title="HT Claw Computer" />

        {/* Status bar */}
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-2">
          <Terminal className="size-4 text-gray-400" />
          <span className="text-sm text-gray-500">
            Agent is using{' '}
            <span className="font-medium text-gray-700">Computer</span>
          </span>
        </div>

        {/* Empty terminal */}
        <div className="flex flex-1 flex-col items-center justify-center bg-gray-50 p-8">
          <div className="flex flex-col items-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-xl border border-gray-200 bg-white">
              <Monitor className="size-8 text-gray-300" />
            </div>
            <h3 className="text-sm font-medium text-gray-600">
              {isRunning ? 'Agent is starting...' : 'Ready to work'}
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              Tool outputs will appear here
            </p>
            {isRunning && (
              <div className="mt-4 flex items-center gap-1">
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
                <div className="size-1.5 animate-bounce rounded-full bg-emerald-500" />
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <TimelineControl
          currentStep={0}
          totalSteps={0}
          isLive={true}
          onPrev={() => {}}
          onNext={() => {}}
          onSliderChange={() => {}}
        />

        {/* Task Progress */}
        <TaskProgress
          steps={[]}
          currentStep={0}
          isRunning={isRunning}
          isExpanded={false}
          onToggle={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Window Header */}
      <WindowHeader title="HT Claw Computer" />

      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-4 py-2">
        <IconComponent className="size-4 text-gray-400" />
        <span className="text-sm text-gray-500">
          Agent is using{' '}
          <span className="font-medium text-gray-700">
            {getToolTypeLabel(currentStepData?.toolName || '')}
          </span>
        </span>
        <span className="text-gray-300">|</span>
        <span className="flex-1 truncate text-sm text-gray-500">
          {getToolActionText(
            currentStepData?.toolName || '',
            currentStepData?.input
          )}
        </span>
      </div>

      {/* Terminal Container */}
      <div className="flex flex-1 flex-col overflow-hidden border-b border-gray-100 bg-gray-50">
        {/* Tab Header */}
        <div className="flex items-center justify-center border-b border-gray-200 bg-white py-2">
          <span className="text-xs font-medium text-gray-500">
            {currentStepData?.description || 'step_output'}
          </span>
        </div>

        {/* Terminal Content */}
        <div ref={terminalRef} className="flex-1 overflow-auto bg-white">
          {currentStepData?.content ? (
            <TerminalContent content={currentStepData.content} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-4">
              <p className="text-sm text-gray-400 italic">
                {currentStepData?.description}
              </p>
            </div>
          )}
        </div>

        {/* Jump to live button - only show when not in live mode */}
        {!isLive && (
          <div className="flex justify-center border-t border-gray-100 bg-white py-3">
            <button
              onClick={jumpToLive}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50"
            >
              <Play className="size-3.5" />
              Jump to live
            </button>
          </div>
        )}
      </div>

      {/* Timeline Control */}
      <TimelineControl
        currentStep={currentStep}
        totalSteps={steps.length}
        isLive={isLive}
        onPrev={handlePrevStep}
        onNext={handleNextStep}
        onSliderChange={handleSliderChange}
      />

      {/* Task Progress */}
      <TaskProgress
        steps={steps}
        currentStep={currentStep}
        isRunning={isRunning}
        isExpanded={isProgressExpanded}
        onToggle={() => setIsProgressExpanded(!isProgressExpanded)}
      />
    </div>
  );
}

// Window Header Component
function WindowHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      <div className="flex items-center gap-1">
        <button className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
          <MessageSquare className="size-4" />
        </button>
        <button className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
          <Maximize2 className="size-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-gray-200" />
        <button className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

// Timeline Control Component
function TimelineControl({
  currentStep,
  totalSteps,
  isLive,
  onPrev,
  onNext,
  onSliderChange,
}: {
  currentStep: number;
  totalSteps: number;
  isLive: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="shrink-0 border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Navigation buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onPrev}
            disabled={currentStep === 0 || totalSteps === 0}
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all',
              currentStep === 0 || totalSteps === 0
                ? 'cursor-not-allowed text-gray-300'
                : 'cursor-pointer text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            )}
          >
            <SkipBack className="size-4" />
          </button>
          <button
            onClick={onNext}
            disabled={currentStep === totalSteps - 1 || totalSteps === 0}
            className={cn(
              'flex size-7 items-center justify-center rounded transition-all',
              currentStep === totalSteps - 1 || totalSteps === 0
                ? 'cursor-not-allowed text-gray-300'
                : 'cursor-pointer text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            )}
          >
            <SkipForward className="size-4" />
          </button>
        </div>

        {/* Live indicator dot */}
        <div
          className={cn(
            'size-2.5 rounded-full transition-colors',
            isLive ? 'bg-blue-500' : 'bg-gray-300'
          )}
        />

        {/* Progress slider */}
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(0, totalSteps - 1)}
            value={currentStep}
            onChange={onSliderChange}
            disabled={totalSteps === 0}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
          />
        </div>

        {/* Live label */}
        <div className="flex min-w-[50px] items-center justify-end gap-1.5">
          <div
            className={cn(
              'size-2 rounded-full',
              isLive ? 'bg-emerald-500' : 'bg-gray-300'
            )}
          />
          <span
            className={cn(
              'text-sm',
              isLive ? 'font-medium text-gray-700' : 'text-gray-400'
            )}
          >
            live
          </span>
        </div>
      </div>
    </div>
  );
}

// Task Progress Component
function TaskProgress({
  steps,
  currentStep,
  isRunning,
  isExpanded,
  onToggle,
}: {
  steps: StepOutput[];
  currentStep: number;
  isRunning: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // When not running (task completed), all steps are completed
  const allCompleted = !isRunning && steps.length > 0;
  const completedSteps = allCompleted ? steps.length : currentStep + 1;
  const totalSteps = Math.max(steps.length, 1);

  // Get current step description for display
  const currentDescription = steps[currentStep]?.description || '准备执行任务';

  return (
    <div className="shrink-0 bg-white">
      {/* Collapsed header - always visible */}
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
      >
        {/* Status icon */}
        {allCompleted ? (
          <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
        ) : isRunning ? (
          <Loader2 className="size-5 shrink-0 animate-spin text-blue-500" />
        ) : (
          <Circle className="size-5 shrink-0 text-gray-300" />
        )}

        {/* Current step description */}
        <span className="flex-1 truncate text-left text-sm text-gray-700">
          {currentDescription}
        </span>

        {/* Step count and expand icon */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 tabular-nums">
            {completedSteps} / {totalSteps}
          </span>
          {isExpanded ? (
            <ChevronDown className="size-4 text-gray-400" />
          ) : (
            <ChevronUp className="size-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded step list */}
      {isExpanded && steps.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto border-t border-gray-100 px-4 py-2">
          <div className="space-y-1">
            {steps.map((step, index) => {
              const isCompleted = allCompleted || index < currentStep;
              const isCurrent = index === currentStep;

              return (
                <div
                  key={index}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    isCurrent && !allCompleted && 'bg-blue-50'
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : isCurrent && isRunning ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-gray-300" />
                  )}
                  <span
                    className={cn(
                      'truncate text-sm',
                      isCompleted || isCurrent
                        ? 'text-gray-700'
                        : 'text-gray-400'
                    )}
                  >
                    {step.description}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Terminal Content renderer - styled like the screenshot
function TerminalContent({
  content,
}: {
  content: NonNullable<StepOutput['content']>;
}) {
  switch (content.type) {
    case 'terminal':
      return (
        <div className="p-4 font-mono text-sm">
          {content.value.split('\n').map((line, i) => {
            // Check if line starts with $ (command line)
            if (line.startsWith('$')) {
              return (
                <div key={i} className="flex">
                  <span className="text-emerald-600">ubuntu@sandbox:~ </span>
                  <span className="text-emerald-600">{line}</span>
                </div>
              );
            }
            // Regular output line
            return (
              <div key={i} className="text-gray-700">
                {line}
              </div>
            );
          })}
          {/* Show prompt at the end */}
          <div className="mt-1 flex">
            <span className="text-emerald-600">ubuntu@sandbox:~ $</span>
          </div>
        </div>
      );

    case 'markdown':
      return (
        <article className="prose prose-sm prose-headings:text-gray-800 prose-p:text-gray-600 prose-strong:text-gray-800 prose-code:text-blue-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded max-w-none p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content.value}
          </ReactMarkdown>
        </article>
      );

    case 'code':
      return (
        <div className="flex h-full flex-col">
          {content.filename && (
            <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
              <FileText className="size-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">
                {content.filename}
              </span>
              {content.language && (
                <span className="ml-auto rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-500">
                  {content.language}
                </span>
              )}
            </div>
          )}
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-sm">
              <code className="text-gray-700">{content.value}</code>
            </pre>
          </div>
        </div>
      );

    case 'json':
      return (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
            <Code className="size-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">JSON</span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-sm">
              <code className="text-amber-600">{content.value}</code>
            </pre>
          </div>
        </div>
      );

    case 'text':
    default:
      return (
        <div className="p-4">
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-600">
            {content.value}
          </p>
        </div>
      );
  }
}
