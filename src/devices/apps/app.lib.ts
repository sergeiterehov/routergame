import { NET_ERRORS } from "../os/net";

export function test_args(args: string[], ...ps: (string | ((arg: string) => unknown))[]) {
  if (ps.length > args.length) return false;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (typeof ps[i] === "string" && p === args[i]) continue;
    if (typeof p === "function" && p(args[i])) continue;
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
