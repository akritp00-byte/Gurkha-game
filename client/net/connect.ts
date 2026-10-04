import { Client } from '@colyseus/sdk';
import { type JoinOptions, ROOM_NAME } from '@extinct/shared';
import type { RoomState } from './OnlineSession.ts';

/** How long to wait for a game room (and its first state) before playing offline instead. */
const JOIN_TIMEOUT_MS = 6000;

function join(serverUrl: string, options: JoinOptions) {
  return new Client(serverUrl).joinOrCreate<RoomState>(ROOM_NAME, options);
}

/** A joined game room, its state typed as this client reads it. */
export type GameRoom = Awaited<ReturnType<typeof join>>;

/** Join (or create) a game room and wait for its first state, or fail after a few seconds. */
export async function joinGame(serverUrl: string, options: JoinOptions): Promise<GameRoom> {
  let timedOut = false;
  const joining = join(serverUrl, options).then(
    (room) =>
      new Promise<GameRoom>((resolve) => {
        room.onStateChange.once(() => {
          resolve(room);
        });
      }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`no game room within ${JOIN_TIMEOUT_MS} ms`));
    }, JOIN_TIMEOUT_MS);
  });
  // A join that only succeeds after we gave up would leave a dinosaur standing in the room.
  void joining.then(
    (room) => {
      if (timedOut) void room.leave();
    },
    () => undefined,
  );
  try {
    return await Promise.race([joining, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
