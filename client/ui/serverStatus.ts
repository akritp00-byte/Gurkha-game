export function renderServerStatus(element: HTMLElement, online: boolean): void {
  element.dataset.status = online ? 'online' : 'offline';
  element.textContent = online ? 'Server online' : 'Server offline. Retrying…';
}
