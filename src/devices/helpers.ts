export function setIntervalRecursive(cb: () => void, interval: number) {
  if (interval < 0) interval = 0;

  const ref = { id: 0 };
  const call = () => {
    ref.id = setTimeout(call, interval);
    cb();
  };

  ref.id = setTimeout(call, interval);
  return ref;
}

export const with_cleanup_signal = async <T>(fn: (config: { cleanup_signal: AbortSignal }) => Promise<T>) => {
  const self_controller = new AbortController();
  try {
    return await fn({ cleanup_signal: self_controller.signal });
  } finally {
    self_controller.abort();
  }
};
