import { formatIPv4, formatTime } from "../format";
import { FW_ACTIONS, FW_CHAINS, FW_TABLES, type TPredicate } from "../os/fw";
import type { OS } from "../os/os";
import { IP_PROTOCOLS } from "../pack";
import { find_arg, run_command_of, test_args } from "./app_utils";

const TABLES = Object.values(FW_TABLES as object);
const CHAINS = Object.values(FW_CHAINS as object);
const ACTIONS = Object.values(FW_ACTIONS as object);

const _validate_table = (table: string) => {
  if (TABLES.includes(table)) return true;
  throw new Error(`Invalid table "${table}", use: ${TABLES.join(", ")}`);
};
const _validate_chain = (chain: string) => {
  if (CHAINS.includes(chain)) return true;
  throw new Error(`Invalid chain "${chain}", use: ${CHAINS.join(", ")}`);
};
const _validate_action = (action: string) => {
  if (ACTIONS.includes(action)) return true;
  throw new Error(`Invalid action "${action}", use: ${ACTIONS.join(", ")}`);
};
const _validate_int = (str: string) => /^\d+$/.test(str);

async function _connection(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  for (const c of os.net.ip4.tracker._table) {
    os.print(`${formatIPv4(c.src)}:${c.src_port} -> ${formatIPv4(c.dst)}:${c.dst_port} [`);
    if (c.protocol === IP_PROTOCOLS.TCP) {
      os.print("TCP");
    } else if (c.protocol === IP_PROTOCOLS.UDP) {
      os.print("UDP");
    } else if (c.protocol === IP_PROTOCOLS.ICMP) {
      os.print("ICMP");
    } else {
      os.print(c.protocol.toString());
    }
    os.print("]\n");
    os.print(`${formatIPv4(c.reply_dst)}:${c.reply_dst_port} <- ${formatIPv4(c.reply_src)}:${c.reply_src_port}\n`);

    if (c.protocol === IP_PROTOCOLS.ICMP && c.icmp) {
      os.print(`\ttype: ${c.icmp.type}\n`, `\tcode: ${c.icmp.code}\n`, `\tid: ${c.icmp.id}\n`);
    } else if (c.protocol === IP_PROTOCOLS.TCP && c.tcp) {
      os.print(`\tstate: ${c.tcp.state}\n`);
    }

    os.print(
      `\tflags: ${Object.entries(c.flags)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ")}\n`,
    );
    os.print("\ttimeout: ", formatTime(c.expires_at - Date.now()), "\n");
  }
}

async function _ls(os: OS, args: string[]) {
  if (args.length) throw new Error("No arguments expected");

  for (let i = 0; i < os.net.ip4.fw._table.length; i += 1) {
    const rule = os.net.ip4.fw._table[i];

    os.print(
      `${i + 1}) ${rule.chain} [${rule.action}]:\n`,
      [
        rule.inInterface !== undefined && `in_interface=${os.net.iface(rule.inInterface).name}`,
        rule.outInterface !== undefined && `out_interface=${os.net.iface(rule.outInterface).name}`,
        `PACKETS: ${rule.counters.packets}`,
      ]
        .filter(Boolean)
        .map((s) => `\t${s}`)
        .join("\n"),
      "\n",
    );
  }
}

async function _masquerade(os: OS, args: string[]) {
  if (args.length !== 1) throw new Error("Expected interface name");

  const iface_name = args[0];
  const iface = os.net.iface_by_name(iface_name);
  if (!iface) throw new Error(`Interface ${iface_name} not found`);

  os.net.ip4.fw.add(
    FW_TABLES.NAT,
    FW_CHAINS.SRC_NAT,
    {
      outInterface: iface.index,
    },
    FW_ACTIONS.MASQUERADE,
  );
}

async function _add(os: OS, args: string[]) {
  if (!test_args(args, _validate_table, _validate_chain, _validate_action)) {
    throw new Error("usage: <table> <chain> <action> [-in_interface name] [-out_interface name]");
  }

  const table = args.shift()!;
  const chain = args.shift()!;
  const action = args.shift()!;

  const predicate: TPredicate = {};

  const inInterface = os.net.iface_by_name(find_arg(args, "-in_interface"));
  if (inInterface) predicate.inInterface = inInterface.index;

  const outInterface = os.net.iface_by_name(find_arg(args, "-out_interface"));
  if (outInterface) predicate.inInterface = outInterface.index;

  os.net.ip4.fw.add(table, chain, predicate, action);
}

async function _rm(os: OS, args: string[]) {
  if (!test_args(args, _validate_int)) throw new Error("usage: <rule_number>");

  const number = Number.parseInt(args[0], 10);

  const length = os.net.ip4.fw._table.length;
  if (length < 1 || length > length) throw new Error(`Index out of range 1..${length}`);

  os.net.ip4.fw._table.splice(number - 1, 1);
}

async function _move(os: OS, args: string[]) {
  if (!test_args(args, _validate_int, "before", _validate_int)) {
    throw new Error("usage: <current_number> before <target_number>");
  }

  const current = Number.parseInt(args[0], 10);
  const target = Number.parseInt(args[2], 10);

  const length = os.net.ip4.fw._table.length;
  if (current < 1 || current > length || target < 1 || target > length + 1) {
    throw new Error(`Index out of range 1..${length}`);
  }

  if (current === target) return;

  const rule = os.net.ip4.fw._table[current - 1];
  os.net.ip4.fw._table.splice(current - 1, 1);

  if (target < current) {
    os.net.ip4.fw._table.splice(target - 1, 0, rule);
  } else {
    os.net.ip4.fw._table.splice(target - 2, 0, rule);
  }
}

export async function fw(os: OS, args: string[]) {
  await run_command_of(
    {
      ls: { desc: "show rules", fn: () => _ls(os, args.slice(1)) },
      connections: { desc: "show active connections", fn: () => _connection(os, args.slice(1)) },
      masquerade: { desc: "quick add masquerade rule for output interface", fn: () => _masquerade(os, args.slice(1)) },
      add: { desc: "add new rule", fn: () => _add(os, args.slice(1)) },
      rm: { desc: "remove rule", fn: () => _rm(os, args.slice(1)) },
      move: { desc: "change rule priority", fn: () => _move(os, args.slice(1)) },
    },
    args[0],
  );
}
