import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownResponse } from '../src/components/MarkdownResponse.js';

const render = (content) => renderToStaticMarkup(createElement(MarkdownResponse, { content }));

test('renders CommonMark structure and GFM tables while retaining citations and scientific text', () => {
  const content =
    '## Findings\n\n- **TEST:** C/T, one copy. [C123]\n- `GT 0/1`\n\n| Gene | Observation |\n| --- | --- |\n| TEST | C/T |\n\n> Evidence note\n\n---\n\n```text\nA<T\n```';
  const html = render(content);
  assert.match(html, /<h2>Findings<\/h2>/);
  assert.match(html, /<ul>[\s\S]*<strong>TEST:<\/strong> C\/T, one copy\. \[C123\]/);
  assert.match(html, /<code>GT 0\/1<\/code>/);
  assert.match(html, /role="region" aria-label="Response table" tabindex="0"/);
  assert.match(html, /<table>[\s\S]*<th>Gene<\/th>[\s\S]*<td>C\/T<\/td>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<hr\/>/);
  assert.match(html, /<pre><code class="language-text">A&lt;T\n<\/code><\/pre>/);
  const footnote = render('A note[^1].\n\n[^1]: Local reference.');
  assert.match(footnote, /href="#user-content-fn-1"/);
  assert.doesNotMatch(footnote, /target="_blank"/);
});

test('renderer blocks active HTML, unsafe link schemes and automatic image requests', () => {
  const html = render(
    '<script>alert(1)</script>\n\n<img src="https://example.com/private" onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)\n\n![Reference image](https://example.com/private)\n\n[ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/)',
  );
  assert.doesNotMatch(html, /<script|<img|<link|onerror=|href="javascript:|src=/);
  assert.doesNotMatch(html, /https:\/\/example.com\/private/);
  assert.match(html, /Reference image/);
  assert.match(
    html,
    /href="https:\/\/www.ncbi.nlm.nih.gov\/clinvar\/" target="_blank" rel="noopener noreferrer"/,
  );
});

test('standard HTML policy ignores protocol tags but preserves literal tag examples and prose', () => {
  const html = render(
    '<think>\n\n</think>\n\n## Answer\n\nUse `<think>` as a literal example. A < B.',
  );
  assert.match(html, /<h2>Answer<\/h2>/);
  assert.match(html, /<code>&lt;think&gt;<\/code>/);
  assert.match(html, /A &lt; B/);
  assert.doesNotMatch(html, /<think>/);
});

test('streamed incomplete Markdown stays parser-managed without string repair', () => {
  const content =
    '<think>\n\n</think>\n\n## Findings\n\n**A**\n\n| Gene | Call |\n| --- | --- |\n| TEST | C/T |\n';
  for (let end = 0; end <= content.length; end++)
    assert.doesNotThrow(() => render(content.slice(0, end)));
  assert.match(render(content), /<table>/);
});
