import { SEC } from "../format";
import { async_timeout } from "../helpers";
import type { TApp, TAppContext } from "../os/os";
import { test_args } from "./app.lib";

const _PATH = "/init";

let _initialized = false;

const _sleep: TApp = async (_os, args, ctx) => {
  if (test_args(args, Boolean)) {
    const _sec = parseInt(args[0]);
    if (Number.isNaN(_sec)) throw new Error("Invalid sleep time");
    if (_sec < 0) throw new Error("Negative sleep time");

    await async_timeout(parseInt(args[0]) * SEC, ctx.signal);
  } else {
    throw new Error("usage: <seconds>");
  }
};

const _CMDS: Record<string, TApp> = {
  sleep: _sleep,
};

export const init: TApp = async (os, args, ctx) => {
  if (args.length) throw new Error("No arguments expected");

  if (_initialized) throw new Error("Already initialized");
  _initialized = true;

  if (!os.fs.exists(_PATH) || os.fs.is_dir(_PATH)) throw new Error("No /init script found");

  const init = os.fs.read(_PATH);

  const _exec = async (cmd: string, args: string[], ctx: TAppContext) => {
    if (_CMDS[cmd]) {
      return _CMDS[cmd](os, args, ctx);
    }

    return os.exec(cmd, args, ctx);
  };

  const _eval = async (cmd: string, ctx: TAppContext) => {
    cmd = cmd.trim();
    if (cmd.startsWith("#")) return;

    const [app, ...args] = cmd.split(/\s+/);
    if (!app) return;

    const background = args.at(-1) === "&" && args.pop();

    if (background) {
      _exec(app, args, ctx).catch((e) => os.print(`[& ${app} ERROR]: ${e}\n`));
    } else {
      await _exec(app, args, ctx);
    }
  };

  let queue = Promise.resolve();
  let user_controller = new AbortController();

  try {
    for (const line of init.split("\n")) {
      await _eval(line, ctx);
    }
  } catch (e) {
    os.print(`Initial script error: ${e}\n`);
  }

  os.print("Welcome!\n");

  os.on_input = (text) => {
    if (text.trim() === "^c") {
      user_controller.abort();
      return;
    }

    queue = queue
      .catch(() => null)
      .then(async () => {
        os.print(`# ${text}`);

        user_controller = new AbortController();
        const user_ctx: TAppContext = { ...ctx, signal: AbortSignal.any([user_controller.signal, ctx.signal]) };

        try {
          await _eval(text, user_ctx);
        } catch (e) {
          os.print(`${e}\n`);
        }
      });
  };

  await new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, { once: true }));
  os.print("[done]");
};
