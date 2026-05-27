import { NET_ERRORS } from "../os/net";
import type { OS } from "../os/os";
import type { TSocket } from "../os/socket";
import type { TIP4Packet } from "../pack";

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

export async function run_command_of(record: Record<string, { fn: () => unknown; desc: string }>, cmd: string) {
  const cmds = Object.keys(record).filter((c) => c.startsWith(cmd));
  if (cmds.length > 1) throw new Error(`Multiple commands found: ${cmds.join(", ")}`);

  if (cmds.length === 0) {
    throw new Error(
      [
        "usage:",
        Object.keys(record)
          .map((c) => `\t${c} - ${record[c].desc}`)
          .join("\n"),
      ].join("\n"),
    );
  }

  await record[cmds[0]].fn();
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
  if (socket.state !== "established") throw new Error("Socket not opened");

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

export async function socket_read_raw(
  os: OS,
  socket: TSocket,
  signal?: AbortSignal,
  no_reject: boolean = false,
): Promise<TIP4Packet> {
  if (signal?.aborted) throw new Error("Aborted");
  if (socket.type !== "raw") throw new Error("Socket is not raw");

  return new Promise<TIP4Packet>((resolve, reject) => {
    socket.on_raw_recv = (recv) => resolve(recv.packet);
    if (!no_reject) {
      socket.on_error = (e) => reject(new Error(`Socket error ${format_net_error(e)}`));
    }
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
