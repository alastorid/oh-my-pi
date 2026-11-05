import { describe, expect, it } from "bun:test";
import { parseArgs, validateExplicitSessionLaunch } from "@oh-my-pi/pi-coding-agent/cli/args";
import { extractProfileFlags } from "@oh-my-pi/pi-coding-agent/cli/profile-bootstrap";
import { restartArgv } from "@oh-my-pi/pi-coding-agent/cli/flag-tables";
import { buildSpec } from "@oh-my-pi/pi-coding-agent/cli/completion-gen";
import { launchHelp } from "@oh-my-pi/pi-coding-agent/commands/launch-help";
import type { CliConfig, CommandCtor } from "@oh-my-pi/pi-utils/cli";

const id = "550e8400-e29b-41d4-a716-446655440000";

describe("--session-id", () => {
	it("parses and normalizes canonical UUIDs without changing provider identity", () => {
		const args = parseArgs(["--session-id", id.toUpperCase(), "--provider-session-id", "provider-key", "hello"]);
		expect(args.sessionId).toBe(id);
		expect(args.providerSessionId).toBe("provider-key");
		expect(args.messages).toEqual(["hello"]);
		expect(parseArgs([`--session-id=${id}`]).sessionId).toBe(id);
	});

	it("rejects missing, invalid, and repeated IDs", () => {
		for (const argv of [
			["--session-id"],
			["--session-id="],
			["--session-id", "not-a-uuid"],
			["--session-id", id, "--session-id", id],
		]) {
			expect(() => parseArgs(argv)).toThrow("--session-id");
		}
	});

	it("rejects competing session selectors while allowing storage and profile options", () => {
		for (const selector of [
			["--continue"],
			["--resume"],
			["--session", id],
			["--restore"],
			["--fork", id],
			["--from-claude"],
			["--from-codex"],
			["--no-session"],
			["--goal", "objective"],
			["--export", "file"],
		]) {
			expect(() => validateExplicitSessionLaunch(parseArgs(["--session-id", id, ...selector]))).toThrow(
				"--session-id",
			);
		}
		expect(() =>
			validateExplicitSessionLaunch(parseArgs(["--session-id", id, "--session-dir", "store", "--cwd", "work"])),
		).not.toThrow();
		expect(() => validateExplicitSessionLaunch(parseArgs(["--session-id", id, "--mode", "acp"]))).toThrow("ACP");
	});

	it("preserves profile bootstrap semantics and reserves the flag against extension shadowing", () => {
		const extracted = extractProfileFlags(["--session-id", id, "--profile", "work"]);
		expect(extracted.profile).toBe("work");
		expect(parseArgs(extracted.argv, new Map([["session-id", { type: "boolean" }]])).sessionId).toBe(id);
	});

	it("drops the old selector when restarting into a specific session", () => {
		expect(restartArgv(["--session-id", id], "another-session")).toEqual(["--resume", "another-session"]);
		expect(restartArgv(["--session-id", id.toUpperCase()], "file.jsonl", undefined, id)).toEqual([
			"--session-id",
			id,
		]);
		expect(restartArgv([`--session-id=${id}`], "other.jsonl", undefined, "other")).toEqual([
			"--resume",
			"other.jsonl",
		]);
	});

	it("exposes the flag as a free-form value in shell completion metadata", () => {
		const config = {
			bin: "omp",
			commands: new Map([["launch", launchHelp as unknown as CommandCtor]]),
		} as unknown as CliConfig;
		const spec = buildSpec(config, "launch", new Map());
		expect(spec.root.flags.find(flag => flag.name === "session-id")?.value).toEqual({ kind: "value" });
	});
});
