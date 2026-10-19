// selfcheck.mjs — offline harness for clock-perf-widget v2.
//
// There is no jsdom here, so this file carries a minimal DOM stub plus a minimal
// Folium client stub (0.7.20 semantics: the settings handle exposes `params`,
// `params.subscribe(listener)` is the change channel and there is no
// `onChange`), mounts all six stage layers, and asserts the widget's observable
// behavior.
//
// Run with `node .dev/selfcheck.mjs` from the mod root; it exits non-zero if any
// assertion fails.

/* ----------------------------------------------------------------- stubs */

import { readdirSync, readFileSync } from 'node:fs';

const makeStyle = () => {
  const style = {};
  Object.defineProperty(style, 'cssText', {
    set(text) {
      for (const declaration of String(text).split(';')) {
        const split = declaration.indexOf(':');
        if (split < 0) continue;
        const name = declaration.slice(0, split).trim();
        if (!name) continue;
        style[name] = declaration.slice(split + 1).trim();
      }
    },
    get() {
      return '';
    },
  });
  return style;
};

const createNode = (tag) => {
  const listeners = new Map();
  const node = {
    tagName: String(tag).toUpperCase(),
    style: makeStyle(),
    dataset: {},
    textContent: '',
    children: [],
    parentNode: null,
    // Fixed metrics: the harness needs deterministic corner math, not real layout.
    offsetWidth: 180,
    offsetHeight: 132,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = node.children.indexOf(child);
      if (index >= 0) node.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() {
      if (node.parentNode) node.parentNode.removeChild(node);
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    fire(type, event) {
      for (const handler of (listeners.get(type) || []).slice()) handler(event);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  return node;
};

globalThis.document = { createElement: createNode };

const windowListeners = new Map();
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  scrollY: 0,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
  removeEventListener(type, handler) {
    const list = windowListeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  },
  matchMedia: () => ({ matches: false }),
};

const clockwork = { seq: 0, timers: new Map() };
globalThis.setTimeout = (fn, delay) => {
  clockwork.seq += 1;
  clockwork.timers.set(clockwork.seq, { id: clockwork.seq, fn, delay, kind: 'timeout' });
  return clockwork.seq;
};
globalThis.clearTimeout = (id) => {
  clockwork.timers.delete(id);
};
globalThis.setInterval = (fn, delay) => {
  clockwork.seq += 1;
  clockwork.timers.set(clockwork.seq, { id: clockwork.seq, fn, delay, kind: 'interval' });
  return clockwork.seq;
};
globalThis.clearInterval = (id) => {
  clockwork.timers.delete(id);
};

const timersOf = (kind) => [...clockwork.timers.values()].filter((timer) => timer.kind === kind);
const fireIntervals = (delay) => {
  for (const timer of timersOf('interval')) {
    if (delay === undefined || timer.delay === delay) timer.fn();
  }
};
const fireTimeouts = (delay) => {
  for (const timer of timersOf('timeout').slice()) {
    if (delay === undefined || timer.delay === delay) {
      clockwork.timers.delete(timer.id);
      timer.fn();
    }
  }
};

const raf = { queue: [], nextId: 0, cancelled: 0 };
globalThis.requestAnimationFrame = (fn) => {
  raf.nextId += 1;
  raf.queue.push({ id: raf.nextId, fn });
  return raf.nextId;
};
globalThis.cancelAnimationFrame = (id) => {
  raf.cancelled += 1;
  const index = raf.queue.findIndex((entry) => entry.id === id);
  if (index >= 0) raf.queue.splice(index, 1);
};
const frame = (time) => {
  const batch = raf.queue.slice();
  raf.queue.length = 0;
  for (const entry of batch) entry.fn(time);
};

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

/* ------------------------------------------------------------- folium stub */

const makeFolium = () => {
  const state = {
    settingsDefs: [],
    sectionDef: null,
    sectionHandle: null,
    layers: [],
    unregistered: { sections: 0, layers: 0 },
    store: new Map(),
    savedPositions: [],
    rpcCalls: [],
    warnings: [],
    values: {},
    everyCalls: [],
    everyStops: 0,
    themeListeners: [],
    settingsListeners: [],
    frameListeners: [],
    frameStops: 0,
    metrics: {
      totalCpu: 12.34,
      totalMemKb: 2 * 1024 * 1024,
      gpu: {
        utilPct: 14,
        tempC: 45,
        memUsedMb: 5924,
        memTotalMb: 12227,
        powerW: 45.26,
        source: 'nvidia-smi',
      },
      byType: {
        main: { cpu: 1.5, memKb: 200 * 1024 },
        renderer: { cpu: 9.84, memKb: 1.5 * 1024 * 1024 },
        gpu: { cpu: 1, memKb: 300 * 1024 },
      },
    },
  };

  const folium = {
    modId: 'clock-perf-widget',
    log: { info() {}, warn: (...args) => state.warnings.push(args), error() {} },
    registries: {
      settingsSections: {
        register(def) {
          state.sectionDef = def;
          for (const setting of def.settings) {
            state.values[setting.key] = setting.defaultValue;
            state.settingsDefs.push(setting.key);
          }
          const handle = {
            id: def.id,
            // Folia 0.7.20 names the access object `params` and pushes changes
            // through `params.subscribe`; there is no `onChange`.
            params: {
              get: () => ({ ...state.values }),
              set: (patch) => {
                Object.assign(state.values, patch);
                for (const listener of state.settingsListeners.slice()) listener();
              },
              reset: () => {},
              subscribe: (listener) => {
                state.settingsListeners.push(listener);
                return () => {
                  const index = state.settingsListeners.indexOf(listener);
                  if (index >= 0) state.settingsListeners.splice(index, 1);
                };
              },
            },
            unregister: () => {
              state.unregistered.sections += 1;
            },
          };
          state.sectionHandle = handle;
          return handle;
        },
      },
      stageLayers: {
        register(def) {
          state.layers.push(def);
          return {
            id: def.id,
            unregister: () => {
              state.unregistered.layers += 1;
            },
          };
        },
      },
    },
    storage: {
      get: async (key) => (state.store.has(key) ? state.store.get(key) : null),
      set: async (key, value) => {
        state.store.set(key, value);
        state.savedPositions.push({ key, value });
      },
    },
    rpc: {
      call: async (name, ...args) => {
        state.rpcCalls.push({ name, args });
        return state.metrics;
      },
    },
  };

  const makeContext = (options = {}) => {
    const context = {
      every(interval, fn) {
        state.everyCalls.push({ interval, fn });
        return () => {
          state.everyStops += 1;
        };
      },
      onChange(listener) {
        state.themeListeners.push(listener);
        return () => {
          const index = state.themeListeners.indexOf(listener);
          if (index >= 0) state.themeListeners.splice(index, 1);
        };
      },
      getTheme: () => ({ isDaylight: false }),
      isPreview: false,
    };
    if (options.hostFrame) {
      context.onFrame = (listener) => {
        state.frameListeners.push(listener);
        return () => {
          state.frameStops += 1;
          const index = state.frameListeners.indexOf(listener);
          if (index >= 0) state.frameListeners.splice(index, 1);
        };
      };
    }
    return context;
  };

  return { folium, state, makeContext };
};

/* --------------------------------------------------------------- harness */

let passed = 0;
const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log('  ok  ' + label);
    return;
  }
  failures.push(label + (detail === undefined ? '' : ' — ' + detail));
  console.log('FAIL  ' + label + (detail === undefined ? '' : ' — ' + detail));
};

const findByRole = (root, role) => {
  if (!root) return null;
  if (root.dataset && root.dataset.role === role) return root;
  for (const child of root.children) {
    const found = findByRole(child, role);
    if (found) return found;
  }
  return null;
};

const collectRoles = (root, out = []) => {
  if (root.dataset && root.dataset.role) out.push(root.dataset.role);
  for (const child of root.children) collectRoles(child, out);
  return out;
};

const visible = (node) => node !== null && node.style.display !== 'none';

const EXPECTED_KEYS = [
  'placement',
  'clockShow', 'clockStyle', 'clockShowDate', 'clockShowWeekday', 'clock24', 'clockColor', 'cornerClock', 'clockClickThrough',
  'fpsShow', 'fpsShowLabel', 'fpsFontSize', 'fpsValueColor', 'fpsLabelColor', 'cornerFps', 'fpsClickThrough',
  'perfShow', 'showCpu', 'showMemory', 'showGpu', 'showDetails', 'barLayout',
  'colorCpu', 'colorMemory', 'colorGpu', 'perfLabelColor', 'perfValueColor', 'memoryLimitGb', 'refreshMs', 'cornerPerf', 'perfClickThrough',
  'cardBackground', 'cardOpacity', 'backdropOpacity', 'scale',
];

const EXPECTED_SLOTS = [
  'app.overlay', 'player.stage.front',
  'app.overlay', 'player.stage.front',
  'app.overlay', 'player.stage.front',
];

const EXPECTED_LAYER_IDS = [
  'clock-perf-clock-overlay', 'clock-perf-clock-player',
  'clock-perf-fps-overlay', 'clock-perf-fps-player',
  'clock-perf-perf-overlay', 'clock-perf-perf-player',
];

const run = async () => {
  const { folium, state, makeContext } = makeFolium();
  const { default: activate } = await import('../client.mjs');

  /* --------------------------------------------------------- registration */

  const dispose = activate(folium);
  check('settings section registered once', state.sectionDef !== null);
  check(
    'the section names itself with label, the field the mods panel renders',
    state.sectionDef.label && typeof state.sectionDef.label['zh-CN'] === 'string' && typeof state.sectionDef.label.en === 'string',
    JSON.stringify(state.sectionDef.label),
  );
  check('the section carries no title field', state.sectionDef.title === undefined, String(state.sectionDef.title));
  check('settings schema has 35 entries (v2.3.0 drops refreshNow)', state.sectionDef.settings.length === 35, String(state.sectionDef.settings.length));
  check('the dropped one-shot refresh switch is gone', !state.settingsDefs.includes('refreshNow'), state.settingsDefs.join(','));
  check('setting keys and order match the v2 schema', state.settingsDefs.join(',') === EXPECTED_KEYS.join(','), state.settingsDefs.join(','));
  check(
    'every setting carries zh-CN and en labels',
    state.sectionDef.settings.every((s) => s.label && typeof s.label['zh-CN'] === 'string' && typeof s.label.en === 'string'),
  );
  const types = new Set(state.sectionDef.settings.map((s) => s.type));
  check('setting types stay within the three controls the host renders', [...types].every((t) => ['boolean', 'select', 'number'].includes(t)), [...types].join(','));
  check(
    'select settings declare options and a default inside them',
    state.sectionDef.settings.filter((s) => s.type === 'select').every((s) => Array.isArray(s.options) && s.options.some((o) => o.value === s.defaultValue)),
  );
  check(
    'number settings declare min/max/step with the default in range',
    state.sectionDef.settings.filter((s) => s.type === 'number').every((s) => typeof s.min === 'number' && typeof s.max === 'number' && typeof s.step === 'number' && s.defaultValue >= s.min && s.defaultValue <= s.max),
  );
  const colourDefs = ['clockColor', 'fpsValueColor', 'fpsLabelColor', 'colorCpu', 'colorMemory', 'colorGpu', 'perfLabelColor', 'perfValueColor']
    .map((key) => state.sectionDef.settings.find((setting) => setting.key === key));
  check(
    'the eight colour settings are selects over the shared palette',
    colourDefs.every((setting) => setting && setting.type === 'select' && Array.isArray(setting.options) && setting.options.length === 10),
    colourDefs.map((setting) => setting && setting.options && setting.options.length).join(','),
  );
  check(
    'every palette entry is six-digit lowercase hex and the lists agree',
    colourDefs.every((setting) => setting.options.every((option) => /^#[0-9a-f]{6}$/.test(option.value)) && new Set(setting.options.map((option) => option.value)).size === 10)
      && new Set(colourDefs.map((setting) => setting.options.map((option) => option.value).join(','))).size === 1,
  );
  check(
    'every colour setting defaults to a preset in its own list',
    colourDefs.every((setting) => setting.options.some((option) => option.value === setting.defaultValue)),
    colourDefs.map((setting) => setting.defaultValue).join(','),
  );
  check('scale is 0.7–1.6 by 0.05 with default 1', state.values.scale === 1 && state.sectionDef.settings.find((s) => s.key === 'scale').step === 0.05);

  check('six stage layers registered', state.layers.length === 6, String(state.layers.length));
  check('layer ids follow component+slot', state.layers.map((l) => l.id).join(',') === EXPECTED_LAYER_IDS.join(','), state.layers.map((l) => l.id).join(','));
  check('each component registers into both slots in order', state.layers.map((l) => l.slot).join(',') === EXPECTED_SLOTS.join(','), state.layers.map((l) => l.slot).join(','));
  check('the settings handle exposes params', typeof state.sectionHandle.params.get === 'function');
  check('params pushes changes through subscribe', typeof state.sectionHandle.params.subscribe === 'function');
  check('the settings handle has no onChange (0.7.20 parity)', typeof state.sectionHandle.params.onChange === 'undefined');
  check('the settings handle has no `settings` alias in this stub', state.sectionHandle.settings === undefined);

  /* ---------------------------------------------------------------- mount */

  const mounted = [];
  for (const def of state.layers) {
    const component = def.id.split('-')[2];
    const container = createNode('div');
    const ctx = makeContext();
    const destroy = def.mount(container, ctx);
    const card = findByRole(container, 'card-' + component);
    mounted.push({ def, component, container, ctx, destroy, card });
  }
  await flush();

  const layerOf = (component, slot) => mounted.find((m) => m.component === component && m.def.slot === slot);
  const clockOverlay = layerOf('clock', 'app.overlay');
  const clockPlayer = layerOf('clock', 'player.stage.front');
  const fpsOverlay = layerOf('fps', 'app.overlay');
  const fpsPlayer = layerOf('fps', 'player.stage.front');
  const perfOverlay = layerOf('perf', 'app.overlay');
  const perfPlayer = layerOf('perf', 'player.stage.front');

  check('every layer mounted its own card', mounted.every((m) => m.card !== null));
  check('every layer subscribes to params.subscribe once', state.settingsListeners.length === 6, String(state.settingsListeners.length));
  const thousandMsTimers = () => timersOf('interval').filter((timer) => timer.delay === 1000);
  check(
    'the only 1000ms interval is the visible clock tick, not a settings poll',
    thousandMsTimers().length === 1,
    JSON.stringify(thousandMsTimers().map((t) => t.delay)),
  );
  check('component cards carry distinct roles', clockOverlay.card.dataset.role === 'card-clock' && fpsOverlay.card.dataset.role === 'card-fps' && perfOverlay.card.dataset.role === 'card-perf');
  check(
    'cards are fixed positioned with runtime pointer events',
    clockOverlay.card.style.position === 'fixed' && clockOverlay.card.style.pointerEvents === 'auto',
    String(clockOverlay.card.style.pointerEvents),
  );

  const setValues = async (patch) => {
    Object.assign(state.values, patch);
    for (const listener of state.settingsListeners.slice()) listener();
    await flush();
  };
  const tickMetrics = async () => {
    for (const call of state.everyCalls.slice()) call.fn();
    await flush();
  };

  /* ------------------------------------------------------------ placement */

  check(
    'placement=global shows the three overlay cards only',
    visible(clockOverlay.card) && visible(fpsOverlay.card) && visible(perfOverlay.card)
      && !visible(clockPlayer.card) && !visible(fpsPlayer.card) && !visible(perfPlayer.card),
    mounted.map((m) => m.def.id + ':' + m.card.style.display).join(' '),
  );

  await setValues({ placement: 'player' });
  check(
    'placement=player shows the three player cards only',
    !visible(clockOverlay.card) && !visible(fpsOverlay.card) && !visible(perfOverlay.card)
      && visible(clockPlayer.card) && visible(fpsPlayer.card) && visible(perfPlayer.card),
    mounted.map((m) => m.def.id + ':' + m.card.style.display).join(' '),
  );

  await setValues({ placement: 'off' });
  check('placement=off hides all six cards', mounted.every((m) => !visible(m.card)));
  await setValues({ placement: 'global' });

  /* ------------------------------------------------ setting subscription */

  const promptNode = findByRole(clockOverlay.card, 'clock-prompt');
  check('clock starts in the minimal style', !visible(promptNode));
  state.values.clockStyle = 'terminal';
  for (const listener of state.settingsListeners.slice()) listener();
  await flush();
  check('the subscribe callback repaints without any timer firing', visible(promptNode), 'subscribers=' + state.settingsListeners.length);
  check(
    'a settings change never brings a settings poll back',
    thousandMsTimers().length === 1,
    JSON.stringify(thousandMsTimers().map((t) => t.delay)),
  );

  await setValues({ clockShow: false, fpsShow: false, perfShow: false });
  check(
    'with every component off no interval survives, so nothing polls settings',
    timersOf('interval').length === 0,
    JSON.stringify(timersOf('interval').map((t) => t.delay)),
  );
  await setValues({ clockShow: true, fpsShow: true, perfShow: true, clockStyle: 'terminal' });

  /* -------------------------------------------------------- clock styles */

  const SIGNATURE_ROLES = [
    'clock-row-top',
    'clock-main',
    'clock-stack',
    'clock-bottom',
    'clock-prompt',
    'clock-cursor',
  ];
  const styleSignature = (card) =>
    SIGNATURE_ROLES.map((role) => role + ':' + (visible(findByRole(card, role)) ? 'on' : 'off')).join(' ');

  const marks = {};
  for (const style of ['minimal', 'terminal', 'stacked', 'outline']) {
    await setValues({ clockStyle: style });
    marks[style] = {
      signature: styleSignature(clockOverlay.card),
      time: findByRole(clockOverlay.card, 'clock-time').style.fontSize,
      term: findByRole(clockOverlay.card, 'clock-term').style.fontSize,
      stacked: findByRole(clockOverlay.card, 'clock-hours').style.fontSize,
      stroke: findByRole(clockOverlay.card, 'clock-time').style.webkitTextStroke,
      family: clockOverlay.card.style.fontFamily || '',
      ruleWidth: findByRole(clockOverlay.card, 'clock-rule').style.width,
      dateTracking: findByRole(clockOverlay.card, 'clock-date-bottom').style.letterSpacing,
    };
  }

  check(
    'minimal is one row: big time with the date beside it',
    marks.minimal.signature === 'clock-row-top:off clock-main:on clock-stack:off clock-bottom:off clock-prompt:off clock-cursor:off',
    marks.minimal.signature,
  );
  check(
    'terminal is a two-line prompt block with a cursor',
    marks.terminal.signature === 'clock-row-top:on clock-main:on clock-stack:off clock-bottom:off clock-prompt:on clock-cursor:on',
    marks.terminal.signature,
  );
  check(
    'stacked is the hours/rule/minutes column',
    marks.stacked.signature === 'clock-row-top:off clock-main:off clock-stack:on clock-bottom:on clock-prompt:off clock-cursor:off',
    marks.stacked.signature,
  );
  check(
    'outline keeps the centred time over the date row',
    marks.outline.signature === 'clock-row-top:off clock-main:on clock-stack:off clock-bottom:on clock-prompt:off clock-cursor:off',
    marks.outline.signature,
  );
  check('all four clock styles differ structurally', new Set(Object.values(marks).map((m) => m.signature)).size === 4);
  check('the four styles differ on their key declaration', new Set([marks.minimal.time, marks.terminal.term, marks.stacked.stacked, marks.outline.stroke]).size === 4, [marks.minimal.time, marks.terminal.term, marks.stacked.stacked, marks.outline.stroke].join(' | '));
  check('minimal runs the time at 3.2em', marks.minimal.time === '3.2em', marks.minimal.time);
  check('terminal switches the card to a monospace family', /monospace/.test(marks.terminal.family), marks.terminal.family);
  check('stacked runs each digit row at 3em', marks.stacked.stacked === '3em', marks.stacked.stacked);
  check('stacked draws the 2.6em divider', marks.stacked.ruleWidth === '2.6em', marks.stacked.ruleWidth);
  check('stacked tracks the date out to 0.16em', marks.stacked.dateTracking === '0.16em', marks.stacked.dateTracking);
  check('outline strokes the digits', marks.outline.stroke === '1px currentColor', marks.outline.stroke);
  check(
    'stacked splits the digits into hours and minutes',
    findByRole(clockOverlay.card, 'clock-hours').textContent.length === 2 && findByRole(clockOverlay.card, 'clock-minutes').textContent.length === 2,
  );
  check('the big digits use tabular numerals', findByRole(clockOverlay.card, 'clock-time').style['font-variant-numeric'] === 'tabular-nums');

  await setValues({ clockStyle: 'terminal' });
  const cursorNode = findByRole(clockOverlay.card, 'clock-cursor');
  check('terminal ends on a block cursor', cursorNode.textContent === '▌', cursorNode.textContent);
  check('terminal schedules a 500ms blink', timersOf('timeout').some((timer) => timer.delay === 500), JSON.stringify(timersOf('timeout').map((timer) => timer.delay)));
  const litCursor = cursorNode.style.opacity;
  fireTimeouts(500);
  check('a blink flips the cursor', cursorNode.style.opacity !== litCursor, litCursor + ' → ' + cursorNode.style.opacity);
  await setValues({ clockStyle: 'minimal' });
  check('leaving the terminal style clears the blink timer', timersOf('timeout').length === 0, JSON.stringify(timersOf('timeout').map((timer) => timer.delay)));

  /* --------------------------------------------------- clock date fields */

  const roleNode = (role) => findByRole(clockOverlay.card, role);
  const anyVisible = (nodes) => nodes.some((node) => visible(node));
  const suffixNodes = () => [roleNode('clock-suffix'), roleNode('clock-suffix-bottom')];
  const dateNodes = () => ['clock-date-inline', 'clock-date-bottom', 'clock-date-top'].map(roleNode);
  const weekdayNodes = () => ['clock-weekday-inline', 'clock-weekday-bottom', 'clock-weekday-top'].map(roleNode);

  const dateInline = roleNode('clock-date-inline');
  const weekdayInline = roleNode('clock-weekday-inline');
  check('minimal prints month/day beside the time', /\d+月\d+日/.test(dateInline.textContent), dateInline.textContent);
  check('minimal prints the weekday beside the time', /周/.test(weekdayInline.textContent), weekdayInline.textContent);

  await setValues({ clockShowDate: false });
  check('the date switch clears every date node', !anyVisible(dateNodes()) && visible(weekdayInline));
  await setValues({ clockShowWeekday: false });
  check('the weekday switch clears every weekday node', !anyVisible(weekdayNodes()));
  await setValues({ clockShowDate: true, clockShowWeekday: true });
  check('the date and weekday come back', visible(dateInline) && visible(weekdayInline));

  await setValues({ clockStyle: 'terminal' });
  const isoNode = roleNode('clock-date-top');
  check('terminal prints an ISO date on the prompt line', /^\d{4}-\d{2}-\d{2}$/.test(isoNode.textContent), isoNode.textContent);
  check('terminal drops the inline date', !visible(dateInline));
  await setValues({ clockShowDate: false });
  check('the date switch also clears the ISO date', !visible(isoNode));
  await setValues({ clockStyle: 'minimal', clockShowDate: true });

  const timeNode = roleNode('clock-time');
  const suffixNode = roleNode('clock-suffix');
  await setValues({ clock24: false });
  check('12-hour mode appends 上午/下午', visible(suffixNode) && ['上午', '下午'].includes(suffixNode.textContent), suffixNode.textContent);
  check('12-hour mode keeps the hour in 1–12', Number(timeNode.textContent.slice(0, 2)) >= 1 && Number(timeNode.textContent.slice(0, 2)) <= 12, timeNode.textContent);
  await setValues({ clock24: true });
  check('24-hour mode drops the marker', !visible(suffixNode));
  check('24-hour mode keeps the hour in 0–23', Number(timeNode.textContent.slice(0, 2)) >= 0 && Number(timeNode.textContent.slice(0, 2)) <= 23, timeNode.textContent);
  check('the clock text is HH:MM', /^\d{2}:\d{2}$/.test(timeNode.textContent), timeNode.textContent);

  const matrix = [];
  for (const style of ['minimal', 'terminal', 'stacked', 'outline']) {
    await setValues({ clockStyle: style, clock24: false, clockShowDate: true, clockShowWeekday: true });
    matrix.push([style, anyVisible(suffixNodes()), anyVisible(dateNodes()), anyVisible(weekdayNodes())].join(':'));
    await setValues({ clock24: true, clockShowDate: false, clockShowWeekday: false });
    matrix.push([style, anyVisible(suffixNodes()), anyVisible(dateNodes()), anyVisible(weekdayNodes())].join(':'));
  }
  check(
    'the 24h / date / weekday switches hold in all four styles',
    matrix.every((row, index) => row.endsWith(index % 2 === 0 ? ':true:true:true' : ':false:false:false')),
    matrix.join(' | '),
  );
  await setValues({ clockStyle: 'minimal', clock24: true, clockShowDate: true, clockShowWeekday: true });

  /* ---------------------------------------------------------------- FPS */

  const fpsRoles = collectRoles(fpsOverlay.card);
  check('the FPS card has no bar node', fpsRoles.every((role) => !role.includes('bar') && !role.includes('track')), fpsRoles.join(','));
  const fpsValue = findByRole(fpsOverlay.card, 'fps-value');
  const fpsLabel = findByRole(fpsOverlay.card, 'fps-label');
  check(
    'the FPS label and number sit on one baseline row',
    fpsLabel.parentNode === fpsOverlay.card && fpsValue.parentNode === fpsOverlay.card && fpsOverlay.card.style['align-items'] === 'baseline',
    fpsOverlay.card.style['align-items'],
  );
  check('label spacing comes from gap, not margins', fpsOverlay.card.style.gap === '8px' && !fpsValue.style.marginLeft && !fpsLabel.style.marginRight, fpsOverlay.card.style.gap);
  check(
    'the FPS label is small, tracked out and muted',
    fpsLabel.style['font-size'] === '0.72em'
      && fpsLabel.style['letter-spacing'] === '0.18em'
      && fpsLabel.style.opacity === '0.6'
      && fpsLabel.style['font-weight'] === '600',
    fpsLabel.style['font-size'] + '/' + fpsLabel.style['letter-spacing'],
  );
  check(
    'the FPS number is bold on a 1 line box',
    fpsValue.style['font-weight'] === '700' && fpsValue.style['line-height'] === '1',
    fpsValue.style['font-weight'] + '/' + fpsValue.style['line-height'],
  );
  check('FPS is idle before a full second elapses', fpsValue.textContent === '—', fpsValue.textContent);
  frame(1000);
  frame(1500);
  frame(2000);
  check('FPS counts frames once per second', fpsValue.textContent === '3', fpsValue.textContent);
  await setValues({ fpsShowLabel: false });
  check('the FPS label switch hides the caption', !visible(fpsLabel));
  check(
    'the FPS card is content sized, so hiding the label narrows it',
    fpsOverlay.card.style.width === 'auto' && !fpsOverlay.card.style.minWidth,
    fpsOverlay.card.style.width + '/' + fpsOverlay.card.style.minWidth,
  );
  await setValues({ fpsShowLabel: true, fpsFontSize: 48 });
  check('the FPS font size setting drives the card font size', fpsOverlay.card.style.fontSize === '48px', fpsOverlay.card.style.fontSize);
  await setValues({ fpsValueColor: '#ff2d55', fpsLabelColor: '#123456' });
  check('the FPS number colour reaches the value node', fpsValue.style.color === '#ff2d55', fpsValue.style.color);
  check('the FPS label colour reaches the label node', fpsLabel.style.color === '#123456', fpsLabel.style.color);

  /* --------------------------------------------- host frame loop (0.7.20) */

  const hostFrameCtx = makeContext({ hostFrame: true });
  const hostFrameContainer = createNode('div');
  const fpsDef = state.layers.find((layer) => layer.id === 'clock-perf-fps-overlay');
  const hostFrameDestroy = fpsDef.mount(hostFrameContainer, hostFrameCtx);
  const hostFrameCard = findByRole(hostFrameContainer, 'card-fps');
  const queuedBefore = raf.queue.length;
  check(
    'a host frame loop replaces the private rAF loop',
    state.frameListeners.length === 1 && raf.queue.length === queuedBefore,
    'listeners=' + state.frameListeners.length + ' raf=' + raf.queue.length,
  );
  state.frameListeners[0](5000);
  state.frameListeners[0](5500);
  state.frameListeners[0](6000);
  check(
    'the host frame loop drives the FPS counter',
    findByRole(hostFrameCard, 'fps-value').textContent === '3',
    findByRole(hostFrameCard, 'fps-value').textContent,
  );
  hostFrameDestroy();
  check(
    'disposing hands the frame listener back to the host',
    state.frameListeners.length === 0 && state.frameStops === 1,
    'listeners=' + state.frameListeners.length + ' stops=' + state.frameStops,
  );

  /* -------------------------------------------------------- perf metrics */

  await setValues({ fpsFontSize: 26, fpsValueColor: '#5ac8fa', fpsLabelColor: '#9aa4b2' });
  const cpuRow = findByRole(perfOverlay.card, 'row-cpu');
  const memoryRow = findByRole(perfOverlay.card, 'row-memory');
  const gpuRow = findByRole(perfOverlay.card, 'row-gpu');
  check('metrics were fetched through folium.rpc.call', state.rpcCalls.length >= 1 && state.rpcCalls[0].name === 'metrics');
  check(
    'the renderer passes the gpu flag to the main process',
    state.rpcCalls.every((call) => call.args.length === 1 && call.args[0] && call.args[0].gpu === true),
    JSON.stringify(state.rpcCalls[0]),
  );
  check('the metrics loop uses ctx.every at the 1000ms default', state.everyCalls.length >= 1 && state.everyCalls[0].interval === 1000, JSON.stringify(state.everyCalls.map((e) => e.interval)));
  check('the CPU row is named Folia CPU, not whole-machine CPU', findByRole(cpuRow, 'label-cpu').textContent === 'Folia CPU', findByRole(cpuRow, 'label-cpu').textContent);
  check('the memory row is named Folia 内存, not whole-machine memory', findByRole(memoryRow, 'label-memory').textContent === 'Folia 内存', findByRole(memoryRow, 'label-memory').textContent);
  check('CPU row shows the aggregated percentage', findByRole(cpuRow, 'value-cpu').textContent === '12.3%', findByRole(cpuRow, 'value-cpu').textContent);
  check('CPU bar is normalised against 100%', findByRole(cpuRow, 'bar-cpu').style.transform === 'scaleX(0.1234)', findByRole(cpuRow, 'bar-cpu').style.transform);
  check('memory row formats KB as GB', findByRole(memoryRow, 'value-memory').textContent === '2.0 GB', findByRole(memoryRow, 'value-memory').textContent);
  check('memory bar is normalised against the 4GB limit', findByRole(memoryRow, 'bar-memory').style.transform === 'scaleX(0.5000)', findByRole(memoryRow, 'bar-memory').style.transform);

  await setValues({ memoryLimitGb: 8 });
  check('memory bar follows the memory limit', findByRole(memoryRow, 'bar-memory').style.transform === 'scaleX(0.2500)', findByRole(memoryRow, 'bar-memory').style.transform);
  await setValues({ memoryLimitGb: 4 });

  /* ------------------------------------------------------ bar layouts */

  const perfBody = findByRole(perfOverlay.card, 'perf-body');
  const cpuTrack = findByRole(cpuRow, 'track-cpu');
  check(
    'vertical layout stacks the metrics with the bar beside the reading',
    perfBody.style.flexDirection === 'column' && cpuRow.style.flexDirection === 'row' && cpuTrack.parentNode === cpuRow && cpuTrack.style.height === '5px',
    perfBody.style.flexDirection + '/' + cpuRow.style.flexDirection + '/' + cpuTrack.style.height,
  );
  await setValues({ barLayout: 'horizontal' });
  check(
    'horizontal layout puts the three metrics side by side',
    perfBody.style.flexDirection === 'row'
      && cpuRow.parentNode === perfBody
      && memoryRow.parentNode === perfBody
      && gpuRow.parentNode === perfBody
      && cpuRow.style.flex === '1 1 0',
    perfBody.style.flexDirection + '/' + cpuRow.style.flex,
  );
  check(
    'each horizontal metric keeps its own short track under the reading',
    cpuRow.style.flexDirection === 'column'
      && cpuTrack.parentNode === cpuRow
      && cpuTrack.style.width === '100%'
      && cpuTrack.style.maxWidth === '72px'
      && cpuTrack.style.height === '3px'
      && findByRole(memoryRow, 'track-memory').parentNode === memoryRow
      && findByRole(gpuRow, 'track-gpu').parentNode === gpuRow,
    cpuTrack.style.width + '/' + cpuTrack.style.maxWidth + '/' + cpuTrack.style.height,
  );
  check('the horizontal panel is wider than the vertical one', perfOverlay.card.style.width === '288px', perfOverlay.card.style.width);
  await setValues({ barLayout: 'vertical' });
  check(
    'switching back restores the inline bar',
    perfBody.style.flexDirection === 'column' && cpuRow.style.flexDirection === 'row' && cpuTrack.parentNode === cpuRow,
  );
  check('the vertical panel returns to its narrow width', perfOverlay.card.style.width === '214px', perfOverlay.card.style.width);

  /* ----------------------------------------------------- bar colours */

  await setValues({ colorCpu: '#ff0000', colorMemory: '#00ff00', colorGpu: '#0000ff' });
  check(
    'each metric bar takes its own colour setting',
    findByRole(cpuRow, 'bar-cpu').style.backgroundColor === '#ff0000'
      && findByRole(memoryRow, 'bar-memory').style.backgroundColor === '#00ff00'
      && findByRole(gpuRow, 'bar-gpu').style.backgroundColor === '#0000ff',
    [findByRole(cpuRow, 'bar-cpu').style.backgroundColor, findByRole(memoryRow, 'bar-memory').style.backgroundColor, findByRole(gpuRow, 'bar-gpu').style.backgroundColor].join(','),
  );
  await setValues({ perfLabelColor: '#abcdef', perfValueColor: '#fedcba' });
  check(
    'perf label and value colours reach their own nodes',
    findByRole(cpuRow, 'label-cpu').style.color === '#abcdef'
      && findByRole(cpuRow, 'value-cpu').style.color === '#fedcba'
      && findByRole(perfOverlay.card, 'detail-label-main').style.color === '#abcdef'
      && findByRole(perfOverlay.card, 'detail-value-main').style.color === '#fedcba',
    findByRole(cpuRow, 'label-cpu').style.color + '/' + findByRole(cpuRow, 'value-cpu').style.color,
  );
  await setValues({ perfLabelColor: '#9aa4b2', perfValueColor: '#f4f4f6' });
  await setValues({ colorCpu: '#5ac8fa', colorMemory: '#34c759', colorGpu: '#ff9f0a' });

  /* --------------------------------------------------------- GPU source */

  const gpuValue = findByRole(gpuRow, 'value-gpu');
  check('the GPU row keeps the plain GPU name', findByRole(gpuRow, 'label-gpu').textContent === 'GPU', findByRole(gpuRow, 'label-gpu').textContent);
  check('nvidia-smi source shows utilization and temperature', gpuValue.textContent === '14% · 45°C', gpuValue.textContent);
  const sourceNode = findByRole(perfOverlay.card, 'perf-source');
  check('nvidia-smi source line carries VRAM and power', /^nvidia-smi · VRAM 5\.8\/11\.9 GB · 45\.3 W$/.test(sourceNode.textContent), sourceNode.textContent);
  const gpuBar = findByRole(gpuRow, 'bar-gpu');

  state.metrics = { ...state.metrics, gpu: null };
  await tickMetrics();
  check(
    'no nvidia-smi means no GPU reading at all, not a CPU percentage in its place',
    gpuValue.textContent === '—' && gpuBar.style.transform === 'scaleX(0.0000)',
    gpuValue.textContent + '/' + gpuBar.style.transform,
  );
  check(
    'the empty GPU row says what it needs',
    sourceNode.textContent === '无 nvidia-smi · 占用与温度仅支持 NVIDIA 显卡',
    sourceNode.textContent,
  );
  check(
    'the GPU process still reports its own CPU in the details',
    findByRole(perfOverlay.card, 'detail-value-gpu').textContent === '1% · 300.0 MB',
    findByRole(perfOverlay.card, 'detail-value-gpu').textContent,
  );

  state.metrics = {
    ...state.metrics,
    gpu: { utilPct: 14, tempC: 45, memUsedMb: 5924, memTotalMb: 12227, powerW: 45.26, source: 'nvidia-smi' },
  };
  await tickMetrics();
  check('the GPU row comes back when nvidia-smi answers again', gpuValue.textContent === '14% · 45°C', gpuValue.textContent);

  /* ------------------------------------------------------------ details */

  const detailsNode = findByRole(perfOverlay.card, 'perf-details');
  check('per-process details stay collapsed by default', !visible(detailsNode));
  await setValues({ showDetails: true });
  check('the details switch expands the block', visible(detailsNode));
  check('detail rows carry CPU and memory per process', findByRole(perfOverlay.card, 'detail-value-main').textContent === '1.5% · 200.0 MB', findByRole(perfOverlay.card, 'detail-value-main').textContent);
  await setValues({ showDetails: false });

  /* ----------------------------------------------------- metric switches */

  await setValues({ showCpu: false });
  check('the CPU switch hides only the CPU row', !visible(cpuRow) && visible(memoryRow) && visible(gpuRow));
  await setValues({ showCpu: true, showGpu: false });
  check('the GPU switch hides only the GPU row', visible(cpuRow) && !visible(gpuRow));
  await tickMetrics();
  const gpuOffCall = state.rpcCalls[state.rpcCalls.length - 1];
  check(
    'hiding the GPU row tells the main process to skip nvidia-smi',
    gpuOffCall.args.length === 1 && gpuOffCall.args[0].gpu === false,
    JSON.stringify(gpuOffCall),
  );
  await setValues({ showGpu: true });

  /* -------------------------------------------------------------- scale */

  check('the clock card is content sized at scale 1', clockOverlay.card.style.width === 'auto', clockOverlay.card.style.width);
  check('the perf card is 214px wide at scale 1', perfOverlay.card.style.width === '214px', perfOverlay.card.style.width);
  await setValues({ scale: 1.5 });
  check('scale multiplies the perf card width', perfOverlay.card.style.width === '321px', perfOverlay.card.style.width);
  check('scale multiplies the root font size', clockOverlay.card.style.fontSize === '18px', clockOverlay.card.style.fontSize);
  check('scale multiplies the FPS font size', fpsOverlay.card.style.fontSize === '39px', fpsOverlay.card.style.fontSize);
  await setValues({ scale: 0.7 });
  check('scale shrinks the perf card below 1', perfOverlay.card.style.width === '150px', perfOverlay.card.style.width);
  check('scale keeps both content sized cards off fixed widths', clockOverlay.card.style.width === 'auto' && fpsOverlay.card.style.width === 'auto');
  await setValues({ scale: 1 });

  /* ----------------------------------------------------------- backdrop */

  check(
    'default card paints a translucent fill',
    clockOverlay.card.style.backgroundColor === 'rgba(18, 18, 22, 0.550)',
    clockOverlay.card.style.backgroundColor,
  );
  check(
    'default card paints a frosted backdrop',
    clockOverlay.card.style.backdropFilter === 'blur(12.1px) saturate(1.15)',
    clockOverlay.card.style.backdropFilter,
  );
  await setValues({ backdropOpacity: 0.2 });
  check('backdropOpacity drives the blur radius', clockOverlay.card.style.backdropFilter === 'blur(4.4px) saturate(1.15)', clockOverlay.card.style.backdropFilter);
  await setValues({ cardOpacity: 0.2 });
  check('cardOpacity drives the fill alpha', clockOverlay.card.style.backgroundColor === 'rgba(18, 18, 22, 0.200)', clockOverlay.card.style.backgroundColor);
  await setValues({ cardBackground: false });
  check(
    'a backgroundless card drops both the fill and the blur',
    clockOverlay.card.style.backgroundColor === 'transparent' && clockOverlay.card.style.backdropFilter === 'none',
    clockOverlay.card.style.backgroundColor + '/' + clockOverlay.card.style.backdropFilter,
  );
  await setValues({ cardBackground: true, cardOpacity: 0.55, backdropOpacity: 0.55 });
  await setValues({ clockStyle: 'outline' });
  check(
    'the outline style ignores the card fill and the backdrop',
    clockOverlay.card.style.backgroundColor === 'transparent' && clockOverlay.card.style.backdropFilter === 'none',
    clockOverlay.card.style.backgroundColor + '/' + clockOverlay.card.style.backdropFilter,
  );
  await setValues({ clockStyle: 'minimal' });
  check(
    'leaving outline restores the card fill',
    clockOverlay.card.style.backgroundColor === 'rgba(18, 18, 22, 0.550)',
    clockOverlay.card.style.backgroundColor,
  );

  /* ------------------------------------------------------------- dragging */

  const overlayCard = clockOverlay.card;
  check('the clock starts in its own top-left corner, clear of the window buttons', overlayCard.style.transform === 'translate3d(112px, 16px, 0)', overlayCard.style.transform);
  check('the FPS card starts in the bottom-left corner', fpsOverlay.card.style.transform === 'translate3d(16px, 652px, 0)', fpsOverlay.card.style.transform);
  check('the perf card starts in the bottom-right corner, clear of the window controls', perfOverlay.card.style.transform === 'translate3d(1084px, 652px, 0)', perfOverlay.card.style.transform);
  check('cards are draggable', overlayCard.listenerCount('pointerdown') === 1 && overlayCard.listenerCount('pointermove') === 1 && overlayCard.listenerCount('pointerup') === 1);

  const down = { button: 0, target: overlayCard, clientX: 100, clientY: 100, pointerId: 7, prevented: false };
  down.preventDefault = () => {
    down.prevented = true;
  };
  overlayCard.fire('pointerdown', down);
  check('pointerdown is taken over from the host', down.prevented && overlayCard.style.cursor === 'grabbing');
  overlayCard.fire('pointermove', { pointerId: 7, clientX: 150, clientY: 130 });
  check('pointermove translates the card', overlayCard.style.transform === 'translate3d(162px, 46px, 0)', overlayCard.style.transform);
  overlayCard.fire('pointermove', { pointerId: 99, clientX: 900, clientY: 700 });
  check('a foreign pointer id is ignored', overlayCard.style.transform === 'translate3d(162px, 46px, 0)', overlayCard.style.transform);
  overlayCard.fire('pointerup', { pointerId: 7 });
  check('pointerup ends the drag and restores the cursor', overlayCard.style.cursor === 'grab');
  const savedClock = state.store.get('pos-clock-v2');
  check(
    'the clock position is stored as a viewport ratio under its own key',
    savedClock && Math.abs(savedClock.rx - 162 / 1280) < 1e-9 && Math.abs(savedClock.ry - 46 / 800) < 1e-9,
    JSON.stringify(savedClock),
  );
  check('each component keeps its own storage key', state.savedPositions.every((entry) => ['pos-clock-v2', 'pos-fps-v2', 'pos-perf-v2'].includes(entry.key)), JSON.stringify(state.savedPositions.map((e) => e.key)));

  overlayCard.fire('dblclick', {});
  check('double-click returns the card to its corner', overlayCard.style.transform === 'translate3d(112px, 16px, 0)', overlayCard.style.transform);

  /* The FPS card is dragged independently and must not move the clock. */
  const fpsDown = { button: 0, target: fpsOverlay.card, clientX: 1000, clientY: 700, pointerId: 3, preventDefault() {} };
  fpsOverlay.card.fire('pointerdown', fpsDown);
  fpsOverlay.card.fire('pointermove', { pointerId: 3, clientX: 1000, clientY: 600 });
  fpsOverlay.card.fire('pointerup', { pointerId: 3 });
  check('dragging the FPS card leaves the clock alone', overlayCard.style.transform === 'translate3d(112px, 16px, 0)');
  check('the FPS card moved', fpsOverlay.card.style.transform === 'translate3d(16px, 552px, 0)', fpsOverlay.card.style.transform);
  check('the FPS card stored its own ratio', state.store.has('pos-fps-v2'));

  /* -------------------------------------------------------------- resize */

  window.innerWidth = 900;
  window.innerHeight = 600;
  for (const handler of (windowListeners.get('resize') || []).slice()) handler();
  check('resize keeps the clock anchored by its ratio', overlayCard.style.transform === 'translate3d(79px, 16px, 0)', overlayCard.style.transform);
  window.innerWidth = 1280;
  window.innerHeight = 800;
  for (const handler of (windowListeners.get('resize') || []).slice()) handler();

  overlayCard.fire('dblclick', {});
  const ratioX = 500 / 1280;
  const ratioY = 400 / 800;
  overlayCard.fire('pointerdown', { button: 0, target: overlayCard, clientX: 100, clientY: 100, pointerId: 11, preventDefault() {} });
  overlayCard.fire('pointermove', { pointerId: 11, clientX: 584, clientY: 484 });
  overlayCard.fire('pointerup', { pointerId: 11 });
  check('the drag lands on the requested point', overlayCard.style.transform === 'translate3d(596px, 400px, 0)', overlayCard.style.transform);
  window.innerWidth = 900;
  window.innerHeight = 600;
  for (const handler of (windowListeners.get('resize') || []).slice()) handler();
  check(
    'resize re-derives the position from the ratio',
    overlayCard.style.transform === 'translate3d(419px, 300px, 0)',
    overlayCard.style.transform + ' (ratio ' + ratioX.toFixed(4) + '/' + ratioY.toFixed(4) + ')',
  );
  window.innerWidth = 1280;
  window.innerHeight = 800;
  for (const handler of (windowListeners.get('resize') || []).slice()) handler();

  /* --------------------------------------------- corner setting wins (v2.1.1) */

  const cornerCoords = {
    'top-left': 'translate3d(112px, 16px, 0)',
    'top-right': 'translate3d(1084px, 16px, 0)',
    'bottom-left': 'translate3d(112px, 652px, 0)',
    'bottom-right': 'translate3d(1084px, 652px, 0)',
  };
  await setValues({ cornerClock: 'bottom-right' });
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    await setValues({ cornerClock: corner });
    check(
      'changing the corner to ' + corner + ' moves the card there on the next poll',
      overlayCard.style.transform === cornerCoords[corner],
      overlayCard.style.transform,
    );
  }

  await setValues({ cornerClock: 'top-left' });
  overlayCard.fire('pointerdown', { button: 0, target: overlayCard, clientX: 100, clientY: 100, pointerId: 21, preventDefault() {} });
  overlayCard.fire('pointermove', { pointerId: 21, clientX: 400, clientY: 300 });
  overlayCard.fire('pointerup', { pointerId: 21 });
  const draggedTransform = overlayCard.style.transform;
  await setValues({ clockColor: '#ffffff' });
  check(
    'a poll that leaves the corner alone keeps the dragged position',
    overlayCard.style.transform === draggedTransform && draggedTransform !== cornerCoords['top-left'],
    overlayCard.style.transform + ' vs ' + draggedTransform,
  );
  await setValues({ cornerClock: 'bottom-right' });
  check(
    'a corner change overrides a dragged position',
    overlayCard.style.transform === cornerCoords['bottom-right'],
    overlayCard.style.transform,
  );

  overlayCard.fire('pointerdown', { button: 0, target: overlayCard, clientX: 200, clientY: 200, pointerId: 22, preventDefault() {} });
  overlayCard.fire('pointermove', { pointerId: 22, clientX: 300, clientY: 260 });
  overlayCard.fire('pointerup', { pointerId: 22 });
  await setValues({ scale: 1.5 });
  check(
    'a scale change re-snaps the card to its current corner',
    overlayCard.style.transform === cornerCoords['bottom-right'],
    overlayCard.style.transform,
  );
  await setValues({ scale: 1 });

  /* ---------------------------------------------------- click-through */

  const writesBefore = state.savedPositions.length;
  await setValues({ clockClickThrough: true });
  check('click-through sets pointer-events none on the card', overlayCard.style.pointerEvents === 'none', String(overlayCard.style.pointerEvents));
  check('click-through drops the grab cursor', overlayCard.style.cursor === 'default', String(overlayCard.style.cursor));
  overlayCard.fire('pointerdown', { button: 0, target: overlayCard, clientX: 100, clientY: 100, pointerId: 31, preventDefault() {} });
  overlayCard.fire('pointermove', { pointerId: 31, clientX: 500, clientY: 400 });
  overlayCard.fire('pointerup', { pointerId: 31 });
  check(
    'a click-through pointerdown does not drag the card',
    overlayCard.style.transform === cornerCoords['bottom-right'],
    overlayCard.style.transform,
  );
  check(
    'a click-through drag writes nothing to storage',
    state.savedPositions.length === writesBefore,
    JSON.stringify(state.savedPositions.slice(writesBefore)),
  );
  await setValues({ clockClickThrough: false });
  check('turning click-through off restores pointer-events auto', overlayCard.style.pointerEvents === 'auto', String(overlayCard.style.pointerEvents));
  check('turning click-through off restores the grab cursor', overlayCard.style.cursor === 'grab', String(overlayCard.style.cursor));

  /* ----------------------------------------------------------------- defaults */

  const defaults = Object.create(null);
  for (const entry of state.sectionDef.settings) defaults[entry.key] = entry.defaultValue;
  check(
    'the default corners leave the window controls alone',
    defaults.cornerClock === 'top-left' && defaults.cornerFps === 'bottom-left' && defaults.cornerPerf === 'bottom-right',
    JSON.stringify({ clock: defaults.cornerClock, fps: defaults.cornerFps, perf: defaults.cornerPerf }),
  );
  check(
    'click-through ships off for all three components',
    defaults.clockClickThrough === false && defaults.fpsClickThrough === false && defaults.perfClickThrough === false,
    JSON.stringify([defaults.clockClickThrough, defaults.fpsClickThrough, defaults.perfClickThrough]),
  );

  /* -------------------------------------------------- per-component off */

  await setValues({ clockStyle: 'terminal' });
  check('the visible terminal style keeps a blink timer', timersOf('timeout').some((t) => t.delay === 500), JSON.stringify(timersOf('timeout').map((t) => t.delay)));
  await setValues({ clockShow: false });
  check(
    'the clock switch hides both clock layers only',
    !visible(clockOverlay.card) && !visible(clockPlayer.card) && visible(fpsOverlay.card) && visible(perfOverlay.card),
    mounted.map((m) => m.def.id + ':' + m.card.style.display).join(' '),
  );
  check(
    'a hidden clock stops its blink timer',
    timersOf('timeout').length === 0 && !timersOf('interval').some((t) => t.delay > 1000),
    JSON.stringify(timersOf('timeout').map((t) => t.delay)),
  );
  await setValues({ clockShow: true, clockStyle: 'minimal' });
  check('re-enabling the clock brings it back', visible(clockOverlay.card));

  const cancelledBefore = raf.cancelled;
  await setValues({ fpsShow: false });
  check('the FPS switch hides both FPS layers', !visible(fpsOverlay.card) && !visible(fpsPlayer.card) && visible(clockOverlay.card));
  check('hiding FPS cancels the frame loop', raf.cancelled > cancelledBefore, String(raf.cancelled - cancelledBefore));
  await setValues({ fpsShow: true });

  const stopsBefore = state.everyStops;
  await setValues({ perfShow: false });
  check('the perf switch hides both perf layers', !visible(perfOverlay.card) && !visible(perfPlayer.card) && visible(clockOverlay.card));
  check('hiding the panel stops the metrics loop', state.everyStops > stopsBefore, String(state.everyStops - stopsBefore));
  await setValues({ perfShow: true });

  /* ------------------------------------------------- distribution hygiene */

  const modRoot = new URL('../', import.meta.url);
  const rootEntries = readdirSync(modRoot);
  check(
    'development files live under .dev/ so the market never signs them',
    rootEntries.includes('.dev') && !rootEntries.includes('selfcheck.mjs') && !rootEntries.includes('preview.html'),
    rootEntries.join(','),
  );
  check(
    'the dev harness and its preview page both sit in .dev/',
    readdirSync(new URL('.', import.meta.url)).sort().join(',') === 'preview.html,selfcheck.mjs',
    readdirSync(new URL('.', import.meta.url)).join(','),
  );
  check('preview.png stays in the root for the manifest preview field', rootEntries.includes('preview.png'));
  const runtimeSources = ['client.mjs', 'main.cjs'].map((name) => readFileSync(new URL(name, modRoot), 'utf8'));
  check(
    'no runtime file references the dev files',
    runtimeSources.every((text) => !text.includes('selfcheck.mjs') && !text.includes('preview.html')),
  );
  check(
    'the refreshNow switch left no trace in the runtime',
    runtimeSources.every((text) => !text.includes('refreshNow')),
  );

  /* ------------------------------------------------------------ teardown */

  for (const item of mounted) item.destroy();
  check('disposing a layer removes its card', mounted.every((m) => m.container.children.length === 0));
  check('disposing a layer drops its listeners', overlayCard.listenerCount('pointerdown') === 0 && overlayCard.listenerCount('dblclick') === 0);
  check('disposing every layer clears the poll timers', timersOf('interval').length === 0, JSON.stringify(timersOf('interval').map((t) => t.delay)));

  dispose();
  check('the module disposer unregisters six layers and the section', state.unregistered.layers === 6 && state.unregistered.sections === 1, JSON.stringify(state.unregistered));
  check('no warnings were logged', state.warnings.length === 0, JSON.stringify(state.warnings));
};

run().then(() => {
  console.log('\n' + passed + ' assertions passed, ' + failures.length + ' failed');
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
