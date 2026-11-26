import type { MatchedRow } from './types.ts';
import { validPmid } from '../vendor/genomewalk/catalogues/publication-format.ts';
import { condList } from './genomewalk/conditions.ts';
import { alleleFraction, refSnpIds } from './local-evidence.ts';
import { RECORD_LIMIT } from '../config/evidence-answer.ts';
import { DISEASE_CLASS_ORDER, REVIEW_GROUPS } from '../config/evidence-ranking.ts';
import { rankCatalogForReview } from './evidence-ranking.ts';

const categories = [
  'Disease evidence',
  'Drug response',
  'Associations',
  'Traits',
  'Other',
] as const;
type Category = (typeof categories)[number];
const primaryLabels = new Map([
  ['P', 'Pathogenic'],
  ['PLP', 'Pathogenic / likely pathogenic'],
  ['LP', 'Likely pathogenic'],
  ['C', 'Conflicting'],
  ['O', 'Other'],
]);

function catalogTopics(row: MatchedRow): Category[] {
  const labels = (row.classification ?? '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .split('|')
    .map((s) => s.trim());
  const topics: Category[] = [];
  if (DISEASE_CLASS_ORDER.includes(row.sig ?? '') || row.sig === 'C')
    topics.push('Disease evidence');
  if (labels.includes('drug response')) topics.push('Drug response');
  if (
    labels.some(
      (label) =>
        /^(?:(?:uncertain|likely|established) )?risk (?:factor|allele)$/.test(label) ||
        ['association', 'protective'].includes(label),
    )
  )
    topics.push('Associations');
  if (labels.includes('affects')) topics.push('Traits');
  if (!topics.length) topics.push('Other');
  return topics;
}

interface SummaryEntry {
  row: MatchedRow;
  group: string;
  stars: number | null;
  topics: Category[];
  conditions: string[];
}

function countsLine(counts: Map<string, number>) {
  return Array.from(counts, ([label, count]) => `${label} ${count}`).join(', ');
}

function count(counts: Map<string, number>, label: string) {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

// Keep complete source values. Long fields stay available in the full record.
function field(value?: string | null) {
  if (!value || value === '.') return '—';
  return value.length <= 160 ? value.replace(/\s+/g, ' ').trim() : '(see full record)';
}

function example({ row, stars, conditions }: SummaryEntry) {
  const rsid = refSnpIds(row.rsids)[0];
  const gene = row.gene?.trim();
  const terms = [gene && gene !== '.' ? gene : '', rsid].filter(Boolean);
  const subject = terms.join(' ');
  const more = conditions.length > 1 ? ' (+' + (conditions.length - 1) + ' more)' : '';
  const classification = row.classification?.replaceAll('_', ' ').replaceAll('|', '; ');
  const values = [
    field(subject),
    field(classification),
    stars ?? 'unknown',
    field(conditions[0]) + more,
  ];
  if (!rsid) {
    const id =
      row.variationid && /^[1-9][0-9]*$/.test(row.variationid)
        ? 'ClinVar ' + row.variationid
        : row.chrom + ':' + row.pos + ' ' + row.ref + '>' + row.alt;
    values.push('Record ID: ' + field(id));
  }
  return values.join(' | ');
}

export function buildCatalogSummary(matches: readonly MatchedRow[]): string {
  const entries = rankCatalogForReview(matches).map(({ index, group, priority }) => {
    const row = matches[index]!;
    return {
      row,
      group: REVIEW_GROUPS[group]!,
      stars: priority.reviewStars,
      topics: catalogTopics(row),
      conditions: condList((row.conditions ?? '').replaceAll('_', ' ')),
    };
  });
  const primary = new Map(Array.from(primaryLabels.values(), (label) => [label, 0]));
  const reviews = new Map(['4', '3', '2', '1', '0'].map((star) => [star, 0]));
  const topics = new Map<string, number>(categories.map((label) => [label, 0]));
  const groups = new Map(REVIEW_GROUPS.map((label) => [label, 0]));
  const genes = new Set<string>();
  const conditionNames = new Set<string>();
  let unnamed = 0,
    frequency = 0,
    publications = 0;
  for (const { row, stars, group, topics: rowTopics, conditions } of entries) {
    const gene = row.gene?.trim();
    if (gene && gene !== '.') genes.add(gene);
    else unnamed++;
    count(primary, primaryLabels.get(row.sig ?? '') ?? 'Unknown');
    count(reviews, String(stars ?? 'unknown'));
    count(groups, group);
    for (const condition of conditions) conditionNames.add(condition);
    for (const topic of rowTopics) count(topics, topic);
    if (alleleFraction(row.af) !== null) frequency++;
    if (row.pmids?.split(',').some((id) => validPmid(id.trim()))) publications++;
  }
  const shortlist = entries.slice(0, RECORD_LIMIT.overview);
  const examples: string[] = [];
  if (shortlist.length)
    examples.push(
      '',
      'Variants prioritized for review',
      'Gene and variant ID | Reported classification | Stars | One listed condition or trait',
    );
  for (const [group, total] of groups) {
    const shown = shortlist.filter((entry) => entry.group === group);
    if (!shown.length) continue;
    const count = total === 1 ? '1 variant' : `${total} variants`;
    const coverage = shown.length === total ? count : `${count}, ${shown.length} shown`;
    examples.push('', `${group} (${coverage})`, ...shown.map(example));
  }
  const represented = new Set(shortlist.flatMap((entry) => entry.topics));
  for (const category of categories) {
    if (represented.has(category)) continue;
    const entry = entries.find((entry) => entry.topics.includes(category));
    if (entry) {
      examples.push('', `${category} example`, example(entry));
      for (const topic of entry.topics) represented.add(topic);
    }
  }
  return [
    'Catalog summary (matched variants in this DNA file)',
    `Total variants: ${matches.length}`,
    `Distinct named genes: ${genes.size}. Variants without a supplied gene: ${unnamed}.`,
    `Distinct condition or trait names listed across matches: ${conditionNames.size}.`,
    `Primary ClinVar groups: ${countsLine(primary)}.`,
    `Review stars (stars: number of variants): ${Array.from(reviews, ([star, n]) => `${star}: ${n}`).join(', ')}.`,
    `Categories (can overlap): ${countsLine(topics)}.`,
    `Review priority: ${countsLine(groups)}.`,
    `With overall gnomAD frequency: ${frequency}. With linked publications: ${publications}.`,
    ...examples,
  ].join('\n');
}
