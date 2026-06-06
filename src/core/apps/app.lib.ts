import { validate_address, validate_ip } from "../format";
import { NET_ERRORS } from "../os/net";
import type { OS } from "../os/os";
import type { TSocket } from "../os/socket";
import type { TIP4Packet } from "../pack";

export type TArg = {
  name?: string;
  alias?: string;
  type: "flag" | "string" | "number" | "ip" | "ip/";
  multiple?: boolean;
  required?: boolean;
  desc?: string;
  default?: string[];
};

export type TCommand = {
  desc: string;
  args?: TArg[];
  fn: (args: string[], parsed: Record<string, string[] | undefined>) => unknown;
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

    let matched = types.filter((t) => !ejected.has(t) && (!t.name || t.name === arg || t.alias == arg));
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

      if (type.type === "string") {
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
      } else {
        throw new Error(`Unknown argument type "${type.type}"`);
      }
    }

    found.add(type);

    if (!type.multiple) ejected.add(type);
  }

  for (const type of types) {
    if (!found.has(type) && type.default) {
      result[type_names.get(type)!] = type.default;
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

export async function run_command_of(os: OS, commands: Record<string, TCommand>, args: string[]) {
  const _commands: typeof commands = {
    ...commands,
    "--help": {
      desc: "show this help",
      fn: ([name, ..._args]) => {
        if ("" in _commands) name = "";

        if (commands.help) {
          os.print(commands.help.desc, "\n\n");
          commands.help.fn(_args, commands.help.args ? parse_args(commands.help.args, _args) : {});
        }

        if (name !== undefined && !_commands[name]) throw new Error(`Unknown command "${name}"`);

        for (const [_cmd_name, _cmd] of Object.entries(_commands)) {
          if (name !== undefined && _cmd_name !== name) continue;

          if (_cmd_name) os.print(`${_cmd_name} - `);
          os.print(`${_cmd.desc}\n`);
          if (_cmd.args) {
            for (const arg of _cmd.args) {
              os.print("\t");
              os.print(arg.name || `<${arg.alias || arg.type}>`);
              if (arg.multiple) os.print("...");
              if (arg.desc) os.print(" - ", arg.desc);
              os.print(", ", arg.required ? "required" : "optional");
              os.print(", ", arg.type);
              if (arg.default) os.print(", default = ", arg.default.join(","));
              os.print("\n");
            }
            os.print(`\n`);
          }
        }
      },
    },
  };

  const _args = [...args];
  let _name = "";

  const _input = _args.at(0) || "";

  const names = Object.keys(_commands).filter((c) => (_input ? c.startsWith(_input) : c === ""));
  if (names.length > 1) throw new Error(`Multiple commands found: ${names.join(", ")}`);

  if (names.length === 0 && "" in _commands) names.push("");

  if (names.length === 0) {
    if (_input) {
      throw new Error(`Unknown command "${_input}". Use "--help" to list available.`);
    } else {
      throw new Error(`Use "--help" to list available commands.`);
    }
  }

  _name = names[0];
  if (_name) _args.shift();

  const cmd = _commands[_name];
  const parsed_args = cmd.args ? parse_args(cmd.args, _args) : {};
  await cmd.fn(_args, parsed_args);
}

export function format_net_error(err: number) {
  for (const [name, code] of Object.entries(NET_ERRORS)) {
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
