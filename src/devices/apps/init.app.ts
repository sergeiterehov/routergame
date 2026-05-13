import type { OS } from "../os";

const PATH = "/init";

export async function init(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  if (!os.fs_exists(PATH) || os.fs_is_dir(PATH)) throw new Error("No /init script found");

  const init = os.fs_read(PATH);

  for (const line of init.split("\n")) {
    const [app, ...args] = line.trim().split(/\s+/);
    if (!app) continue;

    await os.exec(app, args);
  }
}
