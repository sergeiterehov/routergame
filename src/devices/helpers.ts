export function setIntervalRecursive(cb: () => void, interval: number) {
  if (interval < 0) interval = 0;

  const ref = { interval: 0 };
  const call = () => {
    ref.interval = setTimeout(call, interval);
    cb();
  };

  ref.interval = setTimeout(call, interval);
  return ref;
}
