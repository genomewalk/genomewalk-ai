import type { ModelProfile } from '../lib/types.ts';

const colors = ['#4f7fe8', '#8468e0', '#d9902b', '#2f9e7a', '#e0714f', '#64748b'];

export const gigabytes = (megabytes: number) => `${(megabytes / 1024).toFixed(1)} GB`;
export const thousands = (tokens: number) => `${Math.round(tokens / 1024)}K`;

// A lettered badge stands in for a logo: the model's initial, colored by its maker.
export function ModelBadge({ model }: { model: ModelProfile }) {
  const name = model.maker ?? model.label;
  const color = colors[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % colors.length];
  return (
    <span className="model-badge" style={{ background: color }} aria-hidden="true">
      {model.label[0]!.toUpperCase()}
    </span>
  );
}
