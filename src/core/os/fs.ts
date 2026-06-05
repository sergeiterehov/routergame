import type { OS } from "./os";

export class FS {
  _fs: { [key: string]: string } = {};

  on_change?: (fs: { [key: string]: string | undefined }) => void;

  constructor(public readonly os: OS) {}

  read(path: string) {
    if (!path.startsWith("/")) path = "/" + path;
    return this._fs[path];
  }
  write(path: string, data: string) {
    if (!path.startsWith("/")) path = "/" + path;
    this._fs[path] = data;
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
}
