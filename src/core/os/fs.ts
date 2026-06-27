import type { OS } from "./os";

export type TWatcher = {
  path: string;
  cb: () => void;
};

export class FS {
  private _fs: { [key: string]: string } = {};

  _watchers: TWatcher[] = [];

  on_change?: (fs: { [key: string]: string | undefined }) => void;

  constructor(public readonly os: OS) {}

  private _notify(path: string) {
    for (const watcher of this._watchers) {
      if (watcher.path.startsWith(path)) {
        watcher.cb();
      }
    }
  }

  read(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    return this._fs[path];
  }

  write(path: string, data: string) {
    if (!path.startsWith("/")) path = "/" + path;
    this._fs[path] = data;
    this._notify(path);
    this.on_change?.({ [path]: data });
  }

  rm(path: string) {
    const keys: string[] = [];

    if (!path.startsWith("/")) path = "/" + path;
    delete this._fs[path];
    keys.push(path);

    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) {
        delete this._fs[key];
        keys.push(key);
      }
    }

    this._notify(path);

    this.on_change?.(Object.fromEntries(keys.map((key) => [key, undefined])));
  }

  exists(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (path in this._fs) return true;
    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) return true;
    }
    return false;
  }

  list(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (!path.endsWith("/")) path += "/";

    const result = new Set<string>();
    for (const key of Object.keys(this._fs)) {
      if (!key.startsWith(path)) continue;
      const inner = key.substring(path.length);
      const index = inner.indexOf("/");
      result.add(index === -1 ? inner : inner.substring(0, index));
    }

    return [...result];
  }

  is_dir(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    if (!path.endsWith("/")) path += "/";
    for (const key of Object.keys(this._fs)) {
      if (key.startsWith(path)) return true;
    }
  }

  watch(path: string, cb: () => void) {
    const watcher: TWatcher = { path, cb };
    this._watchers.push(watcher);
    return watcher;
  }

  unwatch(watcher: TWatcher) {
    const index = this._watchers.indexOf(watcher);
    if (index !== -1) {
      this._watchers.splice(index, 1);
    }
  }
}
