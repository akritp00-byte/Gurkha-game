const REQUEST_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 5000;

/** Whether the server's `/health` route answers. Never throws. */
export async function isServerOnline(serverUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Poll the server's health until the returned function is called. */
export function watchServerHealth(
  serverUrl: string,
  onUpdate: (online: boolean) => void,
): () => void {
  let stopped = false;
  let timer: number | undefined;

  const poll = async (): Promise<void> => {
    const online = await isServerOnline(serverUrl);
    if (stopped) return;
    onUpdate(online);
    timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
  };
  void poll();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
