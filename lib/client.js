window.__ModuleLoader__.load({
	id: 'dsh-workspace-plus',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ==== Module table externals ==========================================
		var React = require('react');
		var primitives = null;
		try {
			primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		} catch (error) {
			primitives = null;
		}

		// ==== Identity ========================================================
		var PLUGIN_ID = 'dsh-workspace-plus';
		var NS = 'dsh-workspace-plus';
		var CONFIG_PATH = 'api/workspace-plus/config';
		var CREATE_PATH = 'api/workspace-plus/create';
		var MOVE_PATH = 'api/workspace-plus/move-session';
		var MEMORY_PATH = 'api/workspace-plus/memory';
		var PENDING_PATH = 'api/workspace-plus/memory/pending';
		var ACK_PATH = 'api/workspace-plus/memory/ack';
		var SETTINGS_SLOT = 'settings.section';
		var SETTINGS_ENTRY_ID = PLUGIN_ID + '.memory-settings';
		var SETTINGS_ORDER = 55;
		var WATCHER_ENTRY_ID = PLUGIN_ID + '.memory-watch';
		var WATCHER_ORDER = 620;
		var STYLE_MARKER = PLUGIN_ID + '/client.css';
		var OVERLAY_SLOT = 'shell.overlay';
		/** Browser-half version; compared with the Host half's /config report. */
		var CLIENT_VERSION = '0.3.0';
		var MENU_SLOT = 'sidebar.workspaces.session.menu.item';
		var MENU_ENTRY_ID = PLUGIN_ID + '.move-session';
		var MENU_ORDER = 470; // host rows: pin 100 / rename 200 / fork 300 / archive 400 / session-id 450
		var MOVE_OVERLAY_ID = PLUGIN_ID + '.move-overlay';
		var MOVE_OVERLAY_ORDER = 480;

		// ==== Copy ============================================================
		var DICTS = {
			zh: {
				'dialog.title': '新建工作区',
				'dialog.nameLabel': '名称',
				'dialog.namePlaceholder': '例如：数学 / 开发 / 硬件',
				'dialog.baseLabel': '父目录',
				'dialog.baseHint': '工作区会指向这个位置下的同名文件夹；新会话的工作目录就是它。',
				'dialog.preview': '将创建：{path}',
				'dialog.cancel': '取消',
				'dialog.create': '创建',
				'dialog.creating': '正在创建…',
				'dialog.loading': '正在读取默认位置…',
				'dialog.configError': '无法读取默认父目录，请手动填写一个绝对路径',
				'dialog.nameRequired': '请输入名称',
				'dialog.error': '创建失败：{message}',
				'menu.move': '移动到工作区…',
				'move.title': '移动到工作区',
				'move.subtitle': '把「{title}」移动到另一个工作区：会复制完整历史生成新会话，原会话归档隐藏。',
				'move.current': '当前工作区：{title}',
				'move.target': '目标工作区',
				'move.empty': '还没有其他工作区。先用「＋」新建一个工作区，再回来移动。',
				'move.unselected': '请选择目标工作区',
				'move.untitled': '未命名工作区',
				'move.sessionCount': '{count} 个会话',
				'move.cancel': '取消',
				'move.confirm': '移动',
				'move.moving': '正在移动…',
				'move.error': '移动失败：{message}',
				'move.hostOutdated': '移动接口还没加载：插件宿主侧还是旧版本。请重启 DSH（应用菜单或标题栏的「重新启动」）后再试。',
				'memory.section': '工作区记忆',
				'memory.intro': '开启后，本工作区的会话上下文达到上限（DSH 自动压缩）时，本轮结束会自动开一个新会话并带上工作区记忆；新会话可用 workspace_memory 工具查看本工作区其他任务内容。',
				'memory.loading': '正在读取工作区…',
				'memory.empty': '还没有工作区。',
				'memory.on': '已开启',
				'memory.off': '已关闭',
				'memory.error': '读取失败：{message}',
				'memory.toggleError': '切换失败：{message}',
				'memory.handoff': '【工作区记忆续接】上一个会话「{title}」的上下文已达到上限并已自动压缩。请先用 workspace_memory 工具查看本工作区里与该任务相关的历史内容（可先 list，再 search / read），然后继续未完成的工作。\n\n上次压缩摘要（节选）：\n{summary}',
			},
			en: {
				'dialog.title': 'New workspace',
				'dialog.nameLabel': 'Name',
				'dialog.namePlaceholder': 'e.g. Math / Dev / Hardware',
				'dialog.baseLabel': 'Parent directory',
				'dialog.baseHint': 'The workspace points at a folder of this name under the parent directory; new conversations run there.',
				'dialog.preview': 'Will create: {path}',
				'dialog.cancel': 'Cancel',
				'dialog.create': 'Create',
				'dialog.creating': 'Creating…',
				'dialog.loading': 'Reading the default location…',
				'dialog.configError': 'Cannot read the default parent directory; enter an absolute path.',
				'dialog.nameRequired': 'Enter a name',
				'dialog.error': 'Create failed: {message}',
				'menu.move': 'Move to workspace…',
				'move.title': 'Move to workspace',
				'move.subtitle': 'Move “{title}” to another workspace: its full history is copied into a new session and the original is archived.',
				'move.current': 'Current workspace: {title}',
				'move.target': 'Target workspace',
				'move.empty': 'No other workspaces yet. Create one with ＋ first, then come back.',
				'move.unselected': 'Pick a target workspace',
				'move.untitled': 'Untitled workspace',
				'move.sessionCount': '{count} sessions',
				'move.cancel': 'Cancel',
				'move.confirm': 'Move',
				'move.moving': 'Moving…',
				'move.error': 'Move failed: {message}',
				'move.hostOutdated': 'The move endpoint is not loaded yet: the plugin host half is still the old version. Restart DSH and try again.',
				'memory.section': 'Workspace memory',
				'memory.intro': 'When enabled, a conversation in this workspace that hits the context limit (DSH compacts automatically) hands off to a new conversation after the turn ends. The new conversation can inspect this workspace’s other tasks through the workspace_memory tool.',
				'memory.loading': 'Reading workspaces…',
				'memory.empty': 'No workspaces yet.',
				'memory.on': 'On',
				'memory.off': 'Off',
				'memory.error': 'Load failed: {message}',
				'memory.toggleError': 'Toggle failed: {message}',
				'memory.handoff': 'Workspace-memory hand-off: the previous conversation “{title}” reached the context limit and was compacted. Use the workspace_memory tool (list, then search/read) to review this workspace’s related task history, then continue the unfinished work.\n\nLast compaction summary (excerpt):\n{summary}',
			},
		};

		var boundT = null;

		function fallbackLang() {
			try {
				if (typeof navigator !== 'undefined' && navigator && typeof navigator.language === 'string' && /^en/i.test(navigator.language)) return 'en';
			} catch (error) { /* not a page context */ }
			return 'zh';
		}

		function translate(key, params) {
			if (boundT !== null) {
				try {
					var projected = boundT(key, params);
					if (typeof projected === 'string' && projected !== key) return projected;
				} catch (error) { /* fall through */ }
			}
			var dict = DICTS[fallbackLang()] || DICTS.zh;
			var template = dict[key];
			if (typeof template !== 'string') return key;
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/g, function (match, name) {
				return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
			});
		}

		/** Prefer the host-provided translator, falling back to our own table. */
		function seatTranslate(seat) {
			if (typeof seat !== 'function') return translate;
			return function (key, params) {
				try {
					var projected = seat(key, params);
					if (typeof projected === 'string' && projected !== key) return projected;
				} catch (error) { /* fall through */ }
				return translate(key, params);
			};
		}

		function messageOf(reason) {
			if (reason instanceof Error && typeof reason.message === 'string') return reason.message;
			if (reason !== null && typeof reason === 'object' && typeof reason.message === 'string') return reason.message;
			return String(reason);
		}

		// ==== Styles ==========================================================
		var CSS = [
			'.dsh-workspace-plus__backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.45);pointer-events:auto}',
			'.dsh-workspace-plus__card{box-sizing:border-box;width:min(460px,100%);background:var(--dsw-specific-menu,#262626);color:var(--dsw-alias-label-primary,#e6e6e6);border:0.5px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12));border-radius:var(--dsw-radius-lg,12px);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,0.45));padding:20px;font-size:14px;line-height:22px}',
			'.dsh-workspace-plus__title{margin:0 0 14px;font-size:15px;font-weight:500;line-height:22px}',
			'.dsh-workspace-plus__label{display:block;margin:0 0 6px;color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;line-height:18px}',
			'.dsh-workspace-plus__input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;outline:none;margin-bottom:12px}',
			'.dsh-workspace-plus__input:focus{border-color:var(--dsw-alias-state-business-primary,#4c8dff)}',
			'.dsh-workspace-plus__hint{margin:0 0 12px;color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;line-height:18px}',
			'.dsh-workspace-plus__preview{margin:0 0 14px;color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;line-height:18px;word-break:break-all}',
			'.dsh-workspace-plus__error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary,#f85149);font-size:12px;line-height:18px}',
			'.dsh-workspace-plus__footer{display:flex;justify-content:flex-end;gap:8px}',
			'.dsh-workspace-plus__btn{height:32px;min-width:72px;padding:0 14px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16));background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;line-height:30px;cursor:pointer}',
			'.dsh-workspace-plus__btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))}',
			'.dsh-workspace-plus__btn:disabled{opacity:0.55;cursor:default}',
			'.dsh-workspace-plus__btn--primary{background:var(--dsw-alias-button-primary-fill, #4c8dff);border-color:transparent;color:#ffffff}',
			// Endfield theme: the primary action repeats the sidebar 「新会话」 plate — hazard-yellow
			// fill, near-black ink and the same notched corners — instead of the token primary,
			// whose remapped fill made the label invisible on this theme.
			'html[data-dsh-endfield] .dsh-workspace-plus__btn--primary:not(:disabled){background-color:var(--ef-y) !important;color:var(--ef-ink-1000,#070a08) !important;border:0 !important;border-radius:2px !important;font-weight:600;clip-path:polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));box-shadow:0 0 0 1px color-mix(in srgb,var(--ef-y) 40%,transparent), 0 6px 18px color-mix(in srgb,var(--ef-y) 14%,transparent)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__btn--primary:hover:not(:disabled){background-color:var(--ef-y-hi) !important}',
			'html[data-dsh-endfield] .dsh-workspace-plus__btn--primary:disabled{background-color:var(--ef-y) !important;color:var(--ef-ink-1000,#070a08) !important;border:0 !important;border-radius:2px !important;clip-path:polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));opacity:0.4}',
			'.dsh-workspace-plus__list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;margin:0 0 12px}',
			'.dsh-workspace-plus__item{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:34px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.16));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#e6e6e6);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
			'.dsh-workspace-plus__item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))}',
			'.dsh-workspace-plus__item--selected{border-color:var(--dsw-alias-state-business-primary,#4c8dff);background:var(--dsw-alias-interactive-bg-selected, rgba(76,141,255,0.16))}',
			'.dsh-workspace-plus__itemMeta{color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}',
			'.dsh-workspace-plus__current{margin:0 0 10px;color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;line-height:18px}',
			'html[data-dsh-endfield] .dsh-workspace-plus__item{border-radius:2px;border-color:var(--ef-y-20)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__item:hover:not(:disabled){border-color:var(--ef-y-45);background:color-mix(in srgb,var(--ef-y) 7%,transparent)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__item--selected{border-color:var(--ef-y) !important;background:color-mix(in srgb,var(--ef-y) 14%,transparent) !important;color:var(--ef-y)}',
			'.dsh-workspace-plus__memPanel{display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:20px}',
			'.dsh-workspace-plus__memIntro{margin:0 0 8px;color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;line-height:18px}',
			'.dsh-workspace-plus__memRow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.12))}',
			'.dsh-workspace-plus__memRow:last-child{border-bottom:0}',
			'.dsh-workspace-plus__memMeta{display:flex;flex-direction:column;gap:2px;min-width:0}',
			'.dsh-workspace-plus__memName{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-workspace-plus__memPath{color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-workspace-plus__memSide{display:flex;align-items:center;gap:8px;flex:none}',
			'.dsh-workspace-plus__memState{color:var(--dsw-alias-label-secondary, rgba(230,230,230,0.72));font-size:12px;white-space:nowrap}',
			'.dsh-workspace-plus__switch{position:relative;box-sizing:border-box;width:38px;height:20px;padding:0;border:0.5px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.24));border-radius:3px;background:transparent;cursor:pointer}',
			'.dsh-workspace-plus__switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:1px;background:var(--dsw-alias-label-secondary, rgba(230,230,230,0.55));transition:transform 0.16s ease, background-color 0.16s linear}',
			'.dsh-workspace-plus__switch[aria-checked="true"]{border-color:var(--dsw-alias-state-business-primary,#4c8dff);background:rgba(76,141,255,0.18)}',
			'.dsh-workspace-plus__switch[aria-checked="true"]::after{transform:translateX(18px);background:var(--dsw-alias-state-business-primary,#4c8dff)}',
			'.dsh-workspace-plus__switch:disabled{opacity:0.5;cursor:default}',
			'html[data-dsh-endfield] .dsh-workspace-plus__switch{border-radius:2px;border-color:var(--ef-y-20)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__switch[aria-checked="true"]{border-color:var(--ef-y);background:color-mix(in srgb,var(--ef-y) 14%,transparent)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__switch[aria-checked="true"]::after{background:var(--ef-y)}',
			'html[data-dsh-endfield] .dsh-workspace-plus__memRow{border-bottom-color:var(--ef-y-12)}',
		].join('');

		function ensureStyles() {
			if (typeof document === 'undefined' || document === null || typeof document.createElement !== 'function') return function () {};
			var selector = 'style[data-plugin-css="' + STYLE_MARKER + '"]';
			var existing = typeof document.querySelector === 'function' ? document.querySelector(selector) : null;
			if (existing !== null && existing !== undefined) {
				// A plugin row rebuilt by HMR re-runs apply; refresh the sheet in place instead of
				// keeping the stale CSS from the first mount.
				existing.textContent = CSS;
				return function () {};
			}
			var style = document.createElement('style');
			style.setAttribute('data-plugin', PLUGIN_ID);
			style.setAttribute('data-plugin-css', STYLE_MARKER);
			style.textContent = CSS;
			if (document.head && typeof document.head.appendChild === 'function') document.head.appendChild(style);
			return function () {
				if (style.parentNode && typeof style.parentNode.removeChild === 'function') style.parentNode.removeChild(style);
			};
		}

		// ==== HTTP ============================================================
		function readTransport() {
			try {
				if (typeof globalThis !== 'undefined' && globalThis !== null && typeof globalThis.__DSH_TRANSPORT__ === 'object' && globalThis.__DSH_TRANSPORT__ !== null) return globalThis.__DSH_TRANSPORT__;
			} catch (error) { /* not a page context */ }
			return undefined;
		}

		function pageBaseUrl() {
			try {
				if (typeof document !== 'undefined' && document !== null && typeof document.baseURI === 'string' && document.baseURI !== '') return document.baseURI;
			} catch (error) { /* no document */ }
			return '';
		}

		function resolveUrl(path, locationLike, transportLike) {
			var loc = locationLike !== undefined ? locationLike : (typeof location !== 'undefined' ? location : undefined);
			var transport = transportLike !== undefined ? transportLike : readTransport();
			if (pageBaseUrl() !== '') return path;
			var protocol = loc && typeof loc.protocol === 'string' ? loc.protocol : '';
			if (protocol === 'dsh-app:') {
				var base = transport && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : '';
				if (base === '') throw new Error('desktop host address unavailable');
				return new URL(path, base).href;
			}
			return '/' + path;
		}

		function resolveTarget(path) {
			var transport = readTransport();
			if (transport !== undefined && typeof transport.fetch === 'function') {
				return { fetch: function (url, init) { return transport.fetch(url, init); }, url: path };
			}
			var host = typeof globalThis !== 'undefined' && globalThis !== null ? globalThis : undefined;
			var doFetch = host !== undefined && typeof host.fetch === 'function' ? host.fetch : undefined;
			if (typeof doFetch !== 'function') return { fetch: undefined, url: resolveUrl(path, undefined, transport) };
			return {
				// `window.fetch` must keep its host receiver; a bare property call
				// throws "Illegal invocation".
				fetch: function (url, init) { return doFetch.call(host, url, init); },
				url: resolveUrl(path, undefined, transport),
			};
		}

		async function requestJson(path, method, body) {
			var target = resolveTarget(path);
			if (typeof target.fetch !== 'function') throw new Error('fetch is unavailable');
			var init = { method: method, headers: {}, credentials: 'same-origin' };
			if (body !== undefined) {
				init.headers['content-type'] = 'application/json';
				init.body = JSON.stringify(body);
			}
			var response = await target.fetch(target.url, init);
			var payload = null;
			try { payload = await response.json(); } catch (error) { payload = null; }
			if (!response.ok) {
				var httpMessage = payload && payload.error && typeof payload.error.message === 'string' ? payload.error.message : 'HTTP ' + response.status;
				throw new Error(httpMessage);
			}
			if (payload !== null && typeof payload === 'object' && payload.ok === false) {
				throw new Error(payload.error && typeof payload.error.message === 'string' ? payload.error.message : 'request failed');
			}
			return payload;
		}

		// ==== Path preview ====================================================
		/** Show the folder the create request will use, without resolving symlinks. */
		function previewPath(baseDir, name) {
			var base = typeof baseDir === 'string' ? baseDir.trim() : '';
			var folder = typeof name === 'string' ? name.trim() : '';
			if (base === '') return '';
			var separator = /[\\/]$/.test(base) ? '' : '\\';
			return folder === '' ? base + separator : base + separator + folder;
		}

		// ==== Module-scope dialog store =======================================
		/** Root client context captured by apply; the overlay uses its services. */
		var pluginCtx = null;
		var store = {
			open: false,
			name: '',
			baseDir: '',
			loading: false,
			creating: false,
			error: null,
			configError: null,
		};
		var subscribers = new Set();

		function notify() {
			subscribers.forEach(function (listener) {
				try { listener(); } catch (error) { /* one subscriber must not break the rest */ }
			});
		}

		function patch(next) {
			var changed = false;
			Object.keys(next).forEach(function (key) {
				if (store[key] !== next[key]) { store[key] = next[key]; changed = true; }
			});
			if (changed) notify();
		}

		function subscribe(listener) {
			subscribers.add(listener);
			return function () { subscribers.delete(listener); };
		}

		/** Load the default parent directory once per open. */
		function loadConfig() {
			requestJson(CONFIG_PATH, 'GET').then(function (payload) {
				if (store.open !== true) return;
				var baseDir = payload !== null && typeof payload === 'object' && typeof payload.baseDir === 'string' ? payload.baseDir : '';
				patch({ baseDir: baseDir, loading: false, configError: baseDir === '' ? translate('dialog.configError') : null });
			}).catch(function (reason) {
				if (store.open !== true) return;
				patch({ loading: false, configError: translate('dialog.configError') + '（' + messageOf(reason) + '）' });
			});
		}

		/** Open the dialog for one fresh creation. */
		function openDialog() {
			if (store.open === true) return;
			patch({ open: true, name: '', baseDir: '', loading: true, creating: false, error: null, configError: null });
			loadConfig();
		}

		/** Close the dialog (a create in flight keeps it open). */
		function closeDialog() {
			if (store.creating === true) return;
			patch({ open: false });
		}

		// ==== Move-session store ==============================================
		var moveStore = {
			open: false,
			phase: 'idle', // idle | ready | moving
			sessionId: null,
			displayTitle: '',
			currentWorkspaceId: null,
			currentWorkspaceTitle: '',
			targets: [],
			selectedId: null,
			error: null,
			hostWarning: null,
		};
		var moveSubscribers = new Set();

		function moveNotify() {
			moveSubscribers.forEach(function (listener) {
				try { listener(); } catch (error) { /* one subscriber must not break the rest */ }
			});
		}

		function movePatch(next) {
			var changed = false;
			Object.keys(next).forEach(function (key) {
				if (moveStore[key] !== next[key]) { moveStore[key] = next[key]; changed = true; }
			});
			if (changed) moveNotify();
		}

		function moveSubscribe(listener) {
			moveSubscribers.add(listener);
			return function () { moveSubscribers.delete(listener); };
		}

		/** Client workspaces model snapshot, when the host service is present. */
		function workspaceSnapshot() {
			try {
				var service = pluginCtx !== null && typeof pluginCtx.get === 'function' ? pluginCtx.get('workspaces') : undefined;
				var model = service !== null && service !== undefined && service.list !== undefined ? service.list : service;
				if (model !== null && model !== undefined && typeof model.getSnapshot === 'function') return model.getSnapshot();
			} catch (error) { /* services unavailable */ }
			return null;
		}

		function workspaceTitleOf(workspace) {
			if (workspace !== null && workspace !== undefined && typeof workspace.title === 'string' && workspace.title.trim() !== '') return workspace.title;
			return translate('move.untitled');
		}

		/** Open the move dialog for one session row. */
		function openMove(sessionId, displayTitle) {
			if (typeof sessionId !== 'string' || sessionId === '') return;
			var snapshot = workspaceSnapshot();
			var items = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : [];
			var current = null;
			for (var index = 0; index < items.length; index += 1) {
				var candidate = items[index];
				if (candidate !== null && candidate !== undefined && Array.isArray(candidate.sessionIds) && candidate.sessionIds.indexOf(sessionId) !== -1) {
					current = candidate;
					break;
				}
			}
			var targets = [];
			for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
				var workspace = items[itemIndex];
				if (workspace === null || workspace === undefined) continue;
				if (current !== null && workspace.workspaceId === current.workspaceId) continue;
				if (typeof workspace.workspaceId !== 'string' || workspace.workspaceId === '') continue;
				targets.push({
					workspaceId: workspace.workspaceId,
					title: workspaceTitleOf(workspace),
					sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
				});
			}
			movePatch({
				open: true,
				phase: 'ready',
				sessionId: sessionId,
				displayTitle: typeof displayTitle === 'string' ? displayTitle : '',
				currentWorkspaceId: current !== null ? current.workspaceId : null,
				currentWorkspaceTitle: current !== null ? workspaceTitleOf(current) : '',
				targets: targets,
				selectedId: targets.length === 1 ? targets[0].workspaceId : null,
				error: null,
				hostWarning: null,
			});
			// A browser bundle refreshed by HMR can outrun the Host half (the Host
			// plugin module only reloads on a DSH restart), so say so up front
			// instead of failing later with a bare HTTP 404.
			requestJson(CONFIG_PATH, 'GET').then(function (payload) {
				if (moveStore.open !== true) return;
				var hostVersion = payload !== null && typeof payload === 'object' && typeof payload.version === 'string' ? payload.version : null;
				if (hostVersion !== null && hostVersion !== CLIENT_VERSION) movePatch({ hostWarning: translate('move.hostOutdated') });
			}).catch(function () {
				if (moveStore.open !== true) return;
				movePatch({ hostWarning: translate('move.hostOutdated') });
			});
		}

		function closeMove() {
			if (moveStore.phase === 'moving') return;
			movePatch({ open: false, phase: 'idle', error: null });
		}

		function selectMoveTarget(workspaceId) {
			if (moveStore.phase === 'moving') return;
			movePatch({ selectedId: typeof workspaceId === 'string' ? workspaceId : null, error: null });
		}

		/** Refresh the sidebar and open the new session after a successful move. */
		function settleAfterMove(newSessionId) {
			var sessions = null;
			var uiWorkspace = null;
			try { if (pluginCtx !== null && typeof pluginCtx.get === 'function') sessions = pluginCtx.get('sessions'); } catch (error) { sessions = null; }
			try { if (pluginCtx !== null && typeof pluginCtx.get === 'function') uiWorkspace = pluginCtx.get('uiWorkspace'); } catch (error) { uiWorkspace = null; }
			if (sessions !== null && sessions !== undefined && typeof sessions.refresh === 'function') {
				try { sessions.refresh(); } catch (error) { /* belt-and-braces */ }
			}
			if (typeof newSessionId === 'string' && newSessionId !== '' && uiWorkspace !== null && uiWorkspace !== undefined) {
				if (typeof uiWorkspace.openSession === 'function') {
					try { uiWorkspace.openSession(newSessionId); return; } catch (error) { /* fall through */ }
				}
				if (typeof uiWorkspace.clearMain === 'function') {
					try { uiWorkspace.clearMain(); } catch (error) { /* leave the panel as-is */ }
				}
			}
		}

		/** POST one move and settle the UI on success. */
		function confirmMove() {
			if (moveStore.phase !== 'ready') return;
			if (moveStore.sessionId === null) return;
			if (moveStore.selectedId === null) {
				movePatch({ error: translate('move.unselected') });
				return;
			}
			movePatch({ phase: 'moving', error: null });
			requestJson(MOVE_PATH, 'POST', { sessionId: moveStore.sessionId, targetWorkspaceId: moveStore.selectedId }).then(function (payload) {
				var newSessionId = payload !== null && typeof payload === 'object' && typeof payload.newSessionId === 'string' ? payload.newSessionId : null;
				movePatch({ open: false, phase: 'idle' });
				settleAfterMove(newSessionId);
			}).catch(function (reason) {
				var detail = messageOf(reason);
				if (/^HTTP 40[14]/.test(detail) || /^HTTP 40[14]\b/.test(detail)) detail = translate('move.hostOutdated');
				movePatch({ phase: 'ready', error: translate('move.error', { message: detail }) });
			});
		}

		/** The host-side add-workspace button labels we intercept (locale-aware). */
		function addWorkspaceLabels(locale) {
			var labels = [];
			try {
				if (locale !== null && locale !== undefined && typeof locale.bind === 'function') {
					var bound = locale.bind('workspace');
					var projected = bound('workspace.add');
					if (typeof projected === 'string' && projected.length > 0 && projected !== 'workspace.add') labels.push(projected);
				}
			} catch (error) { /* fall through */ }
			labels.push('添加工作区', 'Add workspace');
			return labels;
		}

		/** Whether the click landed on the native "add workspace" trigger. */
		function isAddWorkspaceTrigger(target, labels) {
			var node = target;
			var hops = 0;
			while (node !== null && node !== undefined && hops < 6) {
				if (typeof node.getAttribute === 'function') {
					var label = node.getAttribute('aria-label');
					if (typeof label === 'string' && labels.indexOf(label) !== -1) return node;
				}
				node = node.parentElement;
				hops += 1;
			}
			return null;
		}

		/** Whether a keydown is the add-workspace shortcut (resolved host binding: Ctrl+Alt+O; plain Ctrl+O also accepted). */
		function isAddWorkspaceShortcut(event) {
			if (event === null || event === undefined) return false;
			var key = event.key;
			if (key !== 'o' && key !== 'O') return false;
			return event.ctrlKey === true || event.metaKey === true;
		}

		function installTriggers(ctx) {
			if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return function () {};
			var locale = null;
			try { locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined; } catch (error) { locale = null; }
			var labels = addWorkspaceLabels(locale);

			var onClick = function (event) {
				if (event === null || event === undefined || typeof event.preventDefault !== 'function') return;
				var trigger = isAddWorkspaceTrigger(event.target, labels);
				if (trigger === null) return;
				event.preventDefault();
				event.stopPropagation();
				if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
				openDialog();
			};
			var onKeyDown = function (event) {
				if (!isAddWorkspaceShortcut(event)) return;
				var target = event.target;
				var tag = target !== null && target !== undefined && typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
				if (tag === 'input' || tag === 'textarea' || (target && target.isContentEditable === true)) return;
				if (typeof event.preventDefault === 'function') event.preventDefault();
				event.stopPropagation();
				if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
				openDialog();
			};

			document.addEventListener('click', onClick, true);
			document.addEventListener('keydown', onKeyDown, true);
			return function () {
				document.removeEventListener('click', onClick, true);
				document.removeEventListener('keydown', onKeyDown, true);
			};
		}

		// ==== Overlay component ===============================================
		/** Renders the creation dialog (and its backdrop) while the store is open. */
		function NewWorkspaceOverlay(props) {
			var t = seatTranslate(props.t);
			var versionState = React.useState(0);
			var setVersion = versionState[1];

			React.useEffect(function () {
				return subscribe(function () { setVersion(function (value) { return value + 1; }); });
			}, []);

			React.useEffect(function () {
				if (store.open !== true) return undefined;
				if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return undefined;
				var onKeyDown = function (event) {
					if (event === null || event === undefined) return;
					if (event.key !== 'Escape' && event.key !== 'Esc') return;
					if (store.creating === true) return;
					if (typeof event.preventDefault === 'function') event.preventDefault();
					closeDialog();
				};
				document.addEventListener('keydown', onKeyDown, true);
				return function () { document.removeEventListener('keydown', onKeyDown, true); };
			}, [store.open]);

			if (store.open !== true) return null;

			var ctx = pluginCtx;
			var submit = function () {
				if (store.creating === true) return;
				var name = (store.name || '').trim();
				if (name === '') {
					patch({ error: t('dialog.nameRequired') });
					return;
				}
				if ((store.baseDir || '').trim() === '') {
					patch({ error: t('dialog.configError') });
					return;
				}
				patch({ creating: true, error: null });
				var body = { name: name, baseDir: store.baseDir.trim() };
				requestJson(CREATE_PATH, 'POST', body).then(function (payload) {
					var path = payload !== null && typeof payload === 'object' && typeof payload.path === 'string' ? payload.path : null;
					if (path === null) throw new Error('宿主没有返回路径');
					var workspaces = typeof ctx.get === 'function' ? ctx.get('workspaces') : undefined;
					if (workspaces === undefined || typeof workspaces.create !== 'function') throw new Error('工作区服务不可用');
					return Promise.resolve(workspaces.create({ path: path })).then(function (workspace) {
						var workspaceId = workspace !== null && workspace !== undefined && typeof workspace === 'object' ? workspace.workspaceId : undefined;
						if (workspaceId === undefined) return undefined;
						var uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
						if (uiWorkspace !== undefined && typeof uiWorkspace.startSession === 'function') {
							try { uiWorkspace.startSession(workspaceId, { clearPreviousDraft: false }); } catch (error) { /* workspace exists either way */ }
						}
						return undefined;
					});
				}).then(function () {
					patch({ creating: false, open: false });
				}).catch(function (reason) {
					patch({ creating: false, error: t('dialog.error', { message: messageOf(reason) }) });
				});
			};

			var cancel = function () { closeDialog(); };
			var stopPropagation = function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation(); };
			var onBackdropClick = function (event) { if (event && event.target === event.currentTarget) cancel(); };
			var onNameKeyDown = function (event) {
				if (event && event.key === 'Enter') {
					if (typeof event.preventDefault === 'function') event.preventDefault();
					submit();
				}
			};
			var preview = previewPath(store.baseDir, store.name);
			var createLabel = store.creating === true ? t('dialog.creating') : t('dialog.create');

			return React.createElement('div', { className: 'dsh-workspace-plus__backdrop', onClick: onBackdropClick },
				React.createElement('div', {
					className: 'dsh-workspace-plus__card',
					role: 'dialog',
					'aria-modal': 'true',
					'aria-label': t('dialog.title'),
					onClick: stopPropagation,
				},
				React.createElement('h2', { className: 'dsh-workspace-plus__title' }, t('dialog.title')),
				React.createElement('label', { className: 'dsh-workspace-plus__label', htmlFor: 'dsh-workspace-plus-name' }, t('dialog.nameLabel')),
				React.createElement('input', {
					id: 'dsh-workspace-plus-name',
					className: 'dsh-workspace-plus__input',
					type: 'text',
					value: store.name,
					placeholder: t('dialog.namePlaceholder'),
					autoFocus: true,
					disabled: store.creating,
					onChange: function (event) { patch({ name: event && event.target ? event.target.value : '' }); },
					onKeyDown: onNameKeyDown,
				}),
				React.createElement('label', { className: 'dsh-workspace-plus__label', htmlFor: 'dsh-workspace-plus-base' }, t('dialog.baseLabel')),
				React.createElement('input', {
					id: 'dsh-workspace-plus-base',
					className: 'dsh-workspace-plus__input',
					type: 'text',
					value: store.baseDir,
					disabled: store.creating || store.loading,
					onChange: function (event) { patch({ baseDir: event && event.target ? event.target.value : '' }); },
				}),
				store.loading === true ? React.createElement('p', { className: 'dsh-workspace-plus__hint' }, t('dialog.loading')) : null,
				store.configError !== null ? React.createElement('p', { className: 'dsh-workspace-plus__error', role: 'alert' }, store.configError) : null,
				React.createElement('p', { className: 'dsh-workspace-plus__hint' }, t('dialog.baseHint')),
				preview !== '' ? React.createElement('p', { className: 'dsh-workspace-plus__preview', title: preview }, t('dialog.preview', { path: preview })) : null,
				store.error !== null ? React.createElement('p', { className: 'dsh-workspace-plus__error', role: 'alert' }, store.error) : null,
				React.createElement('div', { className: 'dsh-workspace-plus__footer' },
					React.createElement('button', { type: 'button', className: 'dsh-workspace-plus__btn', disabled: store.creating, onClick: cancel }, t('dialog.cancel')),
					React.createElement('button', { type: 'button', className: 'dsh-workspace-plus__btn dsh-workspace-plus__btn--primary', disabled: store.creating, onClick: submit }, createLabel))));
		}

		// ==== Move-session UI =================================================
		/**
		 * One `sidebar.workspaces.session.menu.item` occurrence: the row that
		 * opens the move dialog for the session whose menu is open.
		 */
		function MoveSessionMenuItem(props) {
			var t = seatTranslate(props.t);
			var menuStateFactory = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState : null;
			var menuState = menuStateFactory !== null ? menuStateFactory() : null;
			var setMenuOpen = menuState !== null && typeof menuState[1] === 'function' ? menuState[1] : null;

			var onSelect = function () {
				if (setMenuOpen !== null) {
					try { setMenuOpen(false); } catch (error) { /* menu already gone */ }
				}
				openMove(props.sessionId, typeof props.displayTitle === 'string' ? props.displayTitle : '');
			};
			var label = t('menu.move');

			if (primitives !== null && typeof primitives.MenuItemButton === 'function') {
				return React.createElement(primitives.MenuItemButton, {
					className: 'dsh-workspace-plus__menuRow',
					onSelect: onSelect,
				}, React.createElement('span', null, label));
			}
			return React.createElement('button', {
				type: 'button',
				role: 'menuitem',
				className: 'dsh-workspace-plus__menuRow',
				style: {
					display: 'flex',
					alignItems: 'center',
					width: '100%',
					boxSizing: 'border-box',
					minHeight: '32px',
					padding: '0 10px',
					border: 0,
					borderRadius: 'var(--dsw-radius-sm, 6px)',
					background: 'transparent',
					color: 'inherit',
					cursor: 'pointer',
					font: 'inherit',
					fontSize: '13px',
					textAlign: 'left',
				},
				onClick: onSelect,
			}, label);
		}

		/** Frame-wide workspace picker for the move action. */
		function MoveSessionDialog(props) {
			var t = seatTranslate(props.t);
			var versionState = React.useState(0);
			var setVersion = versionState[1];

			React.useEffect(function () {
				return moveSubscribe(function () { setVersion(function (value) { return value + 1; }); });
			}, []);

			React.useEffect(function () {
				if (moveStore.open !== true) return undefined;
				if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return undefined;
				var onKeyDown = function (event) {
					if (event === null || event === undefined) return;
					if (event.key !== 'Escape' && event.key !== 'Esc') return;
					if (moveStore.phase === 'moving') return;
					if (typeof event.preventDefault === 'function') event.preventDefault();
					closeMove();
				};
				document.addEventListener('keydown', onKeyDown, true);
				return function () { document.removeEventListener('keydown', onKeyDown, true); };
			}, [moveStore.open]);

			if (moveStore.open !== true) return null;

			var busy = moveStore.phase === 'moving';
			var canMove = busy !== true && moveStore.targets.length > 0 && moveStore.selectedId !== null;
			var moveLabel = busy === true ? t('move.moving') : t('move.confirm');
			var title = moveStore.displayTitle !== '' ? moveStore.displayTitle : t('move.untitled');

			var items = moveStore.targets.map(function (target) {
				var selected = target.workspaceId === moveStore.selectedId;
				return React.createElement('button', {
					key: target.workspaceId,
					type: 'button',
					className: 'dsh-workspace-plus__item' + (selected ? ' dsh-workspace-plus__item--selected' : ''),
					'aria-pressed': selected,
					disabled: busy,
					onClick: function () { selectMoveTarget(target.workspaceId); },
				},
				React.createElement('span', null, target.title),
				React.createElement('span', { className: 'dsh-workspace-plus__itemMeta' }, t('move.sessionCount', { count: target.sessionCount })));
			});

			return React.createElement('div', {
				className: 'dsh-workspace-plus__backdrop',
				onClick: function (event) { if (event && event.target === event.currentTarget) closeMove(); },
			},
			React.createElement('div', {
				className: 'dsh-workspace-plus__card',
				role: 'dialog',
				'aria-modal': 'true',
				'aria-label': t('move.title'),
				onClick: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation(); },
			},
			React.createElement('h2', { className: 'dsh-workspace-plus__title' }, t('move.title')),
			React.createElement('p', { className: 'dsh-workspace-plus__hint' }, t('move.subtitle', { title: title })),
			moveStore.currentWorkspaceTitle !== '' ? React.createElement('p', { className: 'dsh-workspace-plus__current' }, t('move.current', { title: moveStore.currentWorkspaceTitle })) : null,
			moveStore.hostWarning !== null ? React.createElement('p', { className: 'dsh-workspace-plus__error', role: 'alert' }, moveStore.hostWarning) : null,
			React.createElement('p', { className: 'dsh-workspace-plus__label' }, t('move.target')),
			moveStore.targets.length === 0
				? React.createElement('p', { className: 'dsh-workspace-plus__hint' }, t('move.empty'))
				: React.createElement('div', { className: 'dsh-workspace-plus__list' }, items),
			moveStore.error !== null ? React.createElement('p', { className: 'dsh-workspace-plus__error', role: 'alert' }, moveStore.error) : null,
			React.createElement('div', { className: 'dsh-workspace-plus__footer' },
				React.createElement('button', { type: 'button', className: 'dsh-workspace-plus__btn', disabled: busy, onClick: closeMove }, t('move.cancel')),
				React.createElement('button', { type: 'button', className: 'dsh-workspace-plus__btn dsh-workspace-plus__btn--primary', disabled: canMove !== true, onClick: confirmMove }, moveLabel))));
		}

		// ==== Workspace memory UI =============================================
		/**
		 * `settings.section`: one switch per workspace. The host route is the
		 * source of truth (it also feeds the workspace_memory tool), so the panel
		 * reloads its list from the response after every toggle.
		 */
		function WorkspaceMemorySettings(props) {
			var t = seatTranslate(props.t);
			var stateBox = React.useState({ loading: true, error: null, workspaces: [], busyId: null });
			var state = stateBox[0];
			var setState = stateBox[1];

			React.useEffect(function () {
				var cancelled = false;
				requestJson(MEMORY_PATH, 'GET').then(function (payload) {
					if (cancelled) return;
					var workspaces = payload !== null && typeof payload === 'object' && Array.isArray(payload.workspaces) ? payload.workspaces : [];
					setState(function (prev) { return Object.assign({}, prev, { loading: false, error: null, workspaces: workspaces }); });
				}).catch(function (reason) {
					if (cancelled) return;
					setState(function (prev) { return Object.assign({}, prev, { loading: false, error: translate('memory.error', { message: messageOf(reason) }) }); });
				});
				return function () { cancelled = true; };
			}, []);

			var toggle = function (workspace) {
				if (state.busyId !== null) return;
				setState(function (prev) { return Object.assign({}, prev, { busyId: workspace.workspaceId, error: null }); });
				requestJson(MEMORY_PATH, 'POST', { workspaceId: workspace.workspaceId, enabled: workspace.enabled !== true }).then(function (payload) {
					var workspaces = payload !== null && typeof payload === 'object' && Array.isArray(payload.workspaces) ? payload.workspaces : state.workspaces;
					setState(function (prev) { return Object.assign({}, prev, { busyId: null, workspaces: workspaces, error: null }); });
				}).catch(function (reason) {
					setState(function (prev) { return Object.assign({}, prev, { busyId: null, error: translate('memory.toggleError', { message: messageOf(reason) }) }); });
				});
			};

			var rows = state.workspaces.map(function (workspace) {
				var enabled = workspace.enabled === true;
				return React.createElement('div', { key: workspace.workspaceId, className: 'dsh-workspace-plus__memRow' },
					React.createElement('div', { className: 'dsh-workspace-plus__memMeta' },
						React.createElement('span', { className: 'dsh-workspace-plus__memName' }, workspace.title !== undefined && workspace.title !== '' ? workspace.title : '未命名工作区'),
						workspace.path !== undefined && workspace.path !== '' ? React.createElement('span', { className: 'dsh-workspace-plus__memPath' }, workspace.path) : null),
					React.createElement('div', { className: 'dsh-workspace-plus__memSide' },
						React.createElement('span', { className: 'dsh-workspace-plus__memState' }, enabled ? t('memory.on') : t('memory.off')),
						React.createElement('button', {
							type: 'button',
							role: 'switch',
							className: 'dsh-workspace-plus__switch',
							'aria-checked': enabled,
							'aria-label': (workspace.title !== undefined && workspace.title !== '' ? workspace.title : '未命名工作区'),
							disabled: state.busyId === workspace.workspaceId,
							onClick: function () { toggle(workspace); }
						})));
			});

			var body;
			if (state.loading === true) body = React.createElement('p', { className: 'dsh-workspace-plus__memIntro' }, t('memory.loading'));
			else if (state.workspaces.length === 0) body = React.createElement('p', { className: 'dsh-workspace-plus__memIntro' }, t('memory.empty'));
			else body = rows;

			return React.createElement('div', { className: 'dsh-workspace-plus__memPanel' },
				React.createElement('p', { className: 'dsh-workspace-plus__memIntro' }, t('memory.intro')),
				state.error !== null ? React.createElement('p', { className: 'dsh-workspace-plus__error', role: 'alert' }, state.error) : null,
				body);
		}

		// ==== Automatic continuation ==========================================
		var pendingCheckInFlight = false;

		/**
		 * One poll step: if the host queued a compaction hand-off, open a new
		 * conversation in that workspace with a prefilled continuation prompt and
		 * acknowledge it. Failures keep the hand-off for the next tick.
		 * @returns promise resolving when the step finished.
		 */
		async function checkPendingContinuation() {
			if (pendingCheckInFlight === true) return;
			pendingCheckInFlight = true;
			try {
				var payload = await requestJson(PENDING_PATH, 'GET');
				var list = payload !== null && typeof payload === 'object' && Array.isArray(payload.pending) ? payload.pending : [];
				var entry = list[0];
				if (entry === undefined || entry === null) return;
				var uiWorkspace = null;
				try { if (pluginCtx !== null && typeof pluginCtx.get === 'function') uiWorkspace = pluginCtx.get('uiWorkspace'); } catch (error) { uiWorkspace = null; }
				if (uiWorkspace === null || uiWorkspace === undefined || typeof uiWorkspace.startSession !== 'function') return;
				var title = typeof entry.title === 'string' && entry.title !== '' ? entry.title : String(entry.sessionId);
				var summary = typeof entry.summary === 'string' ? entry.summary.slice(0, 1500) : '';
				var prompt = translate('memory.handoff', { title: title, summary: summary });
				uiWorkspace.startSession(entry.workspaceId, { prompt: prompt, clearPreviousDraft: true });
				await requestJson(ACK_PATH, 'POST', { id: entry.id });
			} catch (error) {
				// retry on the next tick; a hand-off is cheap and idempotent on the host side
			} finally {
				pendingCheckInFlight = false;
			}
		}

		/** Renderless `shell.overlay` entry that polls for continuation hand-offs. */
		function MemoryContinuationWatcher() {
			React.useEffect(function () {
				var cancelled = false;
				var timer = null;
				var tick = function () {
					if (cancelled === true) return;
					void checkPendingContinuation();
					if (typeof setTimeout === 'function') timer = setTimeout(tick, 5000);
				};
				tick();
				return function () {
					cancelled = true;
					if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
				};
			}, []);
			return null;
		}

		// ==== Plugin ==========================================================
		/**
		 * Client plugin body. It deliberately does NOT occupy
		 * `sidebar.workspaces.directoryFlow`: the native picker is mounted as a
		 * dynamic Loader entry after the profile bundles, and failing to claim
		 * that single seat makes its activation throw (the whole client boot then
		 * shows "Failed to load plugins"). Instead the dialog intercepts the
		 * native trigger (the ＋ button's aria-label and the Ctrl+O shortcut),
		 * creates the directory through our host route, then creates the
		 * workspace through the regular client services — so the native picker
		 * stays intact for anything else that might use it.
		 */
		function apply(ctx) {
			pluginCtx = ctx;
			var locale = null;
			try { locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined; } catch (error) { locale = null; }
			if (locale && typeof locale.register === 'function') {
				var register = function () { return locale.register(NS, DICTS); };
				if (typeof ctx.effect === 'function') ctx.effect(register, 'dsh-workspace-plus: dictionaries');
				else register();
			}
			if (locale && typeof locale.bind === 'function') {
				try { boundT = locale.bind(NS); } catch (error) { boundT = null; }
			}
			if (typeof ctx.effect === 'function') {
				ctx.effect(function () { return ensureStyles(); }, 'dsh-workspace-plus: styles');
				ctx.effect(function () { return installTriggers(ctx); }, 'dsh-workspace-plus: workspace-add triggers');
			} else {
				ensureStyles();
				installTriggers(ctx);
			}

			ctx.slots.inject(OVERLAY_SLOT, function () {
				return ctx.slots.register({
					name: OVERLAY_SLOT,
					id: PLUGIN_ID + '.overlay',
					locale: NS,
					order: 600,
				}, NewWorkspaceOverlay);
			});

			ctx.slots.inject(MENU_SLOT, function () {
				return ctx.slots.register({
					name: MENU_SLOT,
					id: MENU_ENTRY_ID,
					order: MENU_ORDER,
					locale: NS,
					label: function () { return translate('menu.move'); },
				}, MoveSessionMenuItem);
			});

			ctx.slots.inject(OVERLAY_SLOT, function () {
				return ctx.slots.register({
					name: OVERLAY_SLOT,
					id: MOVE_OVERLAY_ID,
					order: MOVE_OVERLAY_ORDER,
					locale: NS,
				}, MoveSessionDialog);
			});

			ctx.slots.inject(SETTINGS_SLOT, function () {
				return ctx.slots.register({
					name: SETTINGS_SLOT,
					id: SETTINGS_ENTRY_ID,
					order: SETTINGS_ORDER,
					label: function () { return translate('memory.section'); },
					locale: NS,
				}, WorkspaceMemorySettings);
			});

			ctx.slots.inject(OVERLAY_SLOT, function () {
				return ctx.slots.register({
					name: OVERLAY_SLOT,
					id: WATCHER_ENTRY_ID,
					order: WATCHER_ORDER,
					locale: NS,
				}, MemoryContinuationWatcher);
			});
		}

		exports.name = PLUGIN_ID;
		exports.inject = ['slots', 'locale'];
		exports.apply = apply;

		// Test seam (no runtime consumer; cordis ignores extra exports).
		exports.__internal = {
			PLUGIN_ID: PLUGIN_ID,
			NS: NS,
			OVERLAY_SLOT: OVERLAY_SLOT,
			MENU_SLOT: MENU_SLOT,
			MENU_ENTRY_ID: MENU_ENTRY_ID,
			MENU_ORDER: MENU_ORDER,
			MOVE_PATH: MOVE_PATH,
			MOVE_OVERLAY_ID: MOVE_OVERLAY_ID,
			MEMORY_PATH: MEMORY_PATH,
			PENDING_PATH: PENDING_PATH,
			ACK_PATH: ACK_PATH,
			SETTINGS_SLOT: SETTINGS_SLOT,
			SETTINGS_ENTRY_ID: SETTINGS_ENTRY_ID,
			WATCHER_ENTRY_ID: WATCHER_ENTRY_ID,
			WorkspaceMemorySettings: WorkspaceMemorySettings,
			MemoryContinuationWatcher: MemoryContinuationWatcher,
			checkPendingContinuation: checkPendingContinuation,
			CONFIG_PATH: CONFIG_PATH,
			CREATE_PATH: CREATE_PATH,
			DICTS: DICTS,
			CSS: CSS,
			NewWorkspaceOverlay: NewWorkspaceOverlay,
			MoveSessionMenuItem: MoveSessionMenuItem,
			MoveSessionDialog: MoveSessionDialog,
			previewPath: previewPath,
			requestJson: requestJson,
			resolveUrl: resolveUrl,
			translate: translate,
			store: store,
			openDialog: openDialog,
			closeDialog: closeDialog,
			subscribe: subscribe,
			moveStore: moveStore,
			openMove: openMove,
			closeMove: closeMove,
			confirmMove: confirmMove,
			selectMoveTarget: selectMoveTarget,
			moveSubscribe: moveSubscribe,
			workspaceSnapshot: workspaceSnapshot,
			workspaceTitleOf: workspaceTitleOf,
			isAddWorkspaceTrigger: isAddWorkspaceTrigger,
			isAddWorkspaceShortcut: isAddWorkspaceShortcut,
			addWorkspaceLabels: addWorkspaceLabels,
		};

		return module.exports;
	},
});

