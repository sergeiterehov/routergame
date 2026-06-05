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

export function create_input_buffer(
  input: (cb: (text: string) => void, signal?: AbortSignal) => void,
  transform?: (text: string, buffer: string[]) => string,
  signal?: AbortSignal,
): (cb: (text: string) => void, signal?: AbortSignal) => void {
  const buffer: string[] = [];
  let _cb: (() => void) | undefined;

  const read = () => {
    input((text) => {
      if (signal?.aborted) return;

      try {
        if (transform) text = transform(text, buffer);
      } finally {
        try {
          if (text) {
            buffer.push(text);
            _cb?.();
          }
        } finally {
          _cb = undefined;
          read();
        }
      }
    }, signal);
  };

  read();

  return (cb, signal) => {
    if (signal?.aborted) return;

    if (buffer.length) return cb(buffer.shift()!);

    _cb = () => cb(buffer.shift()!);
  };
}
