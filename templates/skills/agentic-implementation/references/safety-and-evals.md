# Safety, evaluation, and observability

Checked 2026-11. The principles here are stable. Specific defences and tools change;
treat any single mitigation as partial.

## Prompt injection

A model cannot reliably tell instructions from data once both are in its context. Text
in a web page, document, email, issue, tool result, file name, or another agent's
message can be written to redirect it. No prompt wording makes this impossible, so the
design has to limit what a successful injection can do.

**The combination to avoid.** An agent is exploitable for data theft when it has all of:

1. access to private data,
2. exposure to untrusted content, and
3. a channel to send data out (HTTP requests, email, rendering a remote image or link,
   writing to a public place).

Remove one leg for each task, or place a human approval between reading untrusted
content and any outbound or destructive action.

**Controls that work in combination**

- Least privilege: read-only credentials by default; per-task scoped tokens; no ambient
  production access.
- Allow-lists for network hosts, shell commands, and file paths; sandboxed execution
  for generated code.
- Separation: a context that has read untrusted content does not hold write tools; pass
  only validated, structured values across the boundary.
- Confirmation for irreversible or outward-facing actions, showing the exact action —
  not a model-written summary of it.
- Output handling: treat model output as untrusted when it reaches a shell, SQL, HTML,
  or a URL. Escape and parameterise as for any user input.
- Mark the provenance of content in the prompt. It helps, and it is not a boundary.

**Supply chain.** Tool descriptions, MCP servers, skills, plugins, and shared prompts
are executable influence. Pin versions, review changes, and prefer sources you can
read. A tool whose description changes after approval should need approval again.

## Permissions and human oversight

- Classify actions: read, reversible write, irreversible write, outward-facing. Attach
  a policy to each class rather than to each tool individually.
- Show the user what will happen before it happens, and make it easy to say no.
- Keep an audit trail of who approved what, with the arguments actually executed.
- Approval fatigue is a failure mode: too many prompts train people to click through.
  Reduce prompts by narrowing permissions, not by removing checks on risky actions.

## Data handling

- Send the model the minimum data the task needs. Redact or tokenise personal data
  where the task allows.
- Know the provider's retention and training terms for the endpoint in use, and record
  them. They differ by product and plan.
- Secrets never enter a prompt. Tools hold credentials; the model holds a tool name.
- Logs and stored transcripts are a copy of everything sensitive that passed through.
  Apply the same access control and retention as to the source data.

## Evaluation

Without an evaluation set, every change is a guess and regressions are invisible.

**Build the set**

- Start small: twenty to fifty real cases is enough to begin. Draw from actual usage,
  bug reports, and edge cases you fear.
- Include cases where the correct behaviour is to refuse, ask, or say "not found".
- Record the expected result or the criteria, and why the case exists.
- Keep a held-out portion you do not tune against.

**Grade it**

| Grader | Use for | Caution |
| --- | --- | --- |
| Code (exact match, schema, tests pass, state check) | Anything with a checkable outcome | Prefer this whenever possible |
| Model-based, against a written rubric | Quality judgements with clear criteria | Calibrate against human labels; grade one dimension at a time |
| Human review | Calibrating the others; high-stakes samples | Slow; define the rubric first |

**For agents, grade the outcome, not the path.** Check the final state of the
environment (file content, database row, test result). Requiring a specific tool
sequence penalises valid alternative solutions. Track path metrics — turns, tokens,
tool errors — separately as cost signals.

**Run it**

- Multiple trials per case; report pass rate and variance, not a single run.
- Rerun on every change to prompt, tools, model, or settings — and on a schedule, since
  hosted models and dependencies change underneath you.
- Read failing transcripts. Aggregate scores say that something broke; transcripts say
  what. Many "model failures" are ambiguous tasks or broken graders.
- When a production failure is found, add it to the set before fixing it.

## Observability

Log per request, with a trace identifier across steps:

- model, settings, and prompt version
- inputs and outputs (redacted), each tool call with arguments, result size, and errors
- token counts (including cached), latency per step, total cost
- stop reason: completed, limit hit, refusal, error, cancelled

Alert on the signals that move first: error and refusal rate, limit-hit rate, tool
error rate, latency, and cost per task. Sample real traffic into review and into the
evaluation set.

## Failure handling

- Timeouts and retries with backoff on transient errors; never blind-retry a
  side-effecting tool call that may have succeeded.
- A fallback for provider outage: a second model, a degraded mode, or a clear message.
- A deterministic response when limits are reached — partial result plus what remains,
  not silent truncation.
- Rate limiting and per-user budgets so one loop cannot spend without bound.

## Review checklist

- [ ] Which inputs are untrusted, and what can they cause the system to do?
- [ ] Is any agent holding private data, untrusted content, and an outbound channel at once?
- [ ] Are tool arguments and model output validated before use?
- [ ] Do irreversible and outward-facing actions require confirmation?
- [ ] Are limits set on turns, tokens, time, and spend?
- [ ] Is there an evaluation set, and was it run on this change with results reported?
- [ ] Can a failure be replayed from the logs without exposing secrets or personal data?
