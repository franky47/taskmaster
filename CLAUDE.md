## TypeScript Type Discipline

**The `typescript-advanced-types` skill is mandatory for all TypeScript work in this project.** Load it before writing or reviewing any `.ts` file.

Rules enforced:

- Use `type` for object shapes. Use `interface` only when declaration merging is needed.
- Use `unknown`, never use `any`.
- Prefer type guards (`value is Type`) and assertion functions (`asserts value is Type`) over `as` casts.
- Use discriminated unions for result types (see `parseTaskFile` return type in `src/task/parser.ts`).
- Narrow `string` fields to literal unions where the set of values is known (see `ParseErrorField`).
- Use `const` assertions for literal objects/arrays that should not widen.
- Use `infer` in conditional types when extracting nested types.
- Always use Zod to parse & validate external data coming into the program, and infer from schemas.

## Conventions

- Tests are co-located with source files (`foo.test.ts` next to `foo.ts`).
- Test fixtures are colocated in a `fixtures/` directory next to the tests that use them.
