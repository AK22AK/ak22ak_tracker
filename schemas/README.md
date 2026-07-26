# Exported data schemas

`v1/` is generated from `src/domain/schemas.ts` with:

```bash
pnpm schema:export
```

The same files are copied to the private data repository when a schema version
is released. This includes the provider-neutral AI analysis-job and proposal
audit mirror contracts; those contracts contain only whitelisted audit fields,
not prompts, raw provider responses, full context, or credentials. Do not edit
generated JSON by hand.
