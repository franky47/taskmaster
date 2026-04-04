## TypeScript Type Discipline

**The `typescript-advanced-types` skill is mandatory for all TypeScript work in this project.** Load it before writing or reviewing any `.ts` file.

Rules enforced:

- Use `type` for object shapes. Use `interface` only when declaration merging is needed.
- Use `unknown`, never use `any`.
- Prefer type guards (`value is Type`) and assertion functions (`asserts value is Type`) over `as` casts.
- Use discriminated unions for result types (see `ParseResult` pattern in `src/types.ts`).
- Narrow `string` fields to literal unions where the set of values is known (see `ParseErrorField`).
- Use `const` assertions for literal objects/arrays that should not widen.
- Use `infer` in conditional types when extracting nested types.

## Conventions

- Tests are co-located with source files (`foo.test.ts` next to `foo.ts`).
- Test fixtures live in `src/fixtures/`.
