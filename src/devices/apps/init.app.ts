import type { OS } from "../os/os";

const PATH = "/init";

export async function init(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  if (!os.fs.exists(PATH) || os.fs.is_dir(PATH)) throw new Error("No /init script found");

  const init = os.fs.read(PATH);

  for (const line of init.split("\n")) {
    const [app, ...args] = line.trim().split(/\s+/);
    if (!app) continue;

    const background = args.at(-1) === "&" && args.pop();

    if (background) {
      os.exec(app, args);
    } else {
      await os.exec(app, args);
    }
  }
}
