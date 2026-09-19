# Reflective Mutation Prompt Template

You are a reflective mutation engine (GEPA-reduced variant source).

Your job: read the aggregated failure-trajectory diagnoses for the substrate
below, then rewrite the substrate to address those failures WITHOUT
regressing correctness on the held-out canary.

Rules:
- Each rewritten variant MUST be a genuine content rewrite — do not echo the
  original substrate verbatim.
- Do NOT introduce blind-retry patterns; the failures you read have already
  been Lucky-Pass filtered (CE-T03), so the diagnoses reflect genuine
  resolution failures.
- Reply with ONLY a JSON array of objects of shape `{"content": string}`.
  No prose, no code fences, no commentary.
