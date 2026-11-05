import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { parseSessionContent } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { TempDir } from "@oh-my-pi/pi-utils";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER = "550e8400-e29b-41d4-a716-446655440001";

describe("explicit session identity", () => {
	it("persists the requested ID and resumes its history across cwd changes and repeated launches", async () => {
		using temp = TempDir.createSync("@explicit-session-");
		const dir = temp.join("sessions");
		const first = await SessionManager.createOrResumeExplicit(ID.toUpperCase(), temp.path(), dir);
		expect(first.resumed).toBe(false);
		expect(first.manager.getSessionId()).toBe(ID);
		expect(first.manager.getHeader()?.id).toBe(ID);
		const file = first.manager.getSessionFile()!;
		expect(parseSessionContent(await Bun.file(file).text()).entries[0]?.id).toBe(ID);
		first.manager.appendMessage({ role: "user", content: "remember this conversation", timestamp: 1 });
		first.manager.appendCustomEntry("explicit-test", { value: "retained" });
		await first.manager.flush();
		await first.manager.close();

		const second = await SessionManager.createOrResumeExplicit(ID, path.dirname(temp.path()), dir);
		expect(second.resumed).toBe(true);
		expect(second.manager.getSessionId()).toBe(ID);
		expect(second.manager.getSessionFile()).toBe(file);
		expect(second.manager.buildSessionContext().messages).toContainEqual({
			role: "user",
			content: "remember this conversation",
			timestamp: 1,
		});
		expect(
			second.manager.getEntries().some(entry => entry.type === "custom" && entry.customType === "explicit-test"),
		).toBe(true);
		await second.manager.close();
		const third = await SessionManager.createOrResumeExplicit(ID, temp.path(), dir);
		expect(third.resumed).toBe(true);
		expect(third.manager.buildSessionContext().messages).toContainEqual({
			role: "user",
			content: "remember this conversation",
			timestamp: 1,
		});
		expect(
			third.manager.getEntries().some(entry => entry.type === "custom" && entry.customType === "explicit-test"),
		).toBe(true);
		await third.manager.close();
		const other = await SessionManager.createOrResumeExplicit(OTHER, temp.path(), dir);
		expect(other.resumed).toBe(false);
		expect(other.manager.getSessionId()).toBe(OTHER);
		await other.manager.close();
	});

	it("rejects malformed IDs and corrupted or duplicate sessions without rewriting them", async () => {
		using temp = TempDir.createSync("@explicit-session-corrupt-");
		const dir = temp.join("sessions");
		await expect(SessionManager.createOrResumeExplicit("not-a-uuid", temp.path(), dir)).rejects.toThrow("UUID");
		const created = await SessionManager.createOrResumeExplicit(ID, temp.path(), dir);
		const file = created.manager.getSessionFile()!;
		await created.manager.close();
		const original = await Bun.file(file).text();
		await Bun.write(file, `${original}{broken\n`);
		await expect(SessionManager.createOrResumeExplicit(ID, temp.path(), dir)).rejects.toThrow("corrupt");
		expect(await Bun.file(file).text()).toBe(`${original}{broken\n`);
		await Bun.write(file, original);
		await Bun.write(path.join(dir, "duplicate.jsonl"), original);
		await expect(SessionManager.createOrResumeExplicit(ID, temp.path(), dir)).rejects.toThrow("multiple");
	});

	it("lists an explicit session in its original project and resolves it from another project", async () => {
		using temp = TempDir.createSync("@explicit-session-list-");
		const modulePath = path.join(import.meta.dir, "../../src/session/session-manager.ts");
		const script = `import { SessionManager } from ${JSON.stringify(modulePath)};
			const id = process.env.TEST_ID, cwd = process.env.TEST_CWD;
			const first = await SessionManager.createOrResumeExplicit(id, cwd);
			first.manager.appendMessage({ role: "user", content: "listed conversation", timestamp: 1 });
			await first.manager.close();
			const listed = await SessionManager.list(cwd);
			if (!listed.some(session => session.id === id)) throw new Error("session missing from project listing");
			const reopened = await SessionManager.createOrResumeExplicit(id, process.env.TEST_OTHER_CWD);
			if (!reopened.resumed || reopened.manager.getSessionId() !== id) throw new Error("session was not resumed");
			await reopened.manager.close();`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: temp.join("agent"),
				TEST_ID: ID,
				TEST_CWD: temp.path(),
				TEST_OTHER_CWD: path.dirname(temp.path()),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(child.stderr).text();
		expect({ exit: await child.exited, stderr }).toEqual({ exit: 0, stderr: "" });
	});

	it("rejects a concurrent process before it can create a second file", async () => {
		using temp = TempDir.createSync("@explicit-session-process-");
		const dir = temp.join("sessions");
		const first = await SessionManager.createOrResumeExplicit(ID, temp.path(), dir);
		try {
			const modulePath = path.join(import.meta.dir, "../../src/session/session-manager.ts");
			const script = `import { SessionManager } from ${JSON.stringify(modulePath)};
				try { await SessionManager.createOrResumeExplicit(process.env.TEST_ID, process.env.TEST_CWD, process.env.TEST_DIR); }
				catch (error) { process.stderr.write(String(error)); process.exit(2); }`;
			const child = Bun.spawn([process.execPath, "-e", script], {
				env: { ...process.env, TEST_ID: ID, TEST_CWD: temp.path(), TEST_DIR: dir },
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(await child.exited).toBe(2);
			expect(await new Response(child.stderr).text()).toContain("already open");
			expect(fs.readdirSync(dir).filter(name => name.endsWith(".jsonl"))).toHaveLength(1);
		} finally {
			await first.manager.close();
		}
	});

	it("refuses a concurrent creator while the first manager owns the identity", async () => {
		using temp = TempDir.createSync("@explicit-session-lock-");
		const dir = temp.join("sessions");
		const first = await SessionManager.createOrResumeExplicit(ID, temp.path(), dir);
		try {
			await expect(SessionManager.createOrResumeExplicit(ID, temp.path(), dir)).rejects.toThrow("already open");
			expect(fs.readdirSync(dir).filter(name => name.endsWith(".jsonl"))).toHaveLength(1);
		} finally {
			await first.manager.close();
		}
	});
});
