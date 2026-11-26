import type { Element, Root } from 'hast';
import type { ToggleEvent } from 'react';
import type { Components } from 'react-markdown';
import { createElement, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Separate links that touch in the rendered tree. Authored punctuation, code and raw Markdown stay intact.
function separateTouchingLinks() {
  return function visit(parent: Root | Element) {
    for (let index = parent.children.length - 1; index >= 0; index--) {
      const child = parent.children[index]!;
      if (child.type !== 'element') continue;
      const previous = parent.children[index - 1];
      if (child.tagName === 'a' && previous?.type === 'element' && previous.tagName === 'a') {
        parent.children.splice(index, 0, { type: 'text', value: ' · ' });
      }
      visit(child);
    }
  };
}

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
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [separateTouchingLinks],
        skipHtml: true,
        components,
      },
      content,
    ),
  );
}

export function ResponseSource({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return createElement(
    'details',
    {
      className: 'response-source',
      onToggle: (event: ToggleEvent<HTMLDetailsElement>) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      },
    },
    createElement('summary', null, 'Original Markdown'),
    open ? createElement('pre', null, content) : null,
  );
}
