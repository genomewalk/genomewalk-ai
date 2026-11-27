import type { Journey, JourneyStep, StepStatus } from './session-types.ts';
export function createEmbeddingsJourney(now = Date.now()): Journey {
  return {
    startedAt: now,
    steps: (
      [
        ['catalog', 'Local catalog'],
        ['matching', 'Genome matching'],
        ['index', 'Embedding index'],
        ['query', 'Understand the question'],
        ['semantic', 'Find relevant matches'],
        ['context', 'Input to local model'],
        ['answer', 'Local answer'],
      ] as const
    ).map(([id, label]) => ({
      id,
      label,
      status: 'pending',
      summary: 'Not started',
    })),
  };
}
export function updateJourney(
  journey: Journey,
  id: string,
  patch: Partial<JourneyStep>,
  now = Date.now(),
) {
  return {
    ...journey,
    steps: journey.steps.map((step) => {
      if (step.id !== id) return step;
      const next = { ...step, ...patch };
      if (patch.status === 'running' && !step.startedAt) next.startedAt = now;
      if (patch.status && patch.status !== 'pending' && patch.status !== 'running')
        next.endedAt = now;
      return next;
    }),
  };
}
export function finishJourney(
  journey: Journey,
  status: StepStatus,
  reason?: string,
  now = Date.now(),
): Journey {
  return {
    ...journey,
    endedAt: now,
    status,
    steps: journey.steps.map((step) => {
      if (step.status === 'running') return { ...step, status, summary: reason, endedAt: now };
      if (step.status === 'pending')
        return { ...step, status: 'skipped', summary: 'Not run', endedAt: now };
      return step;
    }),
  };
}
