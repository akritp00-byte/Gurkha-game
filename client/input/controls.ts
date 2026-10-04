import { clamp, CONTROLS, type PlayerInput } from '@extinct/shared';
import { joystickInput, keyboardInput, mouseInput } from './steering.ts';

export type ControlScheme = 'keyboard' | 'mouse' | 'touch';

type Action = 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'eat';

/** Mouse buttons (PointerEvent.button). */
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

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
  KeyE: 'eat',
};

/** Keys that bite (as well as the left mouse button). */
const BITE_KEYS = new Set(['Space']);

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
 * Turns keyboard, mouse and touch into one input (BUILD_PROMPT.md §8):
 * - keyboard: WASD or arrow keys, Shift to sprint, Space to bite, hold E to eat;
 * - mouse: click to bite; hold the right button and the dinosaur runs towards the cursor;
 * - touch: a floating joystick anywhere on the left half of the screen, and Sprint, Bite and
 *   Eat buttons on the right.
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
    eat: false,
  };
  private mouse: Pointer | null = null;
  private stick: Stick | null = null;
  /** The touches currently holding the sprint and eat buttons, if any. */
  private sprintTouch: number | null = null;
  private eatTouch: number | null = null;
  /** A click or tap since the last sample: one bite. */
  private biteQueued = false;
  private readonly joystickBase: HTMLElement;
  private readonly joystickKnob: HTMLElement;
  private readonly sprintButton: HTMLButtonElement;
  private readonly biteButton: HTMLButtonElement;
  private readonly eatButton: HTMLButtonElement;

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
    const button = (name: string, label: string) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `touch-button ${name}-button`;
      element.textContent = label;
      element.dataset.testid = `${name}-button`;
      element.hidden = !touchFirst;
      element.addEventListener('contextmenu', this.preventDefault);
      return element;
    };
    this.sprintButton = button('sprint', 'Sprint');
    this.biteButton = button('bite', 'Bite');
    this.eatButton = button('eat', 'Eat');
    overlay.append(this.joystickBase, this.sprintButton, this.biteButton, this.eatButton);

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
    this.biteButton.addEventListener('pointerdown', this.onBiteDown);
    this.eatButton.addEventListener('pointerdown', this.onEatDown);
    this.eatButton.addEventListener('pointerup', this.onEatUp);
    this.eatButton.addEventListener('pointercancel', this.onEatUp);
  }

  /**
   * This frame's input. `dinoOnScreen` is the dinosaur's position in CSS pixels (for the
   * mouse). A bite is reported once per click.
   */
  sample(dinoOnScreen: { readonly x: number; readonly y: number }): PlayerInput {
    const steering = this.stick
      ? joystickInput(this.stick.x - this.stick.originX, this.stick.y - this.stick.originY)
      : this.mouse
        ? mouseInput(this.mouse.x - dinoOnScreen.x, this.mouse.y - dinoOnScreen.y)
        : keyboardInput(this.keys);
    const bite = this.biteQueued;
    this.biteQueued = false;
    return {
      turn: steering.turn,
      throttle: steering.throttle,
      sprint: this.keys.sprint || this.sprintTouch !== null,
      bite,
      eat: this.keys.eat || this.eatTouch !== null,
    };
  }

  /** Bite on the next sample, as if clicked. */
  queueBite(): void {
    this.biteQueued = true;
    this.used = true;
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
    this.biteButton.remove();
    this.eatButton.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (BITE_KEYS.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) this.queueBite();
      return;
    }
    const action = KEY_BINDINGS[event.code];
    if (action === undefined) return;
    event.preventDefault();
    this.keys[action] = true;
    this.used = true;
    // Shift and E alone don't switch away from mouse steering.
    if (action !== 'sprint' && action !== 'eat') this.scheme = 'keyboard';
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

  private readonly onBiteDown = (event: PointerEvent): void => {
    this.queueBite();
    event.preventDefault();
  };

  private readonly onEatDown = (event: PointerEvent): void => {
    this.eatTouch = event.pointerId;
    this.eatButton.classList.add('active');
    this.eatButton.setPointerCapture(event.pointerId);
    this.used = true;
    event.preventDefault();
  };

  private readonly onEatUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.eatTouch) return;
    this.eatTouch = null;
    this.eatButton.classList.remove('active');
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      if (event.button === LEFT_BUTTON) {
        this.queueBite();
        event.preventDefault();
        return;
      }
      if (event.button !== RIGHT_BUTTON) return;
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
      this.biteButton.hidden = false;
      this.eatButton.hidden = false;
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
    this.keys.sprint = this.keys.eat = false;
    this.mouse = null;
    this.stick = null;
    this.sprintTouch = null;
    this.eatTouch = null;
    this.joystickBase.hidden = true;
    this.sprintButton.classList.remove('active');
    this.eatButton.classList.remove('active');
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
