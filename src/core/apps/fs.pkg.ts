import type { OS } from "../os/os";

export async function cat(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <file> [file...]\n");
  }

  for (const path of args) {
    if (!os.fs.exists(path)) throw new Error(`File ${path} not found`);
    const data = os.fs.read(path);
    os.print(data, "\n");
  }
}

export async function ls(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <path>\n");
  }

  const path = args[0];
  if (!os.fs.is_dir(path)) throw new Error(`Path ${path} is not a directory`);

  for (const name of os.fs.list(path)) {
    const file = path + (path.endsWith("/") ? "" : "/") + name;
    if (os.fs.is_dir(file)) {
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
  if (os.fs.exists(path)) return;

  os.fs.write(path, "");
}

export async function rm(os: OS, args: string[]) {
  if (!args.length) {
    return os.print("usage: <file>\n");
  }

  const path = args[0];
  if (!os.fs.exists(path)) throw new Error(`File ${path} not found`);

  os.fs.rm(path);
}
