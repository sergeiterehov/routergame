import { SEC } from "../format";
import { async_timeout, create_input_buffer } from "../helpers";
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

  try {
    for (const line of init.split("\n")) {
      await _eval(line, ctx);
    }
  } catch (e) {
    os.print(`Initial script error: ${e}\n`);
  }

  os.print(`Welcome! Host name ${os._hostname}\n`);

  const input_buffer: string[] = [""];
  let evaluating: { cmd: string; ctx: TAppContext; controller: AbortController } | undefined;

  const input = create_input_buffer(
    ctx.input,
    (text, buffer) => {
      if (evaluating) {
        if (text.trim() === "^c") {
          buffer.splice(0);
          evaluating.controller.abort();
          return "";
        }
      }

      return text;
    },
    ctx.signal,
  );

  const _process_buffer = async () => {
    if (evaluating) return;
    if (!input_buffer.length) return;

    try {
      while (input_buffer.length) {
        const text = input_buffer.shift();
        if (!text) continue;

        os.print(text);

        const cmd_controller = new AbortController();
        evaluating = {
          cmd: text,
          controller: cmd_controller,
          ctx: {
            ...ctx,
            input,
            signal: AbortSignal.any([cmd_controller.signal, ctx.signal]),
          },
        };

        await _eval(text, evaluating.ctx);
      }
    } catch (e) {
      os.print(`${e}\n`);
    } finally {
      evaluating = undefined;
      os.print(`# `);
    }
  };

  await _process_buffer();

  while (!ctx.signal.aborted) {
    const text = await new Promise<string>((resolve, reject) => {
      input(resolve, ctx.signal);
      ctx.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    });

    input_buffer.push(text);
    await _process_buffer();
  }

  os.print("[done]");
};
