/**
 * Host-half unit tests for dsh-workspace-plus.
 *
 * Each test runs against a throw-away directory tree and a fake
 * `workspaceRegistry`, driving the production core (name validation, default
 * parent directory, directory creation/adoption, duplicate-workspace refusal)
 * and the HTTP handlers.
 *
 * Run with:
 *   node plugins/dsh-workspace-plus/tests/host.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	apply,
	CONFIG_PATH,
	CREATE_PATH,
	MOVE_PATH,
	MEMORY_PATH,
	createWorkspaceMemoryTool,
	createMemoryStore,
	createRouteHandlers,
	createWorkspacePlusCore,
	defaultBaseDir,
	inject,
	isInside,
	PLUGIN_VERSION,
	resolveHome,
	validateName
} from "../lib/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createHome() {
	return mkdtemp(join(tmpdir(), "dsh-workspace-plus-"));
}

async function destroyHome(home) {
	await rm(home, { recursive: true, force: true });
}

/** Fake registry shaped after `ctx.workspaceRegistry`. */
function createRegistry(workspaces = []) {
	const list = workspaces.map((workspace) => ({
		path: workspace.path,
		title: workspace.title ?? workspace.path,
		createdAt: workspace.createdAt,
		sessionIds: workspace.sessionIds ?? []
	}));
	return {
		list() { return list; },
		async resolveByPath(path) { return list.find((workspace) => workspace.path === path); }
	};
}

function createCore(home, registry, overrides = {}) {
	return createWorkspacePlusCore({
		getRegistry: () => registry,
		env: { DSH_HOME: home },
		...overrides
	});
}

async function withCore(options, body) {
	const home = await createHome();
	try {
		const registry = options.registry ?? createRegistry();
		const core = createCore(home, registry, options.overrides);
		return await body({ home, registry, core });
	} finally {
		await destroyHome(home);
	}
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("resolveHome honours DSH_HOME and falls back to ~/.dsh", () => {
	assert.equal(resolveHome({ DSH_HOME: "C:\\custom\\home" }), "C:\\custom\\home");
	assert.ok(resolveHome({}).endsWith(".dsh"));
});

test("validateName accepts ordinary and CJK names", () => {
	for (const name of ["数学", "dev", "hardware-2026", "开发 环境", "a.b"]) {
		assert.deepEqual(validateName(name), { ok: true, name });
	}
	assert.equal(validateName("  数学  ").name, "数学");
});

test("validateName refuses path separators, reserved names, dots and empty input", () => {
	const hostile = ["", "   ", "a/b", "a\\b", "..", ".", "con", "NUL.txt", "name.", "a:b", "a*b", "a?b", "a\u0000b", "x".repeat(81)];
	for (const value of hostile) {
		const result = validateName(value);
		assert.equal(result.ok, false, `name ${JSON.stringify(value)} must be refused`);
		assert.equal(result.code, "invalid-name");
		assert.equal(typeof result.message, "string");
	}
	assert.equal(validateName(123).ok, false);
});

test("isInside keeps strict containment on Windows paths", () => {
	assert.equal(isInside("C:\\base", "C:\\base\\child"), true);
	assert.equal(isInside("C:\\base", "C:\\base"), false);
	assert.equal(isInside("C:\\base", "C:\\base2"), false);
});

test("defaultBaseDir uses the parent of the oldest workspace", () => {
	const registry = createRegistry([
		{ path: "C:\\work\\z-old", createdAt: "2026-01-01T00:00:00.000Z" },
		{ path: "C:\\work\\a-new", createdAt: "2026-06-01T00:00:00.000Z" }
	]);
	assert.equal(defaultBaseDir(registry, {}), "C:\\work");
	assert.equal(dirname("C:\\work\\z-old"), "C:\\work");
});

test("defaultBaseDir falls back to <DSH_HOME>/workspaces with no registry", () => {
	const home = join("C:\\", "some-dsh-home");
	assert.equal(defaultBaseDir(undefined, { DSH_HOME: home }), join(home, "workspaces"));
});

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

test("create makes the folder, adopts it when present, and reports the path", async () => {
	await withCore({}, async ({ home, core }) => {
		const first = await core.create({ name: "数学" });
		const expectedBase = await realpath(join(home, "workspaces"));
		assert.equal(first.ok, true);
		assert.equal(first.created, true);
		assert.equal(first.name, "数学");
		assert.equal(first.baseDir.toLowerCase(), expectedBase.toLowerCase());
		assert.equal(first.path.toLowerCase(), join(expectedBase, "数学").toLowerCase());
		assert.equal((await stat(first.path)).isDirectory(), true);

		const again = await core.create({ name: "数学" });
		assert.equal(again.created, false, "an existing folder is adopted rather than recreated");
		assert.equal(again.path.toLowerCase(), first.path.toLowerCase());
	});
});

test("create honours an explicit absolute base directory", async () => {
	await withCore({}, async ({ home, core }) => {
		const base = join(home, "projects");
		const result = await core.create({ name: "dev", baseDir: base });
		assert.equal(result.created, true);
		assert.equal(result.path.toLowerCase(), (await realpath(join(base, "dev"))).toLowerCase());
		assert.equal((await stat(join(base, "dev"))).isDirectory(), true);
	});
});

test("create refuses an existing workspace path and a non-directory name clash", async () => {
	await withCore({}, async ({ home }) => {
		const existingDir = join(home, "workspaces", "taken");
		await mkdir(existingDir, { recursive: true });
		const registry = createRegistry([{ path: await realpath(existingDir), title: "已有分类", createdAt: "2026-01-01T00:00:00.000Z" }]);
		const core = createCore(home, registry);
		await assert.rejects(core.create({ name: "taken" }), (error) => {
			assert.equal(error.code, "workspace-exists");
			assert.equal(error.status, 409);
			assert.match(error.message, /已有分类/);
			return true;
		});

		await writeFile(join(home, "workspaces", "file-name"), "not a folder");
		await assert.rejects(core.create({ name: "file-name" }), (error) => {
			assert.equal(error.code, "not-a-directory");
			assert.equal(error.status, 409);
			return true;
		});
	});
});

test("create rejects bad names, relative bases, and path escapes", async () => {
	await withCore({}, async ({ core }) => {
		await assert.rejects(core.create({ name: "a/b" }), (error) => error.code === "invalid-name" && error.status === 400);
		await assert.rejects(core.create({ name: "ok", baseDir: "relative/dir" }), (error) => error.code === "invalid-base");
		await assert.rejects(core.create({ name: "ok", baseDir: 42 }), (error) => error.code === "invalid-base");
	});
});

test("config reports the default parent directory", async () => {
	await withCore({}, async ({ home, core }) => {
		const config = core.config();
		assert.equal(config.ok, true);
		assert.equal(config.baseDir, join(home, "workspaces"));
		assert.equal(typeof config.version, "string");
	});
});

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

function createRequest(method, url, body) {
	const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
	return {
		method,
		url,
		async *[Symbol.asyncIterator]() {
			for (const chunk of payload) yield chunk;
		}
	};
}

function createResponse() {
	return {
		statusCode: 0,
		headersSent: false,
		body: "",
		writeHead(status) { this.statusCode = status; this.headersSent = true; },
		end(chunk) { if (chunk !== undefined) this.body += String(chunk); }
	};
}

async function call(handler, request) {
	const response = createResponse();
	await handler(request, response);
	return { status: response.statusCode, json: response.body === "" ? undefined : JSON.parse(response.body) };
}

test("config/create handlers answer the wire contract", async () => {
	await withCore({}, async ({ core }) => {
		const handlers = createRouteHandlers(core);

		const config = await call(handlers.config, createRequest("GET", CONFIG_PATH));
		assert.equal(config.status, 200);
		assert.equal(config.json.ok, true);
		assert.equal(typeof config.json.baseDir, "string");

		const created = await call(handlers.create, createRequest("POST", CREATE_PATH, { name: "分类一" }));
		assert.equal(created.status, 200);
		assert.equal(created.json.ok, true);
		assert.equal(created.json.created, true);
		assert.equal(created.json.name, "分类一");

		const invalid = await call(handlers.create, createRequest("POST", CREATE_PATH, { name: "a/b" }));
		assert.equal(invalid.status, 400);
		assert.equal(invalid.json.error.code, "invalid-name");

		assert.equal((await call(handlers.config, createRequest("POST", CONFIG_PATH))).status, 405);
		assert.equal((await call(handlers.create, createRequest("GET", CREATE_PATH))).status, 405);
	});
});

test("plugin entry exposes the web-server contract", () => {
	assert.deepEqual([...inject], ["webServer"]);
	assert.equal(typeof apply, "function");
	assert.equal(typeof PLUGIN_VERSION, "string");
});

// ---------------------------------------------------------------------------
// Move session
// ---------------------------------------------------------------------------

function createMoveFixture(overrides = {}) {
	const calls = { agentCreated: [], persistenceFlushed: 0, attached: [], archived: [] };
	const events = overrides.events ?? [{ seq: 0, type: "session/title", data: { title: "数学" } }];
	const target = {
		id: "ws-target",
		path: overrides.targetPath ?? "C:\\target",
		title: "目标工作区",
		async attachSession(childId) { calls.attached.push(childId); }
	};
	const services = {
		agents: {
			async create(options) {
				calls.agentCreated.push(options);
				return { agent: { session: { id: options.sessionId } } };
			}
		},
		agentPresets: overrides.withoutPresets === true ? undefined : {
			async resolve(presetId) { return { id: presetId ?? "default" }; },
			async mount() {}
		},
		agentDefaultModel: overrides.withoutModel === true ? undefined : {
			currentSelection() { return { provider: "deepseek", model: "deepseek-chat" }; }
		},
		sessionPersistence: {
			async flush() { calls.persistenceFlushed += 1; }
		},
		sessions: {
			get() { return undefined; },
			async flush() {}
		},
		sessionQuery: {
			async readSession(sessionId) {
				calls.read = sessionId;
				if (overrides.readFailure === true) throw new Error("持久化里找不到这个会话");
				return {
					session: {
						id: sessionId,
						cwd: overrides.sourceCwd ?? "C:\\source",
						createdAt: 1760000000000,
						agentPreset: overrides.agentPreset ?? "standard"
					},
					events
				};
			}
		},
		workspaceRegistry: {
			get(id) { calls.targetGet = id; return overrides.targetMissing === true ? undefined : target; },
			async archiveSession(id, options) {
				calls.archived.push({ id, options });
				if (overrides.archiveFailure === true) throw new Error("the session is active");
			}
		}
	};
	return { calls, services, events, target };
}

function createMoveCore(fixture) {
	return createWorkspacePlusCore({
		getRegistry: () => fixture.services.workspaceRegistry,
		getService: (serviceName) => fixture.services[serviceName],
		env: { DSH_HOME: "C:\\move-test-home" }
	});
}

test("move clones the full history into the target workspace and archives the source", async () => {
	const fixture = createMoveFixture();
	const core = createMoveCore(fixture);
	const result = await core.move({ sessionId: "s-1", targetWorkspaceId: "ws-target" });

	assert.equal(result.ok, true);
	assert.match(result.newSessionId, /^session-/);
	assert.equal(result.archivedSessionId, "s-1");
	assert.equal(result.targetWorkspaceId, "ws-target");
	assert.equal(result.targetTitle, "目标工作区");

	assert.equal(fixture.calls.agentCreated.length, 1);
	const created = fixture.calls.agentCreated[0];
	assert.equal(created.sessionId, result.newSessionId, "the agent factory mints the new session under the requested id");
	assert.equal(created.meta.cwd, "C:\\target");
	assert.equal(created.meta.createdAt, 1760000000000);
	assert.equal(created.meta.agentPreset, "standard");
	assert.equal(created.seed, fixture.events);
	assert.equal(created.agentOptions.provider, "deepseek");
	assert.equal(created.agentOptions.model, "deepseek-chat");
	assert.equal(fixture.calls.persistenceFlushed, 1, "the persistence barrier ran before archiving");
	assert.deepEqual(fixture.calls.attached, [result.newSessionId]);
	assert.deepEqual(fixture.calls.archived, [{ id: "s-1", options: { stopActivity: true } }]);
});

test("move re-addresses copied delivery markers to the new session", async () => {
	const source = Object.freeze([
		Object.freeze({ seq: 0, type: "permission/preset", time: 1, data: Object.freeze({ preset: "workspace-write" }) }),
		Object.freeze({ seq: 1, type: "session-log-deepseek/delivery-accepted", time: 2, data: Object.freeze({ sessionId: "s-1", sessionFormatVersion: 4, throughSeq: 0 }) }),
		Object.freeze({ seq: 2, type: "session-log-deepseek/delivery-accepted", time: 3, data: Object.freeze({ sessionId: "session-other", sessionFormatVersion: 4, throughSeq: 1 }) }),
		Object.freeze({ seq: 3, type: "session/title", time: 4, data: Object.freeze({ title: "数学" }) }),
		Object.freeze({ seq: 4, type: "session-log-deepseek/delivery-accepted", time: 5, data: Object.freeze({ throughSeq: 3 }) })
	]);
	const fixture = createMoveFixture({ events: source });
	const result = await createMoveCore(fixture).move({ sessionId: "s-1", targetWorkspaceId: "ws-target" });

	const created = fixture.calls.agentCreated[0];
	const seed = created.seed;
	assert.notEqual(seed, source, "a seed with foreign markers is rebuilt, never mutated in place");
	assert.deepEqual(seed.map((event) => event.data?.sessionId ?? null), [null, result.newSessionId, result.newSessionId, null, null]);
	assert.equal(seed[0], source[0], "rows without a marker keep their identity");
	assert.equal(seed[3], source[3]);
	assert.equal(seed[4], source[4], "a format-v0 marker names no Session and is left untouched");
	assert.equal(source[1].data.sessionId, "s-1", "the source rows are untouched");
	assert.equal(source[2].data.sessionId, "session-other");
});

test("move refuses a session that already lives in the target directory", async () => {
	const home = await createHome();
	try {
		const fixture = createMoveFixture({ sourceCwd: home, targetPath: home });
		const core = createMoveCore(fixture);
		await assert.rejects(core.move({ sessionId: "s-1", targetWorkspaceId: "ws-target" }), (error) => {
			assert.equal(error.code, "same-workspace");
			assert.equal(error.status, 409);
			return true;
		});
		assert.equal(fixture.calls.agentCreated.length, 0);
	} finally {
		await destroyHome(home);
	}
});

test("move reports missing target, unavailable services and unreadable sessions", async () => {
	const missingTarget = createMoveFixture({ targetMissing: true });
	await assert.rejects(createMoveCore(missingTarget).move({ sessionId: "s-1", targetWorkspaceId: "ws-x" }), (error) => error.code === "target-not-found" && error.status === 404);

	const noServices = createWorkspacePlusCore({ getService: () => undefined });
	await assert.rejects(noServices.move({ sessionId: "s-1", targetWorkspaceId: "ws-target" }), (error) => error.code === "services-unavailable" && error.status === 503);

	const unreadable = createMoveFixture({ readFailure: true });
	await assert.rejects(createMoveCore(unreadable).move({ sessionId: "s-1", targetWorkspaceId: "ws-target" }), (error) => error.code === "session-not-found" && error.status === 404);

	const bad = createMoveFixture();
	await assert.rejects(createMoveCore(bad).move({ sessionId: 42, targetWorkspaceId: "ws-target" }), (error) => error.code === "invalid-session" && error.status === 400);
	await assert.rejects(createMoveCore(bad).move({ sessionId: "s-1" }), (error) => error.code === "invalid-target" && error.status === 400);
});

test("a failed archive still returns the created session id in the error", async () => {
	const fixture = createMoveFixture({ archiveFailure: true });
	await assert.rejects(createMoveCore(fixture).move({ sessionId: "s-1", targetWorkspaceId: "ws-target" }), (error) => {
		assert.equal(error.code, "archive-failed");
		assert.equal(error.status, 500);
		assert.match(error.message, /session-/);
		return true;
	});
});

test("the move route answers POST and refuses other methods", async () => {
	const fixture = createMoveFixture();
	const handlers = createRouteHandlers(createMoveCore(fixture));

	const moved = await call(handlers.move, createRequest("POST", MOVE_PATH, { sessionId: "s-1", targetWorkspaceId: "ws-target" }));
	assert.equal(moved.status, 200);
	assert.equal(moved.json.ok, true);
	assert.match(moved.json.newSessionId, /^session-/);

	const rejected = await call(handlers.move, createRequest("GET", MOVE_PATH));
	assert.equal(rejected.status, 405);

	const missingFixture = createMoveFixture({ targetMissing: true });
	const missingHandlers = createRouteHandlers(createMoveCore(missingFixture));
	const invalid = await call(missingHandlers.move, createRequest("POST", MOVE_PATH, { sessionId: "s-1", targetWorkspaceId: "ws-missing" }));
	assert.equal(invalid.status, 404);
	assert.equal(invalid.json.error.code, "target-not-found");
});

// ---------------------------------------------------------------------------
// Workspace memory
// ---------------------------------------------------------------------------

function createMemoryFixture(workspaces = [{ id: "ws-1", title: "工作区一", path: "C:\\w1" }, { id: "ws-2", title: "工作区二", path: "C:\\w2" }]) {
	const calls = { filtered: [], searched: [] };
	const registry = {
		list() { return workspaces; },
		get(id) { return workspaces.find((workspace) => workspace.id === id); }
	};
	const sessionQuery = {
		async filterSessions(filters) {
			calls.filtered.push(filters);
			let rows = [
				{ header: { id: "s-other", cwd: "C:\\w1", createdAt: 1700000000000 } },
				{ header: { id: "s-elsewhere", cwd: "C:\\w2", createdAt: 1600000000000 } }
			];
			const idFilter = filters.find((filter) => filter.kind === "id");
			if (idFilter !== undefined) rows = rows.filter((row) => idFilter.values.includes(row.header.id));
			const cwdFilter = filters.find((filter) => filter.kind === "cwd");
			if (cwdFilter !== undefined) rows = rows.filter((row) => cwdFilter.values.includes(row.header.cwd));
			return rows;
		},
		async readTitleSnapshots(ids) {
			return ids.map((id) => ({ sessionId: id, status: "fulfilled", value: { title: { title: "会话 " + id } } }));
		},
		async searchSessions(request) {
			calls.searched.push(request);
			return { items: [{ header: { id: "s-other", cwd: "C:\\w1", createdAt: 1700000000000 }, bestMatch: { seq: 7, type: "assistant/message", surface: "current", snippet: "命中片段" } }] };
		},
		async readSession(id) {
			return {
				session: { id, cwd: "C:\\w1" },
				events: [
					{ seq: 0, type: "user/message", data: { message: { content: [{ type: "text", text: "你好" }] } } },
					{ seq: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "你好呀" }] } } }
				]
			};
		}
	};
	return { calls, registry, sessionQuery };
}

async function withMemoryCore(fixture, body) {
	const home = await createHome();
	try {
		const core = createWorkspacePlusCore({
			getRegistry: () => fixture.registry,
			getService: (name) => (name === "sessionQuery" ? fixture.sessionQuery : undefined),
			env: { DSH_HOME: home }
		});
		return await body({ home, core });
	} finally {
		await destroyHome(home);
	}
}

test("the memory store starts empty and round-trips switches", async () => {
	const home = await createHome();
	try {
		const store = createMemoryStore({ env: { DSH_HOME: home } });
		assert.deepEqual(await store.load(), { version: 1, workspaces: {} });
		await store.save({ version: 1, workspaces: { "ws-1": true } });
		const reloaded = createMemoryStore({ env: { DSH_HOME: home } });
		assert.deepEqual(await reloaded.load(), { version: 1, workspaces: { "ws-1": true } });
		assert.equal((await readFile(join(home, "workspace-plus", "workspace-memory.json"), "utf8")).includes("ws-1"), true);
	} finally {
		await destroyHome(home);
	}
});

test("memoryConfig lists workspaces with their switch and memorySet persists", async () => {
	const fixture = createMemoryFixture();
	await withMemoryCore(fixture, async ({ core }) => {
		const initial = await core.memoryConfig();
		assert.deepEqual(initial.workspaces.map((workspace) => [workspace.workspaceId, workspace.enabled]), [["ws-1", false], ["ws-2", false]]);

		const updated = await core.memorySet({ workspaceId: "ws-1", enabled: true });
		assert.equal(updated.workspaces.find((workspace) => workspace.workspaceId === "ws-1").enabled, true);

		await assert.rejects(core.memorySet({ workspaceId: "ws-missing", enabled: true }), (error) => error.code === "workspace-not-found" && error.status === 404);
		await assert.rejects(core.memorySet({ workspaceId: "", enabled: true }), (error) => error.code === "invalid-workspace");
	});
});

test("a compaction summary queue one hand-off at the end of the turn and ack removes it", async () => {
	const fixture = createMemoryFixture();
	fixture.sessionQuery.readTitle = async () => "旧任务";
	await withMemoryCore(fixture, async ({ core }) => {
		await core.memorySet({ workspaceId: "ws-1", enabled: true });
		const session = { id: "s-old", header: { cwd: "C:\\w1" } };
		core.observeSessionEvent(session, { type: "compaction/summary", data: { summary: "压缩后的摘要" } });
		assert.equal(core.pendingConfig().pending.length, 0, "waits for the turn end");
		core.observeSessionEvent(session, { type: "turn/end", data: {} });
		await new Promise((resolve) => setTimeout(resolve, 30));
		const pending = core.pendingConfig().pending;
		assert.equal(pending.length, 1);
		assert.equal(pending[0].workspaceId, "ws-1");
		assert.equal(pending[0].sessionId, "s-old");
		assert.equal(pending[0].summary, "压缩后的摘要");
		assert.equal(pending[0].title, "旧任务");
		await core.pendingAck({ id: pending[0].id });
		assert.equal(core.pendingConfig().pending.length, 0);
	});
});

test("no hand-off is queued when the workspace switch is off", async () => {
	const fixture = createMemoryFixture();
	await withMemoryCore(fixture, async ({ core }) => {
		const session = { id: "s-old", header: { cwd: "C:\\w1" } };
		core.observeSessionEvent(session, { type: "compaction/summary", data: { summary: "摘要" } });
		core.observeSessionEvent(session, { type: "turn/end", data: {} });
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(core.pendingConfig().pending.length, 0);
	});
});

test("workspace_memory lists, searches and reads only the caller's workspace", async () => {
	const fixture = createMemoryFixture();
	await withMemoryCore(fixture, async ({ core }) => {
		await core.memorySet({ workspaceId: "ws-1", enabled: true });
		const exec = { agent: { session: { id: "s-self", header: { cwd: "C:\\w1" } } } };
		const tool = createWorkspaceMemoryTool(core);
		assert.equal(tool.name, "workspace_memory");
		assert.equal(typeof tool.execute, "function");

		const list = await tool.execute({ action: "list" }, exec);
		assert.ok(list.includes("本工作区「工作区一」"));
		assert.ok(list.includes("会话 s-other"));
		assert.ok(!list.includes("s-elsewhere"), "other workspaces stay hidden");

		const search = await tool.execute({ action: "search", query: "题目" }, exec);
		assert.ok(search.includes("命中片段"));
		assert.equal(fixture.calls.searched.length, 1);
		assert.deepEqual(fixture.calls.searched[0].sessionFilters, [{ kind: "cwd", values: ["C:\\w1"] }]);

		const read = await tool.execute({ action: "read", session_id: "s-other" }, exec);
		assert.ok(read.includes("你好"));
		assert.ok(read.includes("你好呀"));

		const refused = await tool.execute({ action: "read", session_id: "s-elsewhere" }, exec);
		assert.ok(refused.includes("不属于本工作区"));
	});
});

test("workspace_memory refuses when the workspace switch is off", async () => {
	const fixture = createMemoryFixture();
	await withMemoryCore(fixture, async ({ core }) => {
		const tool = createWorkspaceMemoryTool(core);
		const text = await tool.execute({ action: "list" }, { agent: { session: { id: "s-self", header: { cwd: "C:\\w1" } } } });
		assert.ok(text.includes("没有开启「工作区记忆」"));
	});
});

test("the memory routes answer GET/POST", async () => {
	const fixture = createMemoryFixture();
	await withMemoryCore(fixture, async ({ core }) => {
		const handlers = createRouteHandlers(core);
		const listed = await call(handlers.memory, createRequest("GET", MEMORY_PATH));
		assert.equal(listed.status, 200);
		assert.equal(listed.json.workspaces.length, 2);

		const toggled = await call(handlers.memory, createRequest("POST", MEMORY_PATH, { workspaceId: "ws-2", enabled: true }));
		assert.equal(toggled.status, 200);
		assert.equal(toggled.json.workspaces.find((workspace) => workspace.workspaceId === "ws-2").enabled, true);

		const pending = await call(handlers.pending, createRequest("GET", "/api/workspace-plus/memory/pending"));
		assert.equal(pending.status, 200);
		assert.deepEqual(pending.json.pending, []);
		assert.equal((await call(handlers.ack, createRequest("GET", "/api/workspace-plus/memory/ack"))).status, 405);
		assert.equal((await call(handlers.memory, createRequest("PUT", MEMORY_PATH))).status, 405);
	});
});




