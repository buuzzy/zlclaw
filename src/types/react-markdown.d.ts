// Override react-markdown types to fix compatibility with React 19
declare module 'react-markdown' {
  import { ComponentType } from 'react';

  interface ReactMarkdownProps {
    children: string;
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    components?: Record<string, ComponentType<unknown>>;
    className?: string;
  }

  const ReactMarkdown: ComponentType<ReactMarkdownProps>;
  export default ReactMarkdown;
  export type Components = Record<string, ComponentType<unknown>>;
}

declare module 'remark-gfm' {
  const remarkGfm: unknown;
  export default remarkGfm;
}
