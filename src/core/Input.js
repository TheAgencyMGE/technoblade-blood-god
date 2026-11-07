// Input — keyboard/mouse state, pointer lock, and a short action buffer so that
// presses made slightly early (during recovery frames) still register: essential
// for free-flow combat that feels responsive.
// Per-mode default bindings (each action -> list of KeyboardEvent.code). Rebindable.
export const DEFAULT_BINDINGS = {
  arkham: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'], dodge: ['Space'], jump: ['KeyC', 'ControlLeft'], counter: ['KeyF'],
    heavy: ['KeyE'], launch: ['KeyV'], ultimate: ['KeyQ'], finisher: ['KeyX'], lock: ['Tab', 'KeyT'],
    ab1: ['Digit1'], ab2: ['Digit2'], ab3: ['Digit3'], ab4: ['Digit4'], pause: ['Escape', 'KeyP'],
  },
  parkour: {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], slide: ['ControlLeft', 'KeyV'], slam: ['KeyQ'], dash: ['KeyE'],
    special: ['KeyF'], view: ['KeyC'], lock: ['Tab'], pause: ['Escape', 'KeyP'],
  },
};
export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', sprint: 'Sprint', dodge: 'Dodge', jump: 'Jump',
  counter: 'Counter', heavy: 'Heavy attack', launch: 'Launcher', ultimate: 'Blood God', finisher: 'Finisher', lock: 'Lock on',
  ab1: 'Critical Strike', ab2: 'Sword Slam', ab3: 'Whirlwind', ab4: 'Precision Shot', pause: 'Pause',
  slide: 'Slide', slam: 'Sword slam', dash: 'Dash', special: 'Special (Blood God)', view: 'Toggle 1st / 3rd person',
};
const clone = (o) => JSON.parse(JSON.stringify(o));
function loadBindings() {
  try { const s = JSON.parse(localStorage.getItem('tbg-bindings') || 'null'); if (s) return { arkham: { ...DEFAULT_BINDINGS.arkham, ...s.arkham }, parkour: { ...DEFAULT_BINDINGS.parkour, ...s.parkour } }; } catch { /* ignore */ }
  return clone(DEFAULT_BINDINGS);
}
export const BINDINGS_BY_MODE = loadBindings();
export let BINDINGS = BINDINGS_BY_MODE.arkham;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.buffer = new Map(); // action -> time remaining
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftDownAt: 0, wheel: 0 };
    this.leftReleased = false; this.leftPressed = false; this.rightPressed = false; this.rightReleased = false;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;
    this.listeners = [];

    // Buttons must never keep keyboard focus: Space/Enter would "click" them again
    // (e.g. Space re-triggering Play/Restart mid-fight).
    document.addEventListener('mouseup', () => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    addEventListener('keydown', e => {
      if (this.rebindCallback) { e.preventDefault(); const cb = this.rebindCallback; this.rebindCallback = null; cb(e.code); return; }
      if (e.code === 'Tab') e.preventDefault();
      const bound = Object.values(BINDINGS).some(c => c.includes(e.code));
      // in-game: swallow browser shortcuts (Ctrl+D, Ctrl+S...) — Ctrl is the slide key in Mode 2
      if (this.gameActive?.() && (bound || e.ctrlKey)) { e.preventDefault(); document.activeElement?.blur?.(); }
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      for (const [act, codes] of Object.entries(BINDINGS)) if (codes.includes(e.code) && !e.repeat) this.bufferAction(act);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked && this.wantLock) { canvas.requestPointerLock?.(); }
      if (e.button === 0) { this.mouse.left = true; this.leftPressed = true; this.mouse.leftDownAt = performance.now(); this.bufferAction('attack'); }
      if (e.button === 2) { this.mouse.right = true; this.rightPressed = true; }
      if (e.button === 1) { e.preventDefault(); this.bufferAction('launch'); }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0 && this.mouse.left) { this.mouse.left = false; this.leftReleased = true; }
      if (e.button === 2 && this.mouse.right) { this.mouse.right = false; this.rightReleased = true; }
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      for (const l of this.listeners) l(this.locked);
    });
  }

  onLockChange(fn) { this.listeners.push(fn); }

  setMode(mode) { BINDINGS = BINDINGS_BY_MODE[mode]; this.mode = mode; this.clearBuffer(); this.keys.clear(); }
  bindings(mode) { return BINDINGS_BY_MODE[mode]; }
  // Capture the next key press and bind it as the primary key for an action.
  rebind(mode, action, onDone) {
    this.rebindCallback = (code) => {
      if (code !== 'Escape') {
        const set = BINDINGS_BY_MODE[mode];
        for (const [a, codes] of Object.entries(set)) if (a !== action) set[a] = codes.filter(c => c !== code); // no duplicates
        set[action] = [code, ...set[action].filter(c => c !== code).slice(1)];
        try { localStorage.setItem('tbg-bindings', JSON.stringify(BINDINGS_BY_MODE)); } catch { /* ignore */ }
      }
      onDone?.(code);
    };
  }
  resetBindings(mode) {
    BINDINGS_BY_MODE[mode] = clone(DEFAULT_BINDINGS[mode]);
    if (this.mode === mode) BINDINGS = BINDINGS_BY_MODE[mode];
    try { localStorage.setItem('tbg-bindings', JSON.stringify(BINDINGS_BY_MODE)); } catch { /* ignore */ }
  }
  requestLock() { this.wantLock = true; try { this.canvas.requestPointerLock?.(); } catch (e) { /* needs gesture */ } }
  releaseLock() { this.wantLock = false; if (document.pointerLockElement) document.exitPointerLock(); }

  bufferAction(act, time = 0.28) { this.buffer.set(act, time); }
  // Consume a buffered action (returns true once).
  take(act) { if (this.buffer.has(act)) { this.buffer.delete(act); return true; } return false; }
  peek(act) { return this.buffer.has(act); }
  clearBuffer() { this.buffer.clear(); }

  down(act) { return BINDINGS[act]?.some(c => this.keys.has(c)) ?? false; }

  moveVector() {
    let x = 0, y = 0;
    if (this.down('forward')) y += 1; if (this.down('back')) y -= 1;
    if (this.down('right')) x += 1; if (this.down('left')) x -= 1;
    const l = Math.hypot(x, y); if (l > 0) { x /= l; y /= l; }
    return { x, y, len: l > 0 ? 1 : 0 };
  }

  leftHeldTime() { return this.mouse.left ? (performance.now() - this.mouse.leftDownAt) / 1000 : 0; }

  consumeMouse() {
    const d = { dx: this.mouse.dx * this.sensitivity, dy: this.mouse.dy * this.sensitivity * (this.invertY ? -1 : 1), wheel: this.mouse.wheel };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return d;
  }

  endFrame(dt) {
    this.pressedThisFrame.clear();
    this.leftReleased = false; this.leftPressed = false; this.rightPressed = false; this.rightReleased = false;
    for (const [k, v] of this.buffer) { const nv = v - dt; if (nv <= 0) this.buffer.delete(k); else this.buffer.set(k, nv); }
  }
}
