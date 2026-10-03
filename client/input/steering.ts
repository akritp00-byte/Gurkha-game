import { clamp, CONTROLS, IDLE_INPUT, type MoveInput } from '@extinct/shared';

export interface KeyboardState {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** W/↑ runs, S/↓ brakes, A/D or ←/→ turn (on the spot when standing still). */
export function keyboardInput(keys: KeyboardState): MoveInput {
  return {
    turn: (keys.left ? 1 : 0) - (keys.right ? 1 : 0),
    throttle: keys.forward && !keys.back ? 1 : 0,
  };
}

/**
 * Steer towards a direction on screen, relative to the dinosaur (x right, y up). Straight up
 * the screen is straight ahead, because the camera sits behind the dinosaur; anything off to
 * one side turns that way, reaching full lock at CONTROLS.fullLockAngle. `strength` (0..1)
 * becomes the throttle.
 */
export function steerTowards(dx: number, dy: number, strength: number): MoveInput {
  if (strength <= 0 || (dx === 0 && dy === 0)) return IDLE_INPUT;
  const angle = Math.atan2(dx, dy); // 0 is up the screen, positive is to the right
  return {
    turn: clamp(-angle / CONTROLS.fullLockAngle, -1, 1),
    throttle: clamp(strength, 0, 1),
  };
}

/** Joystick knob offset from its centre, in CSS pixels (y pointing down the screen). */
export function joystickInput(offsetX: number, offsetY: number): MoveInput {
  return steerTowards(offsetX, -offsetY, Math.hypot(offsetX, offsetY) / CONTROLS.joystickRadius);
}

/** Cursor offset from the dinosaur on screen, in CSS pixels (y pointing down the screen). */
export function mouseInput(offsetX: number, offsetY: number): MoveInput {
  const distance = Math.hypot(offsetX, offsetY);
  if (distance < CONTROLS.mouseDeadZone) return IDLE_INPUT;
  const strength =
    (distance - CONTROLS.mouseDeadZone) /
    (CONTROLS.mouseFullSpeedDistance - CONTROLS.mouseDeadZone);
  return steerTowards(offsetX, -offsetY, strength);
}
