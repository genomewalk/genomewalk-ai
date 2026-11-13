import type { Journey, JourneyStep, StepStatus } from './session-types.ts';
export function createEmbeddingsJourney(now = Date.now()): Journey {
  return {
    startedAt: now,
    localOnly: true,
    steps: (
      [
        ['catalog', 'Local catalog', 'Local server → browser'],
        ['matching', 'Genome matching', 'On this device'],
        ['index', 'Embedding index', 'Browser worker · local'],
        ['query', 'Understand the question', 'Local answer model'],
        ['semantic', 'Find relevant matches', 'On this device'],
        ['context', 'Input to local model', 'On this device'],
        ['answer', 'Local answer', 'On this device'],
      ] as const
    ).map(([id, label, location]) => ({
      id: id as JourneyStep['id'],
      label,
      location,
      status: 'pending',
      summary: 'Not started',
      events: [],
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
      if (
        ['complete', 'limited', 'error', 'stopped', 'skipped', 'paused'].includes(
          patch.status ?? '',
        )
      )
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
