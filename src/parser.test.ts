import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseTaskContent, parseTaskFile } from "./parser.ts";
import type { ParseFailure, ParseSuccess } from "./types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

describe("parseTaskFile", () => {
  describe("valid files", () => {
    test("parses basic task with only required fields", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.name).toBe("valid-basic");
      expect(task.schedule).toBe("0 8 * * 1-5");
      expect(task.prompt).toBe("Review open pull requests and summarize status.");
    });

    test("parses task with all optional fields", async () => {
      const result = await parseTaskFile(fixture("valid-all-fields.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.name).toBe("valid-all-fields");
      expect(task.schedule).toBe("30 9 * * *");
      expect(task.timezone).toBe("Europe/Paris");
      expect(task.cwd).toBe("~/projects/saas-app");
      expect(task.claudeArgs).toEqual(["--model", "sonnet"]);
      expect(task.env).toEqual({
        GITHUB_TOKEN_SCOPE: "read",
        LOG_LEVEL: "debug",
      });
      expect(task.enabled).toBe(false);
      expect(task.prompt).toBe("Run npm audit and report vulnerabilities.");
    });

    test("handles empty prompt body", async () => {
      const result = await parseTaskFile(fixture("valid-minimal.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.prompt).toBe("");
    });

    test("defaults enabled to true when omitted", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.enabled).toBe(true);
    });

    test("defaults claudeArgs to [] when omitted", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.claudeArgs).toEqual([]);
    });

    test("defaults env to {} when omitted", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.env).toEqual({});
    });

    test("defaults timezone to undefined when omitted", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.timezone).toBeUndefined();
    });

    test("defaults cwd to undefined when omitted", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.cwd).toBeUndefined();
    });
  });

  describe("filename validation", () => {
    test("rejects uppercase letters in filename", () => {
      const result = parseTaskContent("Bad-Name.md", "---\nschedule: '0 8 * * *'\n---\nhi");
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "filename")).toBe(true);
    });

    test("rejects spaces in filename", () => {
      const result = parseTaskContent("bad name.md", "---\nschedule: '0 8 * * *'\n---\nhi");
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "filename")).toBe(true);
    });

    test("rejects underscores in filename", () => {
      const result = parseTaskContent("bad_name.md", "---\nschedule: '0 8 * * *'\n---\nhi");
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "filename")).toBe(true);
    });

    test("accepts hyphens and digits", () => {
      const result = parseTaskContent("task-123.md", "---\nschedule: '0 8 * * *'\n---\nhi");
      expect(result.ok).toBe(true);
    });
  });

  describe("schedule validation", () => {
    test("rejects missing schedule field", async () => {
      const result = await parseTaskFile(fixture("missing-schedule.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "schedule")).toBe(true);
    });

    test("rejects malformed cron expression", async () => {
      const result = await parseTaskFile(fixture("malformed-cron.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "schedule")).toBe(true);
    });

    test("rejects 6-field cron expression", async () => {
      const result = await parseTaskFile(fixture("six-field-cron.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "schedule")).toBe(true);
    });

    test("rejects non-string schedule", () => {
      const result = parseTaskContent("test.md", "---\nschedule: 12345\n---\nhi");
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "schedule")).toBe(true);
    });

    test("rejects empty frontmatter (no schedule)", async () => {
      const result = await parseTaskFile(fixture("empty-frontmatter.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "schedule")).toBe(true);
    });
  });

  describe("timezone validation", () => {
    test("accepts valid IANA timezone", async () => {
      const result = await parseTaskFile(fixture("valid-all-fields.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.timezone).toBe("Europe/Paris");
    });

    test("rejects invalid timezone string", async () => {
      const result = await parseTaskFile(fixture("invalid-timezone.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "timezone")).toBe(true);
    });

    test("allows missing timezone", async () => {
      const result = await parseTaskFile(fixture("valid-basic.md"));
      expect(result.ok).toBe(true);
      const { task } = result as ParseSuccess;
      expect(task.timezone).toBeUndefined();
    });
  });

  describe("type validation", () => {
    test("rejects non-array claude_args", async () => {
      const result = await parseTaskFile(fixture("invalid-claude-args.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "claude_args")).toBe(true);
    });

    test("rejects non-string values in claude_args array", () => {
      const result = parseTaskContent(
        "test.md",
        '---\nschedule: "0 8 * * *"\nclaude_args: ["--model", 42]\n---\nhi',
      );
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "claude_args")).toBe(true);
    });

    test("rejects non-string env values", async () => {
      const result = await parseTaskFile(fixture("invalid-env-values.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "env")).toBe(true);
    });

    test("rejects non-boolean enabled", async () => {
      const result = await parseTaskFile(fixture("invalid-enabled.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "enabled")).toBe(true);
    });

    test("rejects non-object env", () => {
      const result = parseTaskContent(
        "test.md",
        '---\nschedule: "0 8 * * *"\nenv: "not-an-object"\n---\nhi',
      );
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.some((e) => e.field === "env")).toBe(true);
    });
  });

  describe("error accumulation", () => {
    test("returns multiple errors for file with multiple problems", async () => {
      const result = await parseTaskFile(fixture("multiple-errors.md"));
      expect(result.ok).toBe(false);
      const { errors } = result as ParseFailure;
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
