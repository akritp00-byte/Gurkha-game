import { clamp, CONTROLS, type MoveInput } from '@extinct/shared';
import { joystickInput, keyboardInput, mouseInput } from './steering.ts';

export type ControlScheme = 'keyboard' | 'mouse' | 'touch';

type Action = 'forward' | 'back' | 'left' | 'right' | 'sprint';

/** Physical key positions, so WASD works on any keyboard layout. */
const KEY_BINDINGS: Readonly<Partial<Record<string, Action>>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

interface Pointer {
  readonly id: number;
  x: number;
  y: number;
}

interface Stick extends Pointer {
  readonly originX: number;
  readonly originY: number;
}

/**
 * Turns keyboard, mouse and touch into one steering input (BUILD_PROMPT.md §8):
 * - keyboard: WASD or arrow keys, Shift to sprint;
 * - mouse: hold the left button and the dinosaur runs towards the cursor (Shift sprints);
 * - touch: a floating joystick anywhere on the left half of the screen, and a sprint button
 *   on the right.
 */
export class Controls {
  scheme: ControlScheme;
  /** True once the player has used any control (hides the controls hint). */
  used = false;
  private readonly surface: HTMLElement;
  private readonly keys: Record<Action, boolean> = {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
  };
  private mouse: Pointer | null = null;
  private stick: Stick | null = null;
  /** The touch currently holding the sprint button, if any. */
  private sprintTouch: number | null = null;
  private readonly joystickBase: HTMLElement;
  private readonly joystickKnob: HTMLElement;
  private readonly sprintButton: HTMLButtonElement;

  constructor(surface: HTMLElement, overlay: HTMLElement, touchFirst: boolean) {
    this.surface = surface;
    this.scheme = touchFirst ? 'touch' : 'keyboard';
    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'joystick';
    this.joystickBase.hidden = true;
    this.joystickBase.style.setProperty('--joystick-radius', `${CONTROLS.joystickRadius}px`);
    this.joystickKnob = document.createElement('div');
    this.joystickKnob.className = 'joystick-knob';
    this.joystickBase.append(this.joystickKnob);
    this.sprintButton = document.createElement('button');
    this.sprintButton.type = 'button';
    this.sprintButton.className = 'sprint-button';
    this.sprintButton.textContent = 'Sprint';
    this.sprintButton.dataset.testid = 'sprint-button';
    this.sprintButton.hidden = !touchFirst;
    overlay.append(this.joystickBase, this.sprintButton);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('pointermove', this.onPointerMove);
    surface.addEventListener('pointerup', this.onPointerUp);
    surface.addEventListener('pointercancel', this.onPointerUp);
    surface.addEventListener('contextmenu', this.preventDefault);
    this.sprintButton.addEventListener('pointerdown', this.onSprintDown);
    this.sprintButton.addEventListener('pointerup', this.onSprintUp);
    this.sprintButton.addEventListener('pointercancel', this.onSprintUp);
    this.sprintButton.addEventListener('contextmenu', this.preventDefault);
  }

  /** Current steering. `dinoOnScreen` is the dinosaur's position in CSS pixels (for the mouse). */
  sample(dinoOnScreen: { readonly x: number; readonly y: number }): MoveInput {
    const steering = this.stick
      ? joystickInput(this.stick.x - this.stick.originX, this.stick.y - this.stick.originY)
      : this.mouse
        ? mouseInput(this.mouse.x - dinoOnScreen.x, this.mouse.y - dinoOnScreen.y)
        : keyboardInput(this.keys);
    const sprint = this.keys.sprint || this.sprintTouch !== null;
    return steering.sprint === sprint ? steering : { ...steering, sprint };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    this.surface.removeEventListener('contextmenu', this.preventDefault);
    this.joystickBase.remove();
    this.sprintButton.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (action === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    this.keys[action] = true;
    if (action === 'sprint') return; // Shift alone doesn't switch away from mouse steering
    this.scheme = 'keyboard';
    this.used = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (action !== undefined) this.keys[action] = false;
  };

  private readonly onSprintDown = (event: PointerEvent): void => {
    this.sprintTouch = event.pointerId;
    this.sprintButton.classList.add('active');
    this.sprintButton.setPointerCapture(event.pointerId);
    this.used = true;
    event.preventDefault();
  };

  private readonly onSprintUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.sprintTouch) return;
    this.sprintTouch = null;
    this.sprintButton.classList.remove('active');
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      this.mouse = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.scheme = 'mouse';
    } else {
      // Touch or pen: the left half of the screen holds a floating joystick. The right half is
      // kept free for the sprint and ability buttons.
      if (this.stick || event.clientX > window.innerWidth / 2) return;
      this.stick = {
        id: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        x: event.clientX,
        y: event.clientY,
      };
      this.scheme = 'touch';
      this.sprintButton.hidden = false;
      this.joystickBase.style.left = `${event.clientX}px`;
      this.joystickBase.style.top = `${event.clientY}px`;
      this.joystickBase.hidden = false;
      this.moveKnob();
    }
    this.used = true;
    this.surface.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.mouse?.id === event.pointerId) {
      this.mouse.x = event.clientX;
      this.mouse.y = event.clientY;
    } else if (this.stick?.id === event.pointerId) {
      this.stick.x = event.clientX;
      this.stick.y = event.clientY;
      this.moveKnob();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.mouse?.id === event.pointerId) this.mouse = null;
    if (this.stick?.id === event.pointerId) {
      this.stick = null;
      this.joystickBase.hidden = true;
    }
  };

  private readonly releaseAll = (): void => {
    this.keys.forward = this.keys.back = this.keys.left = this.keys.right = false;
    this.keys.sprint = false;
    this.mouse = null;
    this.stick = null;
    this.sprintTouch = null;
    this.joystickBase.hidden = true;
    this.sprintButton.classList.remove('active');
  };

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private moveKnob(): void {
    if (!this.stick) return;
    const dx = this.stick.x - this.stick.originX;
    const dy = this.stick.y - this.stick.originY;
    const distance = Math.hypot(dx, dy);
    const k = distance > 0 ? clamp(distance, 0, CONTROLS.joystickRadius) / distance : 0;
    this.joystickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }
}
