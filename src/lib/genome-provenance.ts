import type { GenomeSource, GenomeProvenance } from './types.ts';
// Keep file identity in local session state. The answer reference needs only
// the source type and a public/anonymized label, not a filename or content hash.
export function genomeProvenance(
  genome?: Pick<GenomeSource, 'kind' | 'label'> | null,
): GenomeProvenance | null {
  if (genome?.kind === 'example') return { kind: 'example', label: genome.label };
  if (genome?.kind === 'upload') return { kind: 'upload', label: 'Uploaded genome' };
  return null;
}
