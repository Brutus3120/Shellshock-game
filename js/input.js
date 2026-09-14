/**
 * input.js — clavier, souris et verrouillage du pointeur.
 *
 * On lit l'état des touches par `code` (indépendant de la disposition physique)
 * ET par une table AZERTY/QWERTY pour que ZQSD et WASD fonctionnent tous les deux.
 */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();       // touches déclenchées cette frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = [false, false, false];
    this.clicked = [false, false, false];
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button < 3) { this.buttons[e.button] = true; this.clicked[e.button] = true; }
    };
    this._onMouseUp = (e) => { if (e.button < 3) this.buttons[e.button] = false; };
    this._onWheel = (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.buttons = [false, false, false]; this.keys.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onBlur = () => { this.keys.clear(); this.buttons = [false, false, false]; };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', this._onBlur);
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  releaseLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  /** Une touche parmi plusieurs codes est-elle enfoncée ? */
  down(...codes) { for (const c of codes) if (this.keys.has(c)) return true; return false; }
  hit(...codes) { for (const c of codes) if (this.pressed.has(c)) return true; return false; }

  /** À appeler en fin de frame. */
  endFrame() {
    this.pressed.clear();
    this.clicked = [false, false, false];
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLock);
    window.removeEventListener('blur', this._onBlur);
  }
}

/** Avant / arrière / gauche / droite, compatible QWERTY et AZERTY. */
export const KEY = {
  forward: ['KeyW', 'KeyZ', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  reload: ['KeyR'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  w1: ['Digit1', 'Numpad1'],
  w2: ['Digit2', 'Numpad2'],
  w3: ['Digit3', 'Numpad3'],
};
