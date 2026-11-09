/**
 * dsh-workspace-plus — host half.
 *
 * DSH's Workspace registry binds every workspace to one directory, and the
 * sidebar's "add workspace" flow is a directory picker. This plugin keeps the
 * binding but replaces the interaction: the client asks for a NAME, and this
 * host half creates the matching directory (unless it already exists) and
 * returns its canonical path, which the native flow then adopts as a
 * workspace.
 *
 * Routes (exact match on ctx.webServer):
 *   GET  /api/workspace-plus/config -> { ok, baseDir }
 *   POST /api/workspace-plus/create { name, baseDir? } ->
 *        { ok, path, baseDir, name, created }
 *
 * The default parent directory is the parent of the oldest workspace (the
 * default workspace created by DSH), so categories land next to the existing
 * workspace instead of in a hidden application folder. With no workspace yet,
 * `<DSH_HOME>/workspaces` is used.
 *
 * The file is plain ESM with no build step and imports only Node builtins.
 */

import { readFileSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Plugin name as mounted by the Cordis loader. */
export const name = "dsh-workspace-plus";

/** Routes: only the web server is required; the registry is read defensively. */
export const inject = ["webServer"];

/** Current default parent directory. */
export const CONFIG_PATH = "/api/workspace-plus/config";
/** Create one named workspace directory. */
export const CREATE_PATH = "/api/workspace-plus/create";
/** Clone one session into another workspace and archive the original. */
export const MOVE_PATH = "/api/workspace-plus/move-session";
/** Per-workspace session-memory switches. */
export const MEMORY_PATH = "/api/workspace-plus/memory";
/** Continuation hand-offs produced when an enabled workspace compacts a session. */
export const PENDING_PATH = "/api/workspace-plus/memory/pending";
/** Acknowledge (dismiss) one continuation hand-off. */
export const ACK_PATH = "/api/workspace-plus/memory/ack";

/** Longest accepted workspace name. */
export const MAX_NAME_LENGTH = 80;
/** Directory created when no workspace exists yet. */
export const FALLBACK_FOLDER = "workspaces";

/** Version reported by /config, read from the package manifest when present. */
export const PLUGIN_VERSION = readPluginVersion();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read this package's version from `../package.json`, or a neutral value. */
function readPluginVersion() {
	try {
		const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const parsed = JSON.parse(raw);
		if (parsed !== null && typeof parsed === "object" && typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
	} catch {
		/* neutral version */
	}
	return "0.0.0";
}

/** Resolve the DSH home the way `@deepseek-ai/dsh-home-paths` does. */
export function resolveHome(env = process.env) {
	const configured = env?.DSH_HOME;
	const value = typeof configured === "string" && configured.trim().length > 0 ? configured : join(homedir(), ".dsh");
	return resolve(expandHome(value));
}

/** Expand `~`, `~/`, `~\`; other values pass through. */
function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}

/** Whether `child` is lexically inside `parent` (not equal). */
export function isInside(parent, child) {
	const rel = relative(resolve(parent), resolve(child));
	return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/** Human-readable message of any thrown value. */
function messageOf(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** Format a session timestamp for tool output. */
function formatTimestamp(value) {
	if (value === undefined || value === null) return "未知";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return String(value);
	return date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * The upload watermark `session-log-deepseek` appends to a Session log.
 *
 * A fixed-format event, it must name the Session whose log contains it; the v4
 * decoder rejects a stored log whose marker names any other Session
 * ("current-generation delivery marker names the wrong Session"). Only a
 * seeded fork may keep its parent's markers, inside the inherited prefix.
 */
export const DELIVERY_MARKER_TYPE = "session-log-deepseek/delivery-accepted";

/**
 * Re-address the delivery markers copied into a clone so they name the Session
 * that will own them. Every other row is passed through by identity, and the
 * source rows are never mutated: a clone is a new standalone Session, not a
 * fork, so its log may only cite itself. Format-v0 markers (no `sessionId`,
 * omitted `sessionFormatVersion`) name nobody and are left untouched.
 *
 * @param events - source event rows read from `sessionQuery.readSession`.
 * @param sessionId - the new (cloned) Session id.
 * @returns the same array when no marker needs re-addressing, else a copy with
 *   only the marker payloads rewritten.
 */
export function rewriteCloneSeed(events, sessionId) {
	if (!Array.isArray(events) || events.length === 0) return events;
	let rewritten = false;
	const seed = events.map((event) => {
		if (event === null || typeof event !== "object" || event.type !== DELIVERY_MARKER_TYPE) return event;
		const data = event.data;
		if (data === null || typeof data !== "object" || typeof data.sessionId !== "string" || data.sessionId === sessionId) return event;
		rewritten = true;
		return { ...event, data: { ...data, sessionId } };
	});
	return rewritten ? seed : events;
}

/** Whether two existing directories resolve to the same place (case-insensitive on Windows). */
async function sameDirectory(left, right) {
	if (typeof left !== "string" || typeof right !== "string" || left === "" || right === "") return false;
	try {
		const [a, b] = await Promise.all([realpath(left), realpath(right)]);
		return a.toLowerCase() === b.toLowerCase();
	} catch {
		return resolve(left).toLowerCase() === resolve(right).toLowerCase();
	}
}

/** Error carrying a stable wire code and HTTP status. */
export class WorkspacePlusError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.name = "WorkspacePlusError";
		this.code = code;
		this.status = status;
	}
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// ---------------------------------------------------------------------------
// Workspace memory store
// ---------------------------------------------------------------------------

/** On-disk location of the per-workspace memory switches. */
export function memoryPaths(env = process.env) {
	const root = join(resolveHome(env), "workspace-plus");
	return { root, file: join(root, "workspace-memory.json") };
}

/**
 * Small JSON store for the per-workspace switches: a missing or corrupt file
 * reads as "all off", and a save rewrites it in place.
 * @param options.env - environment for DSH home resolution.
 * @param options.fsOps - injectable filesystem operations.
 */
export function createMemoryStore(options = {}) {
	const env = options.env ?? process.env;
	const fsOps = { readFile, writeFile, mkdir, ...(options.fsOps ?? {}) };
	const paths = memoryPaths(env);
	const load = async () => {
		try {
			const text = await fsOps.readFile(paths.file, "utf8");
			const parsed = JSON.parse(text);
			const workspaces = parsed !== null && typeof parsed === "object" && parsed.workspaces !== null && typeof parsed.workspaces === "object" ? parsed.workspaces : {};
			return { version: 1, workspaces };
		} catch {
			return { version: 1, workspaces: {} };
		}
	};
	const save = async (document) => {
		await fsOps.mkdir(paths.root, { recursive: true });
		await fsOps.writeFile(paths.file, JSON.stringify(document, null, 2) + "\n", "utf8");
	};
	return { paths, load, save };
}

/** Collect the visible text of one session event, bounded by `budget` chars. */
function collectEventText(event, budget) {
	const parts = [];
	const visit = (value, depth) => {
		if (parts.join(" ").length >= budget || depth > 8 || value === null || value === undefined) return;
		if (typeof value === "string") {
			parts.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1);
			return;
		}
		if (typeof value === "object") {
			for (const key of Object.keys(value)) {
				if (key === "text" || key === "content" || key === "message" || key === "parts") visit(value[key], depth + 1);
			}
		}
	};
	visit(event !== null && typeof event === "object" ? event.data : event, 0);
	return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, budget);
}

/**
 * Build the model-facing `workspace_memory` tool definition. It is a plain
 * registry-ready object (the plugin cannot import `defineTool` from the host's
 * private package tree), and delegates every decision to the core.
 * @param core - result of {@link createWorkspacePlusCore}.
 */
export function createWorkspaceMemoryTool(core) {
	return {
		name: "workspace_memory",
		description: "查看/检索本工作区里其他会话（任务）的标题与历史内容。仅当本工作区在「设置 → 工作区记忆」开启时可用。action=list 列出本工作区最近的会话；action=search 用 query 对本工作区历史做全文检索；action=read 用 session_id 读取某个会话的最近内容。",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["list", "search", "read"] },
				query: { type: "string" },
				session_id: { type: "string" },
				limit: { type: "integer", minimum: 1, maximum: 50 }
			},
			required: ["action"]
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{ type: "text", text: value }]
		},
		timeoutMs: 30000,
		isConcurrencySafe: () => true,
		execute: (args, exec) => core.runWorkspaceMemory(args, exec)
	};
}

/**
 * Validate a user-entered workspace name. The name becomes one directory
 * segment, so separators, control characters, Windows-reserved device names
 * and trailing dots are refused with a stable code.
 * @param raw - candidate name.
 * @returns `{ ok:true, name }` or `{ ok:false, code, message }`.
 */
export function validateName(raw) {
	if (typeof raw !== "string") return invalidName("工作区名称必须是字符串");
	const value = raw.trim();
	if (value.length === 0) return invalidName("请输入工作区名称");
	if (value.length > MAX_NAME_LENGTH) return invalidName(`工作区名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
	if (/[\u0000-\u001f\u007f]/.test(value)) return invalidName("工作区名称不能包含控制字符");
	if (/[<>:"/\\|?*]/.test(value)) return invalidName('工作区名称不能包含 < > : " / \\ | ? * 这些字符');
	if (value === "." || value === "..") return invalidName("工作区名称不能是 . 或 ..");
	if (value.endsWith(".")) return invalidName("工作区名称不能以句点结尾");
	if (WINDOWS_RESERVED.test(value)) return invalidName("这个名称在 Windows 上是保留设备名，请换一个");
	return { ok: true, name: value };
}

function invalidName(message) {
	return { ok: false, code: "invalid-name", message };
}

/**
 * Default parent directory for new workspace folders: the parent of the
 * OLDEST workspace (DSH creates the default workspace first), so categories
 * become siblings of the existing workspace. Falls back to
 * `<DSH_HOME>/workspaces` when nothing exists yet.
 * @param registry - `ctx.workspaceRegistry` (or undefined).
 * @param env - environment for DSH home resolution.
 * @returns absolute directory.
 */
export function defaultBaseDir(registry, env = process.env) {
	try {
		const list = typeof registry?.list === "function" ? registry.list() : [];
		if (Array.isArray(list) && list.length > 0) {
			const candidates = list
				.filter((workspace) => workspace !== null && typeof workspace === "object" && typeof workspace.path === "string" && workspace.path.length > 0)
				.map((workspace) => ({ path: workspace.path, createdAt: typeof workspace.createdAt === "string" ? workspace.createdAt : "" }))
				.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
			if (candidates.length > 0) return dirname(candidates[0].path);
		}
	} catch {
		/* fall through to the fallback */
	}
	return join(resolveHome(env), FALLBACK_FOLDER);
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Build the creation/move core with injectable services and filesystem, so the
 * unit tests can drive the production path against a temporary home.
 * @param options.getRegistry - accessor for `ctx.workspaceRegistry`.
 * @param options.getService - accessor for any host service (sessions, sessionQuery, workspaceRegistry).
 * @param options.env - environment mapping for DSH home resolution.
 * @param options.fsOps - injectable filesystem operations.
 * @param options.logger - Cordis logger (optional).
 * @returns `{ config, create, move }`.
 */
export function createWorkspacePlusCore(options = {}) {
	const env = options.env ?? process.env;
	const fsOps = { lstat, mkdir, realpath, ...(options.fsOps ?? {}) };
	const logger = options.logger ?? { info() {}, warn() {} };
	const getRegistry = options.getRegistry ?? (() => undefined);
	const getService = options.getService ?? (() => undefined);
	const memoryStore = options.memoryStore ?? createMemoryStore({ env });
	/** Continuation hand-offs waiting for the browser to open them. */
	const pendingContinuations = new Map();
	let pendingCounter = 0;
	/** Latest compaction summary per session, consumed at the turn end. */
	const compactionSummaries = new Map();

	const listWorkspaces = () => {
		try {
			const registry = getRegistry();
			const list = registry !== undefined && registry !== null && typeof registry.list === "function" ? registry.list() : [];
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	};

	const findWorkspaceByCwd = (cwd) => {
		if (typeof cwd !== "string" || cwd === "") return undefined;
		return listWorkspaces().find((workspace) => workspace !== null && workspace !== undefined && typeof workspace === "object" && typeof workspace.path === "string" && workspace.path.toLowerCase() === cwd.toLowerCase());
	};

	/** Current default parent directory for the dialog preview. */
	const config = () => {
		const baseDir = defaultBaseDir(getRegistry(), env);
		return { ok: true, baseDir, version: PLUGIN_VERSION };
	};

	/**
	 * Create (or adopt) the directory for one workspace name.
	 * @param body - `{ name, baseDir? }`.
	 * @returns `{ ok, path, baseDir, name, created }`.
	 */
	const create = async (body = {}) => {
		const validation = validateName(body?.name);
		if (validation.ok !== true) throw new WorkspacePlusError(validation.code, validation.message, 400);
		const workspaceName = validation.name;

		let base;
		if (body?.baseDir !== undefined && body?.baseDir !== null) {
			if (typeof body.baseDir !== "string" || body.baseDir.trim().length === 0) throw new WorkspacePlusError("invalid-base", "父目录必须是绝对路径", 400);
			const rawBase = body.baseDir.trim();
			const expanded = expandHome(rawBase);
			if (!isAbsolute(expanded)) throw new WorkspacePlusError("invalid-base", `父目录不是绝对路径：${rawBase}`, 400);
			base = resolve(expanded);
		} else {
			base = defaultBaseDir(getRegistry(), env);
		}

		const target = join(base, workspaceName);
		if (!isInside(base, target)) throw new WorkspacePlusError("invalid-name", "工作区名称会逃出父目录，已拒绝", 400);

		try {
			await fsOps.mkdir(base, { recursive: true });
		} catch (error) {
			throw new WorkspacePlusError("base-unavailable", `无法创建父目录 '${base}'：${messageOf(error)}`, 500);
		}

		let created = false;
		let info = null;
		try {
			info = await fsOps.lstat(target);
		} catch (error) {
			if (error === null || typeof error !== "object" || error.code !== "ENOENT") {
				throw new WorkspacePlusError("filesystem-error", `无法检查 '${target}'：${messageOf(error)}`, 500);
			}
		}
		if (info === null) {
			try {
				await fsOps.mkdir(target, { recursive: true });
				created = true;
			} catch (error) {
				throw new WorkspacePlusError("create-failed", `无法创建目录 '${target}'：${messageOf(error)}`, 500);
			}
		} else if (!info.isDirectory()) {
			throw new WorkspacePlusError("not-a-directory", `「${workspaceName}」已存在且不是文件夹，请换一个名称`, 409);
		}

		let realTarget;
		let realBase;
		try {
			realTarget = await fsOps.realpath(target);
			realBase = await fsOps.realpath(base);
		} catch (error) {
			throw new WorkspacePlusError("filesystem-error", `无法解析路径：${messageOf(error)}`, 500);
		}

		const registry = getRegistry();
		if (registry !== undefined && typeof registry.resolveByPath === "function") {
			let existing;
			try {
				existing = await registry.resolveByPath(realTarget);
			} catch {
				existing = undefined;
			}
			if (existing !== undefined && existing !== null) {
				throw new WorkspacePlusError("workspace-exists", `已经有工作区指向这个目录（「${String(existing.title ?? realTarget)}」），请换一个名称`, 409);
			}
		}

		logger.info?.(`[dsh-workspace-plus] workspace directory ${created ? "created" : "reused"}: ${realTarget}`);
		return { ok: true, path: realTarget, baseDir: realBase, name: workspaceName, created };
	};

	/**
	 * Move one session to another workspace.
	 *
	 * DSH binds a session to its recorded `cwd` and exposes no in-place
	 * migration, so this follows the supported clone semantics: read the whole
	 * source log, create a new session that inherits it at the target
	 * workspace's directory, attach it to that workspace, then archive the
	 * original (stopping its activity, so an open conversation can move too).
	 * The new session keeps the original title/history through the inherited
	 * events; only its id and cwd change. Because the clone owns its whole log,
	 * copied `session-log-deepseek/delivery-accepted` markers are re-addressed to
	 * the new id first — a marker that still named the source Session would make
	 * the stored log fail to load ("delivery marker names the wrong Session").
	 * @param body - `{ sessionId, targetWorkspaceId }`.
	 * @returns `{ ok, newSessionId, archivedSessionId, targetWorkspaceId, targetTitle }`.
	 */
	const move = async (body = {}) => {
		const sessionId = body?.sessionId;
		const targetWorkspaceId = body?.targetWorkspaceId;
		if (typeof sessionId !== "string" || sessionId.trim() === "") throw new WorkspacePlusError("invalid-session", "sessionId 必须是会话标识", 400);
		if (typeof targetWorkspaceId !== "string" || targetWorkspaceId.trim() === "") throw new WorkspacePlusError("invalid-target", "targetWorkspaceId 必须是工作区标识", 400);

		const sessions = getService("sessions");
		const sessionQuery = getService("sessionQuery");
		const registry = getService("workspaceRegistry");
		const agents = getService("agents");
		if (sessionQuery === undefined || registry === undefined || agents === undefined) {
			throw new WorkspacePlusError("services-unavailable", "宿主服务不可用（需要 agents / sessionQuery / workspaceRegistry）", 503);
		}

		const target = registry.get(targetWorkspaceId);
		if (target === undefined || target === null) throw new WorkspacePlusError("target-not-found", "目标工作区不存在（可能已经被删除）", 404);
		if (typeof target.path !== "string" || target.path === "") throw new WorkspacePlusError("target-invalid", "目标工作区没有可用的目录", 500);

		let snapshot;
		try {
			snapshot = await sessionQuery.readSession(sessionId);
		} catch (error) {
			throw new WorkspacePlusError("session-not-found", `无法读取会话「${sessionId}」：${messageOf(error)}`, 404);
		}
		const header = snapshot !== null && typeof snapshot === "object" ? snapshot.session : undefined;
		if (header === null || typeof header !== "object") throw new WorkspacePlusError("session-not-found", `会话「${sessionId}」没有可读取的头部`, 404);
		if (await sameDirectory(header.cwd, target.path)) throw new WorkspacePlusError("same-workspace", "这个会话已经在目标工作区里了", 409);

		// Compose the same agent setup the Host's own create/fork path uses: the
		// source preset (when a roster exists) and the current default model.
		const presets = getService("agentPresets");
		const defaultModel = getService("agentDefaultModel");
		let composition = { setup: function () {} };
		if (presets !== undefined && typeof presets.resolve === "function" && typeof presets.mount === "function") {
			try {
				const resolved = await presets.resolve(typeof header.agentPreset === "string" ? header.agentPreset : undefined);
				composition = {
					agentPreset: resolved.id,
					setup: async (agentCtx) => { await presets.mount(agentCtx, resolved.id); }
				};
			} catch {
				/* an unreadable preset must not block the move: fall back to no roster */
			}
		}
		let selection;
		try {
			selection = defaultModel !== undefined && typeof defaultModel.currentSelection === "function" ? defaultModel.currentSelection() : undefined;
		} catch {
			selection = undefined;
		}
		if (selection === undefined || selection === null) throw new WorkspacePlusError("model-unavailable", "宿主没有可用的默认模型，暂时无法创建移动后的会话", 503);

		const childId = "session-" + randomUUID();
		const meta = { cwd: target.path };
		if (header.createdAt !== undefined) meta.createdAt = header.createdAt;
		if (composition.agentPreset !== undefined) meta.agentPreset = composition.agentPreset;
		else if (typeof header.agentPreset === "string") meta.agentPreset = header.agentPreset;

		let created;
		try {
			created = await agents.create({
				sessionId: childId,
				seed: Array.isArray(snapshot.events) ? rewriteCloneSeed(snapshot.events, childId) : [],
				inheritedEventCount: 0,
				meta,
				agentOptions: { provider: selection.provider, model: selection.model },
				setup: composition.setup
			});
		} catch (error) {
			throw new WorkspacePlusError("clone-failed", `创建目标会话失败：${messageOf(error)}`, 500);
		}
		const childSessionId = created !== null && typeof created === "object" && created.agent !== null && typeof created.agent === "object" && created.agent.session !== null && typeof created.agent.session === "object" && typeof created.agent.session.id === "string"
			? created.agent.session.id
			: childId;

		// The agent factory owns the persistence handle; flush it explicitly so the
		// artifact is on disk before the source is archived.
		const persistence = getService("sessionPersistence");
		if (persistence !== undefined && typeof persistence.flush === "function") {
			try { await persistence.flush(); } catch { /* the handle's own later flush still applies */ }
		}
		if (sessions !== undefined && typeof sessions.flush === "function") {
			const live = typeof sessions.get === "function" ? sessions.get(childSessionId) : undefined;
			if (live !== undefined) {
				try { await sessions.flush(live); } catch { /* persistence.flush above is the barrier */ }
			}
		}

		try {
			await target.attachSession(childSessionId);
		} catch (error) {
			throw new WorkspacePlusError("attach-failed", `新会话「${childSessionId}」已创建，但归属目标工作区失败：${messageOf(error)}`, 500);
		}
		try {
			await registry.archiveSession(sessionId, { stopActivity: true });
		} catch (error) {
			throw new WorkspacePlusError("archive-failed", `新会话「${childSessionId}」已移到目标工作区，但归档原会话失败：${messageOf(error)}`, 500);
		}

		logger.info?.(`[dsh-workspace-plus] moved session ${sessionId} -> ${childSessionId} (${targetWorkspaceId})`);
		return {
			ok: true,
			newSessionId: childSessionId,
			archivedSessionId: sessionId,
			targetWorkspaceId,
			targetTitle: typeof target.title === "string" ? target.title : ""
		};
	};

	// ---- Workspace memory ------------------------------------------------

	/** Per-workspace switches for the settings section. */
	const memoryConfig = async () => {
		const document = await memoryStore.load();
		const workspaces = listWorkspaces()
			.filter((workspace) => workspace !== null && workspace !== undefined && typeof workspace === "object" && typeof workspace.id === "string")
			.map((workspace) => ({
				workspaceId: workspace.id,
				title: typeof workspace.title === "string" ? workspace.title : "",
				path: typeof workspace.path === "string" ? workspace.path : "",
				enabled: document.workspaces[workspace.id] === true
			}));
		return { ok: true, workspaces };
	};

	/** Flip one workspace's memory switch. */
	const memorySet = async (body = {}) => {
		const workspaceId = body?.workspaceId;
		if (typeof workspaceId !== "string" || workspaceId === "") throw new WorkspacePlusError("invalid-workspace", "workspaceId 必须是工作区标识", 400);
		const registry = getRegistry();
		const workspace = registry !== undefined && registry !== null && typeof registry.get === "function" ? registry.get(workspaceId) : undefined;
		if (workspace === undefined || workspace === null) throw new WorkspacePlusError("workspace-not-found", "工作区不存在（可能已经被删除）", 404);
		const enabled = body?.enabled === true;
		const document = await memoryStore.load();
		const workspaces = { ...document.workspaces };
		if (enabled === true) workspaces[workspaceId] = true;
		else delete workspaces[workspaceId];
		await memoryStore.save({ version: 1, workspaces });
		return { ok: true, workspaces: (await memoryConfig()).workspaces };
	};

	/** Hand-offs the browser should open as the next conversation. */
	const pendingConfig = () => ({ ok: true, pending: [...pendingContinuations.values()] });

	const pendingAck = async (body = {}) => {
		const id = body?.id;
		if (typeof id === "string") {
			for (const [sessionId, entry] of pendingContinuations) {
				if (entry.id === id) {
					pendingContinuations.delete(sessionId);
					break;
				}
			}
		}
		return { ok: true };
	};

	/**
	 * Session-event hook for the automatic continuation: remember the compaction
	 * summary, and when that turn ends in a memory-enabled workspace queue one
	 * hand-off (opened by the browser as a new conversation).
	 */
	const observeSessionEvent = (session, event) => {
		if (session === null || typeof session !== "object" || typeof session.id !== "string") return;
		if (event === null || typeof event !== "object" || typeof event.type !== "string") return;
		if (event.type === "compaction/summary") {
			const summary = event.data !== null && typeof event.data === "object" && typeof event.data.summary === "string" ? event.data.summary : "";
			if (summary !== "") compactionSummaries.set(session.id, summary.slice(0, 4000));
			return;
		}
		if (event.type !== "turn/end") return;
		const summary = compactionSummaries.get(session.id);
		if (summary === undefined) return;
		compactionSummaries.delete(session.id);
		void (async () => {
			try {
				const header = session.header !== null && typeof session.header === "object" ? session.header : undefined;
				const cwd = header !== undefined ? header.cwd : undefined;
				const workspace = findWorkspaceByCwd(cwd);
				if (workspace === undefined || workspace === null || typeof workspace.id !== "string") return;
				const document = await memoryStore.load();
				if (document.workspaces[workspace.id] !== true) return;
				const sessionQuery = getService("sessionQuery");
				let title = "";
				if (sessionQuery !== undefined && typeof sessionQuery.readTitle === "function") {
					try {
						const value = await sessionQuery.readTitle(session.id);
						if (typeof value === "string") title = value;
					} catch {
						title = "";
					}
				}
				pendingCounter += 1;
				pendingContinuations.set(session.id, {
					id: `continuation-${pendingCounter}`,
					workspaceId: workspace.id,
					workspaceTitle: typeof workspace.title === "string" ? workspace.title : "",
					sessionId: session.id,
					title,
					summary,
					createdAt: new Date().toISOString()
				});
				logger.info?.(`[dsh-workspace-plus] queued workspace-memory continuation for session ${session.id}`);
			} catch (error) {
				logger.warn?.(`[dsh-workspace-plus] queued continuation failed: ${messageOf(error)}`);
			}
		})();
	};

	const titlesOf = async (sessionQuery, ids) => {
		const map = new Map();
		if (ids.length === 0) return map;
		try {
			const observed = await sessionQuery.readTitleSnapshots(ids);
			for (const item of observed) {
				if (item === null || item === undefined || item.status !== "fulfilled") continue;
				const value = item.value;
				const title = typeof value?.title?.title === "string" ? value.title.title : typeof value?.title === "string" ? value.title : "";
				if (typeof item.sessionId === "string") map.set(item.sessionId, title);
			}
		} catch {
			// titles are cosmetic: leave untitled entries
		}
		return map;
	};

	/**
	 * Execute one `workspace_memory` call for the calling agent. The tool must
	 * never leak another workspace: every lookup is filtered by the caller's
	 * `cwd`, and the workspace switch is checked first.
	 */
	const runWorkspaceMemory = async (args = {}, exec = {}) => {
		const sessionQuery = getService("sessionQuery");
		if (sessionQuery === undefined) return "工作区记忆不可用：宿主缺少 sessionQuery 服务。";
		const agent = exec !== null && typeof exec === "object" ? exec.agent : undefined;
		const session = agent !== null && typeof agent === "object" ? agent.session : undefined;
		const cwd = session !== null && typeof session === "object" && session.header !== null && typeof session.header === "object" ? session.header.cwd : undefined;
		if (typeof cwd !== "string" || cwd === "") return "无法确定本会话所属的工作区（会话没有工作目录）。";
		const workspace = findWorkspaceByCwd(cwd);
		if (workspace === undefined || workspace === null || typeof workspace.id !== "string") return "无法确定本会话所属的工作区。";
		const document = await memoryStore.load();
		const workspaceTitle = typeof workspace.title === "string" && workspace.title !== "" ? workspace.title : workspace.id;
		if (document.workspaces[workspace.id] !== true) return `工作区「${workspaceTitle}」没有开启「工作区记忆」。请先在 设置 → 工作区记忆 中打开。`;
		const action = typeof args.action === "string" ? args.action : "list";
		const limit = Number.isInteger(args.limit) ? Math.min(50, Math.max(1, args.limit)) : 10;
		const currentId = typeof session.id === "string" ? session.id : "";

		if (action === "search") {
			const query = typeof args.query === "string" ? args.query.trim() : "";
			if (query === "") return "action=search 需要提供 query。";
			let page;
			try {
				page = await sessionQuery.searchSessions({ query, sessionFilters: [{ kind: "cwd", values: [cwd] }], eventFilters: [] }, { signal: exec.signal });
			} catch (error) {
				return `检索工作区记忆失败：${messageOf(error)}`;
			}
			const hits = Array.isArray(page?.items) ? page.items.filter((hit) => hit !== null && typeof hit === "object" && hit.header?.id !== currentId).slice(0, limit) : [];
			if (hits.length === 0) return "本工作区没有找到匹配的历史会话内容。";
			const titles = await titlesOf(sessionQuery, hits.map((hit) => hit.header.id));
			const lines = [`本工作区「${workspaceTitle}」历史检索「${query}」，${hits.length} 条：`];
			hits.forEach((hit, index) => {
				const header = hit.header ?? {};
				const match = hit.bestMatch ?? {};
				lines.push("", `${index + 1}. ${titles.get(header.id) || "未命名"}（${header.id}）· ${formatTimestamp(header.createdAt)}`, `   命中：seq ${match.seq ?? "?"} · ${match.type ?? "?"}`, `   片段：${String(match.snippet ?? "").slice(0, 600)}`);
			});
			return lines.join("\n");
		}

		if (action === "read") {
			const targetId = typeof args.session_id === "string" ? args.session_id : "";
			if (targetId === "") return "action=read 需要提供 session_id。";
			if (targetId === currentId) return "读取的是当前会话本身，无需工作区记忆。";
			const authorized = await sessionQuery.filterSessions([{ kind: "id", values: [targetId] }, { kind: "cwd", values: [cwd] }]);
			if (!Array.isArray(authorized) || authorized.length === 0) return "该会话不属于本工作区，拒绝读取。";
			let snapshot;
			try {
				snapshot = await sessionQuery.readSession(targetId);
			} catch (error) {
				return `读取会话失败：${messageOf(error)}`;
			}
			const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
			const texts = [];
			for (const event of events) {
				if (event?.type !== "user/message" && event?.type !== "assistant/message") continue;
				const text = collectEventText(event, 700);
				if (text !== "") texts.push(`${event.type === "user/message" ? "用户" : "助手"}：${text}`);
			}
			const joined = texts.slice(-12).join("\n");
			if (joined === "") return "该会话没有可读取的文本内容。";
			const title = (await titlesOf(sessionQuery, [targetId])).get(targetId) || "未命名";
			return `会话「${title}」（${targetId}）最近内容：\n\n${joined.length > 8000 ? joined.slice(0, 8000) + "…" : joined}`;
		}

		let records = [];
		try {
			records = await sessionQuery.filterSessions([{ kind: "cwd", values: [cwd] }]);
		} catch (error) {
			return `读取本工作区会话失败：${messageOf(error)}`;
		}
		const sorted = (Array.isArray(records) ? records : [])
			.filter((record) => record !== null && typeof record === "object" && record.header?.id !== currentId)
			.sort((left, right) => Number(right?.header?.createdAt ?? 0) - Number(left?.header?.createdAt ?? 0))
			.slice(0, limit);
		if (sorted.length === 0) return "本工作区还没有其他会话。";
		const titles = await titlesOf(sessionQuery, sorted.map((record) => record.header.id));
		const lines = [`本工作区「${workspaceTitle}」最近 ${sorted.length} 个会话：`];
		sorted.forEach((record, index) => {
			const header = record.header ?? {};
			lines.push(`${index + 1}. ${titles.get(header.id) || "未命名"}（${header.id}）· ${formatTimestamp(header.createdAt)}`);
		});
		return lines.join("\n");
	};

	return { config, create, move, memoryConfig, memorySet, pendingConfig, pendingAck, observeSessionEvent, runWorkspaceMemory };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Write one JSON response; a committed response is left alone. */
function writeJson(res, status, body) {
	if (res === null || typeof res !== "object" || res.headersSent === true) {
		try {
			res?.destroy?.();
		} catch {
			/* the socket is already gone */
		}
		return;
	}
	try {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
		res.end(JSON.stringify(body));
	} catch {
		try {
			res.destroy?.();
		} catch {
			/* ignore */
		}
	}
}

/** Write the failure envelope for a thrown value. */
function writeFailure(res, error) {
	if (error instanceof WorkspacePlusError) {
		writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
		return;
	}
	writeJson(res, 500, { ok: false, error: { code: "internal", message: messageOf(error) } });
}

/** Parse a bounded JSON body. */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		total += buffer.length;
		if (total > 64 * 1024) throw new WorkspacePlusError("invalid-body", "request body is too large", 400);
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim().length === 0) return {};
	try {
		const parsed = JSON.parse(text);
		return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		throw new WorkspacePlusError("invalid-body", "request body is not valid JSON", 400);
	}
}

/**
 * Build the route handlers around one core (exported for unit tests).
 * @param core - result of {@link createWorkspacePlusCore}.
 * @returns `{ config, create, move }` Node request handlers.
 */
export function createRouteHandlers(core) {
	const config = (req, res) => {
		if (req?.method !== "GET") {
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use GET" } });
			return;
		}
		try {
			writeJson(res, 200, core.config());
		} catch (error) {
			writeFailure(res, error);
		}
	};

	const create = async (req, res) => {
		if (req?.method !== "POST") {
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use POST" } });
			return;
		}
		try {
			const body = await readJsonBody(req);
			writeJson(res, 200, await core.create(body));
		} catch (error) {
			writeFailure(res, error);
		}
	};

	const move = async (req, res) => {
		if (req?.method !== "POST") {
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use POST" } });
			return;
		}
		try {
			const body = await readJsonBody(req);
			writeJson(res, 200, await core.move(body));
		} catch (error) {
			writeFailure(res, error);
		}
	};

	const memory = async (req, res) => {
		try {
			if (req?.method === "GET") {
				writeJson(res, 200, await core.memoryConfig());
				return;
			}
			if (req?.method === "POST") {
				const body = await readJsonBody(req);
				writeJson(res, 200, await core.memorySet(body));
				return;
			}
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use GET or POST" } });
		} catch (error) {
			writeFailure(res, error);
		}
	};

	const pending = async (req, res) => {
		if (req?.method !== "GET") {
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use GET" } });
			return;
		}
		try {
			writeJson(res, 200, core.pendingConfig());
		} catch (error) {
			writeFailure(res, error);
		}
	};

	const ack = async (req, res) => {
		if (req?.method !== "POST") {
			writeJson(res, 405, { ok: false, error: { code: "method-not-allowed", message: "use POST" } });
			return;
		}
		try {
			const body = await readJsonBody(req);
			writeJson(res, 200, await core.pendingAck(body));
		} catch (error) {
			writeFailure(res, error);
		}
	};

	return { config, create, move, memory, pending, ack };
}

// ---------------------------------------------------------------------------
// Cordis plugin entry
// ---------------------------------------------------------------------------

/** Read one optional service from the context. */
function serviceOf(ctx, serviceName) {
	try {
		if (typeof ctx.get === "function") {
			const value = ctx.get(serviceName);
			if (value !== undefined && value !== null) return value;
		}
	} catch {
		/* fall through */
	}
	try {
		return ctx?.[serviceName];
	} catch {
		return undefined;
	}
}

/**
 * Mount the plugin: build the core with the live services and register the
 * three exact routes. The client half drives the renamed "add workspace" flow
 * and the "move session" menu action.
 * @param ctx - Cordis host context.
 */
export function apply(ctx) {
	const webServer = ctx?.webServer;
	const logger = ctx?.logger;
	const core = createWorkspacePlusCore({
		getRegistry: () => serviceOf(ctx, "workspaceRegistry"),
		getService: (serviceName) => serviceOf(ctx, serviceName),
		env: process.env,
		logger
	});
	const mounted = { routes: false, sessionEvents: false, tool: false, errors: [] };

	if (webServer !== undefined && webServer !== null && typeof webServer.register === "function" && typeof ctx?.effect === "function") {
		const handlers = createRouteHandlers(core);
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: CONFIG_PATH,
			handler: handlers.config
		}), "dsh-workspace-plus: config route");
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: CREATE_PATH,
			handler: handlers.create
		}), "dsh-workspace-plus: create route");
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: MOVE_PATH,
			handler: handlers.move
		}), "dsh-workspace-plus: move route");
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: MEMORY_PATH,
			handler: handlers.memory
		}), "dsh-workspace-plus: memory route");
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: PENDING_PATH,
			handler: handlers.pending
		}), "dsh-workspace-plus: memory pending route");
		ctx.effect(() => webServer.register({
			kind: "exact",
			path: ACK_PATH,
			handler: handlers.ack
		}), "dsh-workspace-plus: memory ack route");
		logger?.info?.(`[dsh-workspace-plus] routes mounted (version ${PLUGIN_VERSION})`);
		mounted.routes = true;
	} else {
		mounted.errors.push("webServer unavailable");
		logger?.warn?.("[dsh-workspace-plus] ctx.webServer is unavailable; HTTP routes are not mounted");
	}

	// Automatic continuation: remember compaction summaries and queue a hand-off
	// at the end of the turn when the session's workspace has memory enabled.
	if (typeof ctx?.on === "function") {
		const onSessionEvent = (session, event) => {
			try {
				core.observeSessionEvent(session, event);
			} catch (error) {
				logger?.warn?.(`[dsh-workspace-plus] session-event observer failed: ${messageOf(error)}`);
			}
		};
		try {
			let dispose = null;
			try {
				dispose = ctx.on("session/event", onSessionEvent, { global: true });
			} catch {
				dispose = ctx.on("session/event", onSessionEvent);
			}
			if (typeof dispose !== "function") dispose = () => {};
			if (typeof ctx.effect === "function") ctx.effect(() => dispose, "dsh-workspace-plus: workspace-memory events");
			mounted.sessionEvents = true;
		} catch (error) {
			mounted.errors.push(`session/event: ${messageOf(error)}`);
			logger?.warn?.(`[dsh-workspace-plus] could not observe session events: ${messageOf(error)}`);
		}
	}

	// Model-facing workspace history tool, available to every agent; the core
	// refuses when the caller's workspace switch is off.
	const tools = serviceOf(ctx, "tools");
	if (tools !== undefined && tools !== null && typeof tools.register === "function") {
		try {
			const registerTool = () => tools.register(createWorkspaceMemoryTool(core));
			if (typeof ctx.effect === "function") ctx.effect(registerTool, "dsh-workspace-plus: workspace_memory tool");
			else registerTool();
			logger?.info?.("[dsh-workspace-plus] workspace_memory tool registered");
			mounted.tool = true;
		} catch (error) {
			mounted.errors.push(`workspace_memory tool: ${messageOf(error)}`);
			logger?.warn?.(`[dsh-workspace-plus] workspace_memory tool registration failed: ${messageOf(error)}`);
		}
	} else {
		mounted.errors.push("tools service unavailable");
		logger?.warn?.("[dsh-workspace-plus] ctx.tools is unavailable; workspace_memory tool not registered");
	}

	// A tiny mount report: lets a support session tell "old host half" apart
	// from "new host half that failed to register a piece" without guessing.
	const diagnostics = {
		version: PLUGIN_VERSION,
		mountedAt: new Date().toISOString(),
		routes: mounted.routes,
		sessionEvents: mounted.sessionEvents,
		workspaceMemoryTool: mounted.tool,
		errors: mounted.errors
	};
	try {
		const paths = memoryPaths(process.env);
		void (async () => {
			try {
				await mkdir(paths.root, { recursive: true });
				await writeFile(join(paths.root, "diagnostics.json"), JSON.stringify(diagnostics, null, 2) + "\n", "utf8");
			} catch {
				// diagnostics are best-effort only
			}
		})();
	} catch {
		// a read-only DSH_HOME must not break the plugin mount
	}
}
