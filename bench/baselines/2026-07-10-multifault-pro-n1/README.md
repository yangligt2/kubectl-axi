# Multi-fault suite, Gemini 3.1 Pro preview, n=1 (2026-07-10)

4 multi-fault tasks x 3 conditions, before any product response to the
suite. kubectl 4/4 (142,658 avg in-tok, 11.3 turns); kubectl-skill 4/4
(240,761; 16.0); kubectl-axi 1/4 (170,453; 13.5) - all 3 axi misses are
policy_violation fallbacks marking coverage gaps: quota visibility, env
vars, targetPort-vs-containerPort. Full traces per run under
<condition>/<task>/run1/.
