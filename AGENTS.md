# Project design constraints

- Prefer fewer request-processing steps, shorter shared prompts, and less code. Before adding a rule, branch, or module, check whether removing or simplifying an existing one solves the problem.
- Keep model-independent behavior in shared prompts and configuration. Do not add question-keyword routing, gene/disease exceptions, or heuristic rewriting of model answers.
- Preserve exact source evidence and privacy boundaries when simplifying. Keep general model knowledge separate from personal variant evidence.
- Use small, documented browser checks covering direct questions and follow-ups. Keep failed observations; distinguish development tuning from a held-out evaluation. Stop iterating once representative cases behave reasonably.
