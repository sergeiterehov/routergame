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

export const async_timeout = (ms: number, signal?: AbortSignal) =>
  new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new Error("Aborted"));
      },
      { once: true },
    );
  });
