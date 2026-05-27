import type { OS } from "../os/os";

const _PATH = "/init";

let _initialized = false;

export async function init(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  if (_initialized) throw new Error("Already initialized");
  _initialized = true;

  if (!os.fs.exists(_PATH) || os.fs.is_dir(_PATH)) throw new Error("No /init script found");

  const init = os.fs.read(_PATH);

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

  os.print("Welcome!\n");
}
