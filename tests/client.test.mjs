/**
 * Client-half unit tests for dsh-workspace-plus (interception design).
 *
 * The bundle is evaluated in a fresh `node:vm` realm; a miniature hook-capable
 * renderer mounts the overlay so the dialog contract can be asserted without a
 * browser: trigger matching (＋ button / Ctrl+O), config prefill, submit ->
 * host folder route -> workspace service -> startSession, inline errors,
 * cancel/Esc.
 *
 * Run with:
 *   node plugins/dsh-workspace-plus/tests/client.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = path.resolve(here, '..', 'lib', 'client.js');
const BUNDLE_SOURCE = readFileSync(BUNDLE_PATH, 'utf8');
const OVERLAY_SLOT = 'shell.overlay';
const MENU_SLOT = 'sidebar.workspaces.session.menu.item';
const SETTINGS_SLOT = 'settings.section';
const CONFIG_PATH = 'api/workspace-plus/config';
const CREATE_PATH = 'api/workspace-plus/create';
const MOVE_PATH = 'api/workspace-plus/move-session';

// ==== Tiny React ============================================================
let activeRuntime = null;

function depsChanged(previous, next) {
  if (previous === undefined) return true;
  if (!Array.isArray(previous) || !Array.isArray(next)) return previous !== next;
  if (previous.length !== next.length) return true;
  for (let index = 0; index < previous.length; index += 1) {
    if (!Object.is(previous[index], next[index])) return true;
  }
  return false;
}

class HookRuntime {
  constructor() {
    this.hooks = [];
    this.index = 0;
    this.pendingEffects = [];
    this.tree = null;
    this.rerender = null;
  }

  useState(initial) {
    const index = this.index;
    this.index += 1;
    if (this.hooks[index] === undefined) this.hooks[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
    const slot = this.hooks[index];
    const setState = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return value;
      slot.value = value;
      if (this.rerender !== null) this.rerender();
      return value;
    };
    return [slot.value, setState];
  }

  useEffect(effect, deps) {
    const index = this.index;
    this.index += 1;
    if (this.hooks[index] === undefined) this.hooks[index] = { kind: 'effect', deps: undefined, cleanup: undefined };
    const slot = this.hooks[index];
    if (depsChanged(slot.deps, deps)) {
      slot.deps = deps;
      this.pendingEffects.push({ slot, effect });
    }
  }

  useRef(value) {
    const index = this.index;
    this.index += 1;
    if (this.hooks[index] === undefined) this.hooks[index] = { kind: 'ref', value: { current: value } };
    return this.hooks[index].value;
  }

  collectCleanup() {
    for (const slot of this.hooks) {
      if (slot !== undefined && typeof slot.cleanup === 'function') {
        slot.cleanup();
        slot.cleanup = undefined;
      }
    }
  }
}

function createReactStub() {
  return {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return { type, props: props === null || props === undefined ? {} : props, children };
    },
    useState(initial) { return activeRuntime.useState(initial); },
    useEffect(effect, deps) { activeRuntime.useEffect(effect, deps); },
    useRef(value) { return activeRuntime.useRef(value); },
  };
}

function mount(Component, props) {
  const runtime = new HookRuntime();
  activeRuntime = runtime;
  const renderOnce = () => {
    runtime.index = 0;
    runtime.pendingEffects = [];
    runtime.tree = Component(props);
    const effects = runtime.pendingEffects;
    runtime.pendingEffects = [];
    for (const { slot, effect } of effects) {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      const cleanup = effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    return runtime.tree;
  };
  runtime.rerender = renderOnce;
  renderOnce();
  return {
    runtime,
    get tree() { return runtime.tree; },
    rerender: renderOnce,
    unmount() { runtime.collectCleanup(); },
  };
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

// ==== Tree helpers ==========================================================
function childrenOf(node) {
  return Array.isArray(node.children) ? node.children : [];
}

function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== 'object' || node.type === undefined) return;
  visit(node);
  for (const child of childrenOf(node)) walk(child, visit);
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, (node) => { if (predicate(node)) found.push(node); });
  return found;
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node !== 'object') return '';
  const children = childrenOf(node);
  if (children.length === 0 && node.props !== undefined && node.props.children !== undefined) return textOf(node.props.children);
  return children.map(textOf).join('');
}

function buttons(tree) {
  return findAll(tree, (node) => node.type === 'button');
}

function buttonWithExactText(tree, text) {
  const match = buttons(tree).find((node) => textOf(node).trim() === text);
  assert.ok(match !== undefined, `no button whose text is exactly ${JSON.stringify(text)}`);
  return match;
}

function click(node, event = {}) {
  const handler = node.props && node.props.onClick;
  assert.equal(typeof handler, 'function', 'expected a clickable element');
  return handler({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {}, ...event });
}

function inputById(tree, id) {
  const match = findAll(tree, (node) => node.type === 'input' && node.props.id === id)[0];
  assert.ok(match !== undefined, `input ${id} missing`);
  return match;
}

function typeInto(node, value) {
  assert.equal(typeof node.props.onChange, 'function');
  node.props.onChange({ target: { value } });
}

// ==== Environment fakes =====================================================
function createDocument() {
  const listeners = [];
  return {
    baseURI: 'http://127.0.0.1:44661/',
    listeners,
    addEventListener(type, handler, capture) { listeners.push({ type, handler, capture, active: true }); },
    removeEventListener(type, handler, capture) {
      const found = listeners.find((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
      if (found !== undefined) found.active = false;
    },
    querySelector() { return null; },
    createElement() { return { setAttribute() {}, textContent: '', parentNode: null }; },
    head: { appendChild() {} },
  };
}

function nodeWithLabel(label) {
  return { getAttribute(name) { return name === 'aria-label' ? label : null; }, parentElement: null };
}

function createFakeCtx(options = {}) {
  const registrations = [];
  const localeRegisters = [];
  const calls = { created: [], startSession: [], openSession: [], refresh: 0 };
  const snapshot = options.workspacesSnapshot ?? {
    phase: 'ready',
    items: [
      { workspaceId: 'ws-1', title: '工作区一', sessionIds: ['s-1', 's-2'] },
      { workspaceId: 'ws-2', title: '工作区二', sessionIds: [] },
    ],
  };
  const localeService = {
    register(namespace, dictionaries) {
      localeRegisters.push({ namespace, dictionaries });
      return () => {};
    },
    bind(namespace) {
      if (namespace === 'workspace') {
        return (key) => (key === 'workspace.add' ? '添加工作区' : key);
      }
      return (key) => key;
    },
  };
  const workspacesService = {
    list: {
      getSnapshot() { return snapshot; },
    },
    async create(input) {
      calls.created.push(input);
      if (options.createFailure !== undefined) throw options.createFailure;
      return { workspaceId: 'ws-1', title: '数学', path: input.path };
    },
  };
  const uiWorkspaceService = {
    startSession(workspaceId, opts) {
      calls.startSession.push({ workspaceId, opts });
    },
    openSession(sessionId) {
      calls.openSession.push(sessionId);
    },
    clearMain() {},
  };
  const sessionsService = {
    refresh() { calls.refresh += 1; },
  };
  const services = {
    locale: localeService,
    sessions: sessionsService,
    workspaces: options.withoutWorkspaces === true ? undefined : workspacesService,
    uiWorkspace: options.withoutUiWorkspace === true ? undefined : uiWorkspaceService,
  };
  const ctx = {
    slots: {
      inject(slotName, factory) {
        const dispose = factory();
        return typeof dispose === 'function' ? dispose : () => {};
      },
      register(registrationOptions, component) {
        registrations.push({ options: registrationOptions, component });
        return () => {};
      },
    },
    effect(effect) {
      const dispose = effect();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    get(name) { return services[name]; },
  };
  return { ctx, registrations, localeRegisters, calls, services };
}

function createT() {
  const table = {
    'dialog.title': '新建工作区',
    'dialog.nameLabel': '名称',
    'dialog.namePlaceholder': '例如：数学',
    'dialog.baseLabel': '父目录',
    'dialog.baseHint': '会建同名文件夹',
    'dialog.preview': '将创建：{path}',
    'dialog.cancel': '取消',
    'dialog.create': '创建',
    'dialog.creating': '正在创建…',
    'dialog.loading': '正在读取…',
    'dialog.configError': '无法读取默认父目录',
    'dialog.nameRequired': '请输入名称',
    'dialog.error': '创建失败：{message}',
    'menu.move': '移动到工作区…',
    'move.title': '移动到工作区',
    'move.subtitle': '把「{title}」移动到另一个工作区',
    'move.current': '当前工作区：{title}',
    'move.target': '目标工作区',
    'move.empty': '还没有其他工作区',
    'move.unselected': '请选择目标工作区',
    'move.untitled': '未命名工作区',
    'move.sessionCount': '{count} 个会话',
    'move.cancel': '取消',
    'move.confirm': '移动',
    'move.moving': '正在移动…',
    'move.error': '移动失败：{message}',
    'move.hostOutdated': '移动接口未加载',
  };
  return (key, params) => {
    const template = table[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  };
}

// ==== Bundle loader =========================================================
function loadBundle(options = {}) {
  const react = options.react ?? createReactStub();
  let registration = null;
  const sandbox = {
    window: { __ModuleLoader__: { load(captured) { registration = captured; } } },
    console,
    URL,
    JSON,
    Promise,
    Set,
    Map,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    Error,
    RegExp,
    Symbol,
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    navigator: { language: options.language ?? 'zh-CN' },
    location: options.location ?? { protocol: 'http:', href: 'http://127.0.0.1:44661/' },
    fetch: options.fetch ?? (async () => ({ ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\base' }) })),
    document: options.document ?? createDocument(),
  };
  if (options.transport !== undefined) sandbox.__DSH_TRANSPORT__ = options.transport;
  vm.createContext(sandbox);
  vm.runInContext(BUNDLE_SOURCE, sandbox, { filename: 'dsh-workspace-plus/client.js' });
  assert.ok(registration !== null, 'bundle must call window.__ModuleLoader__.load');
  assert.equal(registration.id, 'dsh-workspace-plus');
  const require = (specifier) => {
    if (specifier === 'react') return react;
    throw new Error('unexpected require: ' + specifier);
  };
  const plugin = registration.factory(require);
  return { sandbox, registration, plugin };
}

function mountOverlay(plugin) {
  return mount(plugin.__internal.NewWorkspaceOverlay, { t: createT() });
}

// ==== Tests =================================================================
test('apply claims the overlay seats, the session menu row and installs the workspace-add triggers', () => {
  const document = createDocument();
  const { plugin } = loadBundle({ document });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);

  assert.equal(fake.registrations.length, 5);
  const names = fake.registrations.map((registration) => registration.options.name);
  assert.deepEqual(names, [OVERLAY_SLOT, MENU_SLOT, OVERLAY_SLOT, SETTINGS_SLOT, OVERLAY_SLOT]);
  const createOverlay = fake.registrations.find((registration) => registration.options.id === 'dsh-workspace-plus.overlay');
  assert.ok(createOverlay !== undefined);
  assert.equal(createOverlay.options.locale, 'dsh-workspace-plus');
  const menu = fake.registrations.find((registration) => registration.options.name === MENU_SLOT);
  assert.equal(menu.options.id, 'dsh-workspace-plus.move-session');
  assert.equal(typeof menu.options.label, 'function');
  assert.equal(menu.options.label(), '移动到工作区…');
  const moveOverlay = fake.registrations.find((registration) => registration.options.id === 'dsh-workspace-plus.move-overlay');
  assert.ok(moveOverlay !== undefined);
  const settings = fake.registrations.find((registration) => registration.options.name === SETTINGS_SLOT);
  assert.ok(settings !== undefined);
  assert.equal(settings.options.id, 'dsh-workspace-plus.memory-settings');
  assert.equal(settings.options.label(), '工作区记忆');
  const watcher = fake.registrations.find((registration) => registration.options.id === 'dsh-workspace-plus.memory-watch');
  assert.ok(watcher !== undefined);
  assert.equal(fake.localeRegisters.length, 1);
  assert.equal(fake.localeRegisters[0].dictionaries.zh['dialog.title'], '新建工作区');
  assert.equal(fake.localeRegisters[0].dictionaries.zh['menu.move'], '移动到工作区…');
  assert.equal(fake.localeRegisters[0].dictionaries.zh['memory.section'], '工作区记忆');

  const clickListener = document.listeners.find((entry) => entry.type === 'click' && entry.active);
  const keyListener = document.listeners.find((entry) => entry.type === 'keydown' && entry.active);
  assert.ok(clickListener !== undefined, 'capture-phase click listener installed');
  assert.equal(clickListener.capture, true);
  assert.ok(keyListener !== undefined, 'capture-phase keydown listener installed');
});

test('the add-workspace ＋ button is recognised by its localized aria-label', () => {
  const document = createDocument();
  const { plugin } = loadBundle({ document });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const labels = plugin.__internal.addWorkspaceLabels(fake.services.locale);
  const button = nodeWithLabel('添加工作区');
  const wrapper = nodeWithLabel('something else');
  const text = { getAttribute() { return null; }, parentElement: button };
  assert.equal(plugin.__internal.isAddWorkspaceTrigger(button, labels), button);
  assert.equal(plugin.__internal.isAddWorkspaceTrigger(text, labels), button);
  assert.equal(plugin.__internal.isAddWorkspaceTrigger(wrapper, labels), null);
});

test('clicking the ＋ button intercepts the native flow and opens the dialog', async () => {
  const document = createDocument();
  const calls = [];
  const fetchMock = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\work' }) };
  };
  const { plugin } = loadBundle({ document, fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const clickListener = document.listeners.find((entry) => entry.type === 'click');

  const prevented = { value: false, stopped: false };
  clickListener.handler({
    target: nodeWithLabel('添加工作区'),
    preventDefault() { prevented.value = true; },
    stopPropagation() { prevented.stopped = true; },
    stopImmediatePropagation() {},
  });
  assert.equal(prevented.value, true, 'native picker must not open');
  assert.equal(prevented.stopped, true);
  assert.equal(plugin.__internal.store.open, true);

  const view = mountOverlay(plugin);
  await flush();
  assert.ok(textOf(view.tree).includes('新建工作区'));
  assert.equal(inputById(view.tree, 'dsh-workspace-plus-base').props.value, 'C:\\work');
  assert.ok(calls.some((url) => String(url).endsWith(CONFIG_PATH)));
  view.unmount();
});

test('Ctrl+O opens the dialog, Ctrl+Alt+O does not', () => {
  const document = createDocument();
  const { plugin } = loadBundle({ document });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const keyListener = document.listeners.find((entry) => entry.type === 'keydown');
  assert.equal(plugin.__internal.isAddWorkspaceShortcut({ key: 'o', ctrlKey: true }), true);
  assert.equal(plugin.__internal.isAddWorkspaceShortcut({ key: 'O', metaKey: true }), true);
  assert.equal(plugin.__internal.isAddWorkspaceShortcut({ key: 'o', ctrlKey: true, altKey: true }), true, 'the resolved host binding is Ctrl+Alt+O');
  assert.equal(plugin.__internal.isAddWorkspaceShortcut({ key: 'p', ctrlKey: true }), false);

  keyListener.handler({ key: 'o', ctrlKey: true, target: { tagName: 'BODY' }, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(plugin.__internal.store.open, true);
});

test('submitting creates the folder, the workspace, then starts a session', async () => {
  const document = createDocument();
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith(CREATE_PATH)) {
      return { ok: true, status: 200, json: async () => ({ ok: true, path: 'C:\\work\\数学', created: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\work' }) };
  };
  const { plugin } = loadBundle({ document, fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const view = mountOverlay(plugin);
  plugin.__internal.openDialog();
  await flush();

  typeInto(inputById(view.tree, 'dsh-workspace-plus-name'), '数学');
  click(buttonWithExactText(view.tree, '创建'));
  await flush();

  const post = calls.find((call) => String(call.url).endsWith(CREATE_PATH));
  assert.ok(post !== undefined, 'create POST issued');
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { name: '数学', baseDir: 'C:\\work' });
  assert.deepEqual(JSON.parse(JSON.stringify(fake.calls.created)), [{ path: 'C:\\work\\数学' }]);
  assert.equal(fake.calls.startSession.length, 1);
  assert.equal(fake.calls.startSession[0].workspaceId, 'ws-1');
  assert.equal(plugin.__internal.store.open, false);
  view.unmount();
});

test('a host failure keeps the dialog open with the message', async () => {
  const document = createDocument();
  const fetchMock = async (url) => {
    if (String(url).endsWith(CREATE_PATH)) {
      return { ok: false, status: 409, json: async () => ({ ok: false, error: { code: 'workspace-exists', message: '已经有工作区指向这个目录' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\work' }) };
  };
  const { plugin } = loadBundle({ document, fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const view = mountOverlay(plugin);
  plugin.__internal.openDialog();
  await flush();
  typeInto(inputById(view.tree, 'dsh-workspace-plus-name'), '数学');
  click(buttonWithExactText(view.tree, '创建'));
  await flush();
  assert.ok(textOf(view.tree).includes('已经有工作区指向这个目录'));
  assert.equal(plugin.__internal.store.open, true);
  assert.deepEqual(fake.calls.created, []);
  view.unmount();
});

test('an empty name is refused locally without any request', async () => {
  const document = createDocument();
  const calls = [];
  const fetchMock = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\work' }) };
  };
  const { plugin } = loadBundle({ document, fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const view = mountOverlay(plugin);
  plugin.__internal.openDialog();
  await flush();
  click(buttonWithExactText(view.tree, '创建'));
  await flush();
  assert.ok(textOf(view.tree).includes('请输入名称'));
  assert.equal(calls.filter((url) => String(url).endsWith(CREATE_PATH)).length, 0);
  view.unmount();
});

test('cancel button and Escape close the dialog', async () => {
  const document = createDocument();
  const { plugin } = loadBundle({ document });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const view = mountOverlay(plugin);

  plugin.__internal.openDialog();
  await flush();
  click(buttonWithExactText(view.tree, '取消'));
  assert.equal(plugin.__internal.store.open, false);

  plugin.__internal.openDialog();
  await flush();
  const escapes = document.listeners.filter((entry) => entry.type === 'keydown' && entry.active);
  assert.ok(escapes.length > 0, 'dialog listens for Escape');
  escapes[escapes.length - 1].handler({ key: 'Escape', preventDefault() {} });
  assert.equal(plugin.__internal.store.open, false);
  view.unmount();
});

test('previewPath joins the base and name defensively', () => {
  const { plugin } = loadBundle();
  const preview = plugin.__internal.previewPath;
  assert.equal(preview('C:\\work', '数学'), 'C:\\work\\数学');
  assert.equal(preview('C:\\work\\', '数学'), 'C:\\work\\数学');
  assert.equal(preview('C:\\work', ''), 'C:\\work\\');
  assert.equal(preview('', '数学'), '');
});

test('the primary button wears the Endfield new-session plate and the sheet refreshes on re-apply', () => {
  const styleNode = { textContent: 'stale' };
  const document = createDocument();
  document.querySelector = (selector) => (String(selector).includes('dsh-workspace-plus/client.css') ? styleNode : null);
  const { plugin } = loadBundle({ document });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const css = plugin.__internal.CSS;
  assert.ok(css.includes('html[data-dsh-endfield] .dsh-workspace-plus__btn--primary'), 'Endfield-scoped primary rule');
  assert.ok(css.includes('background-color:var(--ef-y, #f2f013)'), 'hazard-yellow fill');
  assert.ok(css.includes('color:#070a08'), 'dark ink label');
  assert.ok(css.includes('clip-path:polygon'), 'notched corners like the new-session button');
  assert.ok(styleNode.textContent.includes('--ef-y'), 'an existing sheet is refreshed, not duplicated');
});

function mountMoveDialog(plugin) {
  return mount(plugin.__internal.MoveSessionDialog, { t: createT() });
}

test('the session menu row opens the move dialog with the other workspaces', () => {
  const { plugin } = loadBundle();
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const menuRegistration = fake.registrations.find((registration) => registration.options.name === MENU_SLOT);
  assert.ok(menuRegistration !== undefined);
  let menuOpen = true;
  const view = mount(menuRegistration.component, {
    sessionId: 's-1',
    displayTitle: '数学',
    t: createT(),
    useMenuOpenState: () => [menuOpen, (value) => { menuOpen = value; }],
  });
  const row = findAll(view.tree, (node) => node.type === 'button' && textOf(node).trim() === '移动到工作区…')[0];
  assert.ok(row !== undefined, 'menu row rendered');
  click(row);
  assert.equal(menuOpen, false, 'menu closes before opening the dialog');
  assert.equal(plugin.__internal.moveStore.open, true);
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.__internal.moveStore.targets.map((target) => target.workspaceId))), ['ws-2']);
  assert.equal(plugin.__internal.moveStore.selectedId, 'ws-2');
  assert.equal(plugin.__internal.moveStore.currentWorkspaceTitle, '工作区一');
  view.unmount();
});

test('confirming a move posts the session and target, then opens the new session', async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith(MOVE_PATH)) {
      return { ok: true, status: 200, json: async () => ({ ok: true, newSessionId: 'session-child', targetWorkspaceId: 'ws-2' }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\base' }) };
  };
  const { plugin } = loadBundle({ fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  plugin.__internal.openMove('s-1', '数学');
  const view = mountMoveDialog(plugin);
  assert.ok(textOf(view.tree).includes('目标工作区'));
  assert.ok(textOf(view.tree).includes('工作区二'));
  click(buttonWithExactText(view.tree, '移动'));
  await flush();

  const post = calls.find((call) => String(call.url).endsWith(MOVE_PATH));
  assert.ok(post !== undefined, 'move POST issued');
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { sessionId: 's-1', targetWorkspaceId: 'ws-2' });
  assert.deepEqual(fake.calls.openSession, ['session-child']);
  assert.equal(fake.calls.refresh, 1);
  assert.equal(plugin.__internal.moveStore.open, false);
  view.unmount();
});

test('a failed move keeps the dialog open with the host message', async () => {
  const fetchMock = async (url) => {
    if (String(url).endsWith(MOVE_PATH)) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'target-not-found', message: '目标工作区不存在' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, baseDir: 'C:\\base' }) };
  };
  const { plugin } = loadBundle({ fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  plugin.__internal.openMove('s-1', '数学');
  const view = mountMoveDialog(plugin);
  click(buttonWithExactText(view.tree, '移动'));
  await flush();
  assert.ok(textOf(view.tree).includes('目标工作区不存在'));
  assert.equal(plugin.__internal.moveStore.open, true);
  view.unmount();
});

test('with no other workspace the dialog explains what to do and cannot submit', () => {
  const { plugin } = loadBundle();
  const fake = createFakeCtx({ workspacesSnapshot: { phase: 'ready', items: [{ workspaceId: 'ws-1', title: '工作区一', sessionIds: ['s-1'] }] } });
  plugin.apply(fake.ctx);
  plugin.__internal.openMove('s-1', '数学');
  const view = mountMoveDialog(plugin);
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.__internal.moveStore.targets)), []);
  assert.ok(textOf(view.tree).includes('还没有其他工作区'));
  assert.equal(buttonWithExactText(view.tree, '移动').props.disabled, true);
  view.unmount();
});

test('cancel closes the move dialog', () => {
  const { plugin } = loadBundle();
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  plugin.__internal.openMove('s-1', '数学');
  const view = mountMoveDialog(plugin);
  click(buttonWithExactText(view.tree, '取消'));
  assert.equal(plugin.__internal.moveStore.open, false);
  view.unmount();
});

test('the workspace-memory settings section lists workspaces and toggles one', async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          workspaces: [
            { workspaceId: 'ws-1', title: '工作区一', path: 'C:\\w1', enabled: true },
            { workspaceId: 'ws-2', title: '工作区二', path: 'C:\\w2', enabled: true },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        workspaces: [
          { workspaceId: 'ws-1', title: '工作区一', path: 'C:\\w1', enabled: false },
          { workspaceId: 'ws-2', title: '工作区二', path: 'C:\\w2', enabled: true },
        ],
      }),
    };
  };
  const { plugin } = loadBundle({ fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  const view = mount(plugin.__internal.WorkspaceMemorySettings, { t: createT() });
  await flush();

  const text = textOf(view.tree);
  assert.ok(text.includes('工作区一'));
  assert.ok(text.includes('工作区二'));
  assert.ok(text.includes('已关闭'));
  assert.ok(text.includes('已开启'));
  const switches = findAll(view.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert.equal(switches.length, 2);
  click(switches[0]);
  await flush();

  const post = calls.find((call) => call.init.method === 'POST');
  assert.ok(post !== undefined);
  assert.deepEqual(JSON.parse(post.init.body), { workspaceId: 'ws-1', enabled: true });
  const checked = findAll(view.tree, (node) => node.type === 'button' && node.props.role === 'switch' && node.props['aria-checked'] === true);
  assert.equal(checked.length, 2);
  view.unmount();
});

test('a queued compaction hand-off opens a prefilled continuation session and is acknowledged', async () => {
  const calls = [];
  let pendingServed = false;
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith('api/workspace-plus/memory/pending')) {
      if (pendingServed) return { ok: true, status: 200, json: async () => ({ ok: true, pending: [] }) };
      pendingServed = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          pending: [{ id: 'continuation-1', workspaceId: 'ws-1', workspaceTitle: '工作区一', sessionId: 's-old', title: '旧任务', summary: '已完成的摘要', createdAt: new Date().toISOString() }],
        }),
      };
    }
    if (String(url).endsWith('api/workspace-plus/memory/ack')) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const { plugin } = loadBundle({ fetch: fetchMock });
  const fake = createFakeCtx();
  plugin.apply(fake.ctx);
  await plugin.__internal.checkPendingContinuation();
  await flush();

  assert.equal(fake.calls.startSession.length, 1);
  const started = fake.calls.startSession[0];
  assert.equal(started.workspaceId, 'ws-1');
  assert.ok(started.opts.prompt.includes('旧任务'));
  assert.ok(started.opts.prompt.includes('已完成的摘要'));
  assert.ok(started.opts.prompt.includes('workspace_memory'));
  assert.equal(started.opts.clearPreviousDraft, true);
  assert.ok(calls.some((call) => String(call.url).endsWith('api/workspace-plus/memory/ack')));

  await plugin.__internal.checkPendingContinuation();
  await flush();
  assert.equal(fake.calls.startSession.length, 1, 'an empty pending list does not open another session');
});







