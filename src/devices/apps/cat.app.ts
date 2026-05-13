import type { OS } from "../os";

export async function cat(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <file> [file...]\n");
  }

  for (const path of args) {
    if (!os.fs_exists(path)) throw new Error(`File ${path} not found`);
    const data = os.fs_read(path);
    os.print(data);
  }
}

export async function ls(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <path>\n");
  }

  const path = args[0];
  if (!os.fs_is_dir(path)) throw new Error(`Path ${path} is not a directory`);

  for (const name of os.fs_list(path)) {
    const file = path + (path.endsWith("/") ? "" : "/") + name;
    if (os.fs_is_dir(file)) {
      os.print(`[${name}]`, "\n");
    } else {
      os.print(name, "\n");
    }
  }
}

export async function touch(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <file>\n");
  }

  const path = args[0];
  if (os.fs_exists(path)) return;

  os.fs_write(path, "");
}

export async function rm(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <file>\n");
  }

  const path = args[0];
  if (!os.fs_exists(path)) throw new Error(`File ${path} not found`);

  os.fs_rm(path);
}
