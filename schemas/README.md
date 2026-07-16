# Exported data schemas

`v1/` is generated from `src/domain/schemas.ts` with:

```bash
pnpm schema:export
```

The same files are copied to the private data repository when a schema version
is released. Do not edit generated JSON by hand.
