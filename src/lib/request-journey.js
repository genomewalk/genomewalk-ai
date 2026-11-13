export function createEmbeddingsJourney(now = Date.now()) {
  return {
    startedAt: now,
    localOnly: true,
    steps: [
      ['catalog', 'Local catalog', 'Local server → browser'],
      ['matching', 'Genome matching', 'On this device'],
      ['index', 'Embedding index', 'Browser worker · local'],
      ['query', 'Understand the question', 'Local answer model'],
      ['semantic', 'Find relevant matches', 'On this device'],
      ['context', 'Input to local model', 'On this device'],
      ['answer', 'Local answer', 'On this device'],
    ].map(([id, label, location]) => ({
      id,
      label,
      location,
      status: 'pending',
      summary: 'Not started',
      events: [],
    })),
  };
}
export function updateJourney(journey, id, patch, now = Date.now()) {
  return {
    ...journey,
    steps: journey.steps.map((step) => {
      if (step.id !== id) return step;
      const next = { ...step, ...patch };
      if (patch.status === 'running' && !step.startedAt) next.startedAt = now;
      if (['complete', 'limited', 'error', 'stopped', 'skipped', 'paused'].includes(patch.status))
        next.endedAt = now;
      return next;
    }),
  };
}
export function finishJourney(journey, status, reason, now = Date.now()) {
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
