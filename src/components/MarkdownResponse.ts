import type { ToggleEvent } from 'react';
import type { Components } from 'react-markdown';
import { createElement, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a({ node, ...props }) {
    return createElement('a', {
      ...props,
      target: props.href?.startsWith('#') ? undefined : '_blank',
      rel: 'noopener noreferrer',
    });
  },
  table({ node, ...props }) {
    return createElement(
      'div',
      { className: 'markdown-table', role: 'region', 'aria-label': 'Response table', tabIndex: 0 },
      createElement('table', props),
    );
  },
  // Model-supplied image URLs must not trigger outbound requests from a private
  // conversation. Keep their alternative text; links require an explicit click.
  img({ alt }) {
    return createElement('span', { className: 'markdown-image-alt' }, alt || 'Image');
  },
};

export function MarkdownResponse({ content }: { content: string }) {
  return createElement(
    'div',
    { className: 'assistant-markdown' },
    createElement(Markdown, { remarkPlugins: [remarkGfm], skipHtml: true, components }, content),
  );
}

export function ResponseSource({
  content,
  evidenceAnswer = false,
}: {
  content: string;
  evidenceAnswer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return createElement(
    'details',
    {
      className: 'response-source',
      onToggle: (event: ToggleEvent<HTMLDetailsElement>) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      },
    },
    createElement(
      'summary',
      null,
      evidenceAnswer ? 'Displayed answer Markdown' : 'Original Markdown',
    ),
    open ? createElement('pre', null, content) : null,
  );
}
