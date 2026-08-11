---
paths:
  - src/**
description: How the fixture system is put together
---

# Architecture

The service is one process with three layers: transport, domain, and storage.

Transport never touches storage directly. That rule is the whole point of the split, and
breaking it is the most common mistake in this codebase.

See also: [[conventions]].
