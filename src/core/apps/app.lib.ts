import { validate_address, validate_ip } from "../format";
import { E_NET } from "../os/net";
import type { OS, TApp } from "../os/os";
import type { TSocket } from "../os/socket";
import type { TIP4Packet } from "../pack";

export type TArg = {
  name?: string;
  alias?: string;
  type: "flag" | "string" | "number" | "ip" | "ip/" | string[];
  multiple?: boolean;
  required?: boolean;
  desc?: string;
  default?: string[];
};

export type TCommandFn = (parsed: Record<string, string[]>) => TApp;

export type TCommand = {
  desc: string;
  args?: TArg[];
  fn: TCommandFn | Record<string, TCommand>;
};

export function parse_args(types: TArg[], args: string[]) {
  if (!types.length && args.length) throw new Error("Arguments not expected");

  const _args = [...args];

  const type_names = new Map<TArg, string>(
    types.map((type) => [
      type,
      (type.name || type.alias)?.replace(/^-+/, "") ??
        types
          .filter((t) => !t.name)
          .indexOf(type)
          .toString(),
    ]),
  );

  const result: Record<string, string[]> = {};
  const found = new Set<TArg>();
  const ejected = new Set<TArg>();

  while (_args.length) {
    const arg = _args.shift()!;

    let matched: TArg[] = [];
    for (const t of types) {
      if (ejected.has(t)) continue;
      if (t.name && t.name !== arg && t.alias !== arg) continue;

      matched.push(t);
    }

    // Skip all noname if some named found
    if (matched.some((t) => t.name)) {
      matched = matched.filter((t) => t.name);
    } else {
      matched = matched.slice(0, 1);
    }

    if (!matched.length) throw new Error(`Unknown argument "${arg}"`);
    if (matched.length > 1) throw new Error(`Ambiguous argument "${arg}"`);

    const [type] = matched;

    const name = type_names.get(type)!;

    result[name] ||= [];

    if (type.type === "flag") {
      result[name].push("1");
    } else {
      const value = type.name ? _args.shift()! : arg;
      if (!value) throw new Error(`Argument ${name} requires value`);

      if (typeof type.type === "object") {
        if (!type.type.includes(value)) {
          throw new Error(`Argument ${name} must be one of: ${type.type.join(", ")}`);
        }
        result[name].push(value);
      } else if (type.type === "string") {
        result[name].push(value);
      } else if (type.type === "number") {
        if (/^[0-9_]+$/.test(value)) {
          result[name].push(value.replaceAll("_", ""));
        } else if (/^0x[0-9a-f_]+$/i.test(value)) {
          result[name].push(Number.parseInt(value.slice(2).replaceAll("_", ""), 16).toString());
        } else {
          throw new Error(`Argument "${name}" must be a number`);
        }
      } else if (type.type === "ip") {
        if (!validate_ip(value)) throw new Error(`Argument ${name} must be a valid IP`);
        result[name].push(value);
      } else if (type.type === "ip/") {
        if (!validate_address(value)) throw new Error(`Argument ${name} must be a valid IP/mask`);
        result[name].push(value);
      } else {
        throw new Error(`Unknown argument type "${type.type}"`);
      }
    }

    found.add(type);

    if (!type.multiple) ejected.add(type);
  }

  for (const type of types) {
    if (!found.has(type)) {
      result[type_names.get(type)!] = type.default || [];
    }
  }

  for (const type of types) {
    if (type.required && !found.has(type)) {
      throw new Error(`Argument ${type_names.get(type)} is required`);
    }
  }

  return result;
}

export function test_args(args: string[], ...ps: (string | RegExp | ((arg: string) => unknown))[]) {
  if (ps.length > args.length) return false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (typeof ps[i] === "string" && p === args[i]) continue;
    if (typeof p === "function" && p(args[i])) continue;
    if (p instanceof RegExp && p.test(args[i])) continue;
    return false;
  }
  return true;
}

export function has_arg(args: string[], key: string) {
  return args.includes(key);
}

export function find_arg(args: string[], key: string, initial: string = "") {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === key && args[i + 1]) {
      return args[i + 1];
    }
  }

  return initial;
}

export function find_args(args: string[], key: string) {
  const result: string[] = [];

  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === key && args[i + 1]) {
      result.push(args[i + 1]);
      i += 1;
    }
  }

  return result;
}

// net int br po --help
const _format_help = (path: string[], commands: Record<string, TCommand>): string => {
  const output: string[] = [`HELP: ${path.join("/")}\n`];

  let _commands = commands;
  const _top_args: TArg[] = [];

  for (const _name of path) {
    const cmd = _commands[_name];
    if (typeof cmd.fn === "function") {
      _commands = { [_name]: cmd };
    } else {
      if (cmd.args) _top_args.push(...cmd.args);
      _commands = cmd.fn;
    }
  }

  for (const [_cmd_name, _cmd] of Object.entries(_commands)) {
    if (_cmd_name) output.push(`${_cmd_name} - `);
    output.push(`${_cmd.desc}\n`);
    if (_cmd.args) {
      for (const arg of _cmd.args) {
        output.push("\t");
        output.push(arg.name || `<${arg.alias || arg.type}>`);
        if (arg.multiple) output.push("...");
        if (arg.desc) output.push(" - ", arg.desc);
        output.push(", ", arg.required ? "required" : "optional");
        output.push(", ", typeof arg.type === "object" ? arg.type.join("|") : arg.type);
        if (arg.default) output.push(", default = ", arg.default.join(","));
        output.push("\n");
      }
      output.push(`\n`);
    }
  }

  return output.join("");
};

export const with_commander =
  (commands: Record<string, TCommand>): TApp =>
  async (os, args, ctx) => {
    const _has_help_flag = args.includes("--help");

    const _args = [...args];

    const path: string[] = [];
    let _commands = commands;

    let parsed_args: Record<string, string[]> = {};

    while (_args.length) {
      const _input = _args[0];

      const names: string[] = [];
      for (const _c in _commands) {
        // exact match
        if (_c === _input) {
          names.splice(0);
          names.push(_c);
          break;
        }
        // starts with or ANY (empty) command
        if (!_c || _c.startsWith(_input)) {
          names.push(_c);
        }
      }

      if (names.length === 0) throw new Error(`Use "--help" to list available commands.`);
      if (names.length > 1) throw new Error(`Multiple commands found: ${names.join(", ")}`);

      const [name] = names;
      const cmd = _commands[name];

      // if not ANY (empty) command
      if (name) _args.shift();

      path.push(name);

      if (cmd.args && !_has_help_flag) {
        parsed_args = { ...parsed_args, ...parse_args(cmd.args, _args) };
      }

      if (typeof cmd.fn === "function") {
        if (_has_help_flag) break;

        return await cmd.fn(parsed_args)(os, _args, ctx);
      } else {
        _commands = cmd.fn;
      }
    }

    ctx.output(_format_help(path, commands));
  };

export function format_net_error(err: number) {
  for (const [name, code] of Object.entries(E_NET)) {
    if (code === err) return name;
  }
  return `UNKNOWN_${err}`;
}

export async function socket_connected(os: OS, socket: TSocket, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Aborted");
  if (socket.state === "established") return;

  return new Promise<TSocket>((resolve, reject) => {
    socket.on_connected = (socket) => resolve(socket);
    socket.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
    socket.on_close = () => reject(new Error("Socket closed"));
    if (signal) signal.onabort = () => reject(new Error("Aborted"));
  }).finally(() => {
    delete socket.on_recv;
    delete socket.on_error;
    delete socket.on_close;
    if (signal) signal.onabort = null;
  });
}

export async function socket_read(os: OS, socket: TSocket, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw new Error("Aborted");
  if (socket.state === "listen") throw new Error("Socket is listen");
  if (socket.type === "tcp" && socket.state !== "established") throw new Error("Socket not opened");

  if (socket.recv_queue.length) {
    const buffers = socket.recv_queue.splice(0).map((r) => r.data);
    const concat_data = buffers.reduce((acc, buf) => new Uint8Array([...acc, ...buf]), new Uint8Array());
    return concat_data;
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    socket.on_recv = (recv) => resolve(recv.data);
    socket.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
    socket.on_close = () => reject(new Error("Socket closed"));
    if (signal) signal.onabort = () => reject(new Error("Aborted"));
  }).finally(() => {
    delete socket.on_recv;
    delete socket.on_error;
    delete socket.on_close;
    if (signal) signal.onabort = null;
  });
}

export async function socket_read_raw(os: OS, socket: TSocket, signal?: AbortSignal): Promise<TIP4Packet> {
  if (signal?.aborted) throw new Error("Aborted");
  if (socket.type !== "raw") throw new Error("Socket is not raw");

  return new Promise<TIP4Packet>((resolve, reject) => {
    socket.on_raw_recv = (recv) => resolve(recv.packet);
    socket.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
    socket.on_close = () => reject(new Error("Socket closed"));
    if (signal) signal.onabort = () => reject(new Error("Aborted"));
  }).finally(() => {
    delete socket.on_raw_recv;
    delete socket.on_error;
    delete socket.on_close;
    if (signal) signal.onabort = null;
  });
}

export function from_utf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export function to_utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
