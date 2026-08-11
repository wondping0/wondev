---
name: example-agent
description: Delegate when a change touches more than three services and the blast radius needs checking first
tools: Read, Grep
model: sonnet
---

# Example agent

1. Map which services the change reaches.
2. Report the ones with no test covering the path.
3. Return the list, not the file contents.
