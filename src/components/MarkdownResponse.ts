import type { Element, ElementContent, Root } from 'hast';
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

// Presentation only: mark list items that open with a bold label, and lists made
// entirely of labelled numbers. The text itself is never changed.
const numeric = /^[\s:]*[-+~<>≤≥]?\d[\d.,\s]*%?\s*$/;
const isList = (node: ElementContent) =>
  node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol');
const text = (node: ElementContent): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element'
      ? node.children.map(text).join('')
      : '';
const meaningful = (node: ElementContent) => node.type !== 'text' || node.value.trim() !== '';
function addClass(node: Element, name: string) {
  node.properties.className = [...((node.properties.className as string[]) ?? []), name];
}
function labelledFacts() {
  return function visit(parent: Root | Element) {
    for (const child of parent.children) {
      if (child.type !== 'element') continue;
      if (isList(child)) {
        const items = child.children.filter(
          (item): item is Element => item.type === 'element' && item.tagName === 'li',
        );
        const values = items.map((item) => {
          const first = item.children.find(meaningful);
          const holder = first?.type === 'element' && first.tagName === 'p' ? first : item;
          const label = holder.children.find(meaningful);
          if (label?.type !== 'element' || label.tagName !== 'strong') return null;
          addClass(item, 'fact');
          return { holder, label, value: text(item).slice(text(label).length) };
        });
        if (items.length > 1 && values.every((fact) => fact && numeric.test(fact.value))) {
          addClass(child, 'stats');
          // A tile shows the label above its number, so the colon between them is hidden.
          for (const fact of values) {
            const index = fact!.holder.children.indexOf(fact!.label) + 1;
            const next = fact!.holder.children[index];
            const colon = next?.type === 'text' ? /^\s*:/.exec(next.value)?.[0] : undefined;
            if (!colon || next?.type !== 'text') continue;
            next.value = next.value.slice(colon.length);
            fact!.holder.children.splice(index, 0, {
              type: 'element',
              tagName: 'span',
              properties: { className: ['fact-separator'] },
              children: [{ type: 'text', value: colon }],
            });
          }
        }
      }
      visit(child);
    }
  };
}

// Names the kind of page a link opens; the stylesheet adds a matching icon.
function linkKind(href?: string) {
  if (!href || href.startsWith('#')) return null;
  try {
    const { hostname, pathname } = new URL(href);
    if (hostname === 'pubmed.ncbi.nlm.nih.gov' || hostname === 'doi.org') return 'paper';
    if (hostname === 'gnomad.broadinstitute.org') return 'population';
    if (hostname === 'www.ncbi.nlm.nih.gov') {
      if (pathname.startsWith('/gene')) return 'gene';
      if (pathname.startsWith('/snp')) return 'variant';
      if (pathname.startsWith('/clinvar')) return 'clinvar';
    }
  } catch {
    /* Not an absolute URL: show it as an ordinary link. */
  }
  return 'external';
}

const components: Components = {
  a({ node, children, ...props }) {
    const kind = linkKind(props.href);
    return createElement(
      'a',
      {
        className: kind ? `source-link source-${kind}` : undefined,
        ...props,
        target: kind ? '_blank' : undefined,
        rel: 'noopener noreferrer',
      },
      children,
    );
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
        rehypePlugins: [separateTouchingLinks, labelledFacts],
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
