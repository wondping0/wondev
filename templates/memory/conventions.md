---
title: Conventions
always: true
description: How code in this repository is written, named, tested, and reviewed
---

# Conventions

> These are the rules an agent should follow without being reminded. Be specific:
> "use tabs" is useful, "write clean code" is not.

## Language and tooling

[Language version, package manager, formatter, linter. Include the exact commands.]

```
install:    [e.g. npm ci]
build:      [e.g. npm run build]
test:       [e.g. npm test]
lint:       [e.g. npm run lint]
typecheck:  [e.g. npm run typecheck]
```

## Naming

[File naming, symbol naming, test naming. Give one real example of each rather than a rule
in the abstract.]

## Testing

[What must have tests, what framework, where tests live, and what "done" means. State
whether tests are written before or after implementation.]

## Error handling

[How errors are represented and surfaced. Which errors are expected and handled, which are
bugs that should crash loudly.]

## Comments

[When a comment is wanted and when it is noise. A useful default: comment the *why*, never
restate the *what*.]

## What not to do

[Patterns previously tried and rejected, and the reason. This is the highest-value section
in the file — it stops an agent re-introducing something you already removed.]

See also: [[architecture]].
