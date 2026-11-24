# Patterns: single call, workflow, or agent

Checked 2026-11. These patterns are vendor-neutral and have been stable for several
years; the cost and reliability numbers behind them are not, so measure in your project.

## The ladder

Climb only as far as the task forces you.

| Level | Control flow decided by | Use when | Cost of being wrong |
| --- | --- | --- | --- |
| Single call | Developer | One transformation: classify, extract, summarise, draft | Low; easy to evaluate |
| Call + retrieval | Developer | The answer depends on documents or data the model was not given | Retrieval quality becomes the bottleneck |
| Workflow | Developer (fixed steps, model fills each) | Steps are known in advance | More latency; errors compound across steps |
| Agent loop | Model (chooses tools until done) | Steps cannot be predicted; open-ended problems | Variance, cost, harder evaluation and security |
| Multi-agent | Model(s), across separate contexts | Work is broad and parallelisable, or needs isolation | Several times the tokens; coordination failures |

A workflow that works is better than an agent that usually works.

## Workflow patterns

**Prompt chaining.** Output of one step feeds the next, with a programmatic check
between steps. Use when a task splits cleanly into fixed stages (outline → draft →
check). Add gates so a bad intermediate result stops early.

**Routing.** Classify the input, then dispatch to a specialised prompt, tool set, or
model size. Use when inputs fall into distinct kinds that need different handling.
Route with code when a rule is enough.

**Parallelisation.** Run independent subtasks at once (sectioning), or run the same task
several times and combine (voting). Use for speed, or for confidence on judgements such
as "is this content safe". Combining results is a design decision, not an afterthought.

**Orchestrator–workers.** One call plans and delegates subtasks that are not known in
advance; workers return results; the orchestrator synthesises. Use for research and
multi-file changes. Each worker needs a complete brief and a defined return format.

**Evaluator–optimiser.** One call produces, another critiques against explicit criteria,
and the loop repeats within a limit. Use only when criteria are clear and iteration
measurably improves the result. An evaluator without written criteria just adds noise.

## The agent loop

At its core: the model receives a goal and tools, calls a tool, reads the result, and
repeats until it decides it is finished or a limit stops it. What determines quality:

- **Tools** — the agent's only way to see and act. Most failures trace to a vague tool
  description, an oversized result, or a missing tool.
- **Ground truth each step** — the agent should verify with the environment (run the
  test, re-read the file, query the record) rather than trust its own earlier output.
- **Stop conditions** — turn, token, and time limits; a defined result when they hit.
- **Checkpoints** — places where a person can inspect or approve before irreversible
  steps.

## Subagents and multi-agent systems

Reasons that justify a second agent:

- **Context isolation** — a wide search would flood the main context; the subagent
  reads a lot and returns a little.
- **Parallelism** — independent subtasks with no shared state.
- **Specialisation** — a different tool set, permission level, or instruction set.
- **Independent review** — a checker that has not seen the author's reasoning.

Reasons that do not: making the architecture look sophisticated; splitting a task whose
parts must share detailed context; role-play ("PM agent", "engineer agent") without a
difference in tools or information.

Known failure modes: subagents duplicating each other's work, briefs that omit a
constraint the parent knew, results too long to be useful to the parent, and unverified
claims passed upward as fact. Mitigate with explicit briefs, a required return format,
and verification by the parent of anything consequential.

## Retrieval (RAG)

- Start with the simplest retrieval that could work: keyword or structured lookup
  before embeddings; hybrid before exotic.
- Let an agent search iteratively with tools when one-shot retrieval misses; that often
  beats tuning a pipeline.
- Evaluate retrieval separately from generation. If the right passage was not retrieved,
  no prompt fixes the answer.
- Return sources with the answer so claims can be checked, and say when nothing relevant
  was found instead of answering from the model's general knowledge.

## Long-running work

- Externalise state: a plan file, a progress log, a task list the agent re-reads.
- Design for context turnover: summaries lose detail, so decisions and constraints go in
  durable notes, not only in conversation.
- Make steps resumable and idempotent; assume the run will be interrupted.
- Prefer many small verified steps over one large unverified one.

## Choosing: questions to answer in writing

1. Can the steps be listed now? If yes, it is a workflow.
2. What is the cost of a wrong action, and where is the approval or check?
3. How will correctness be measured, and on which cases?
4. What is the latency and cost budget per request?
5. What happens to the user when the model is unavailable, refuses, or times out?
