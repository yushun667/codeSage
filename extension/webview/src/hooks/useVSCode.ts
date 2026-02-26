import { useCallback, useEffect, useRef } from 'react';

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

let vscodeApi: VSCodeApi | null = null;

function getVSCodeApi(): VSCodeApi | null {
  if (vscodeApi) return vscodeApi;
  try {
    vscodeApi = acquireVsCodeApi();
    return vscodeApi;
  } catch {
    return null;
  }
}

export function useVSCode() {
  const api = getVSCodeApi();

  const postMessage = useCallback((message: unknown) => {
    api?.postMessage(message);
  }, [api]);

  const onMessage = useCallback((handler: (data: unknown) => void) => {
    const listener = (event: MessageEvent) => {
      handler(event.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  return { postMessage, onMessage, api };
}
