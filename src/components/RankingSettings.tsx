import type { Weights } from '../lib/types.ts';
import { DEFAULT_WEIGHTS } from '../config/evidence-ranking.ts';

export function RankingSettings({
  weights,
  busy,
  onChange,
}: {
  weights: Weights;
  busy: boolean;
  onChange: (weights: Weights) => void;
}) {
  return (
    <details className="ranking-settings">
      <summary>Search weights</summary>
      <p>
        Topic searches combine similarity, classification and review stars. Changes apply to the
        next question.
      </p>
      {(['classification', 'review'] as const).map((name) => (
        <label key={name}>
          <span>
            {name === 'classification' ? 'Classification' : 'Review stars'}
            <output>{weights[name].toFixed(2)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={weights[name]}
            disabled={busy}
            aria-label={name === 'classification' ? 'Classification weight' : 'Review-star weight'}
            onChange={(event) => onChange({ ...weights, [name]: Number(event.target.value) })}
          />
        </label>
      ))}
      <p>
        Both zero uses similarity alone. Broad overviews use catalog order. These weights are not
        fitted or validated; they reset on refresh.
      </p>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => onChange({ ...DEFAULT_WEIGHTS })}
      >
        Reset weights
      </button>
    </details>
  );
}
