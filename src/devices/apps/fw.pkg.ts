import { formatIPv4, formatTime, parseIPv4, validate_ip, validate_port } from "../format";
import { FW_ACTIONS, FW_CHAINS, FW_TABLES, type TAction, type TPredicate } from "../os/fw";
import type { OS } from "../os/os";
import { IP_PROTOCOLS } from "../pack";
import { find_arg, find_args, run_command_of, test_args } from "./app.lib";

const PROTOCOL_NAMES = Object.fromEntries(Object.entries(IP_PROTOCOLS).map(([k, v]) => [v, k]));

const TABLES = Object.values(FW_TABLES as object);
const CHAINS = Object.values(FW_CHAINS as object);
const ACTIONS = Object.values(FW_ACTIONS as object);
const STATES = ["new", "established", "related", "invalid"];

const CHAINS_BY_TABLE: Record<string, string[]> = {
  [FW_TABLES.RAW]: [FW_CHAINS.PRE_ROUTING, FW_CHAINS.OUTPUT],
  [FW_TABLES.NAT]: [
    FW_CHAINS.INPUT,
    FW_CHAINS.OUTPUT,
    FW_CHAINS.DST_NAT,
    FW_CHAINS.SRC_NAT,
    FW_CHAINS.PRE_ROUTING,
    FW_CHAINS.POST_ROUTING,
  ],
  [FW_TABLES.FILTER]: [FW_CHAINS.INPUT, FW_CHAINS.FORWARD, FW_CHAINS.PRE_ROUTING, FW_CHAINS.OUTPUT],
};

const ACTIONS_BY_TABLE: Record<string, string[]> = {
  [FW_TABLES.RAW]: [FW_ACTIONS.PASS, FW_ACTIONS.ACCEPT, FW_ACTIONS.DROP],
  [FW_TABLES.NAT]: [FW_ACTIONS.PASS, FW_ACTIONS.MASQUERADE, FW_ACTIONS.SNAT, FW_ACTIONS.DNAT],
  [FW_TABLES.FILTER]: [FW_ACTIONS.PASS, FW_ACTIONS.ACCEPT, FW_ACTIONS.DROP],
};

const _validate_table = (table: string) => {
  if (TABLES.includes(table)) return true;
  throw new Error(`Invalid table "${table}", use: ${TABLES.join(", ")}`);
};
const _validate_chain = (chain: string) => {
  if (CHAINS.includes(chain)) return true;
  throw new Error(`Invalid chain "${chain}", use: ${CHAINS.join(", ")}`);
};
const _validate_chain_by_table = (table: string) => (chain: string) => {
  if (CHAINS_BY_TABLE[table].includes(chain)) return true;
  throw new Error(`Invalid chain "${chain}", use: ${CHAINS_BY_TABLE[table].join(", ")}`);
};
const _validate_action = (action: string) => {
  if (ACTIONS.includes(action)) return true;
  throw new Error(`Invalid action "${action}", use: ${ACTIONS.join(", ")}`);
};
const _validate_action_by_table = (table: string) => (action: string) => {
  if (ACTIONS_BY_TABLE[table].includes(action)) return true;
  throw new Error(`Invalid action "${action}", use: ${ACTIONS_BY_TABLE[table].join(", ")}`);
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

    const action = [
      rule.action.action,
      rule.action.to_ip !== undefined && `ip=${formatIPv4(rule.action.to_ip)}`,
      rule.action.to_port !== undefined && `port=${rule.action.to_port}`,
    ]
      .filter(Boolean)
      .join(" ");

    os.print(
      `${i + 1}) ${rule.table} ${rule.chain} [${action}]:\n`,
      [
        rule.in !== undefined && `in=${rule.in.map((v) => os.net.iface(v).name).join(",")}`,
        rule.out !== undefined && `out=${rule.out.map((v) => os.net.iface(v).name).join(",")}`,
        rule.src !== undefined && `src=${rule.src.map((v) => formatIPv4(v)).join(",")}`,
        rule.dst !== undefined && `dst=${rule.dst.map((v) => formatIPv4(v)).join(",")}`,
        rule.protocol !== undefined && `proto=${rule.protocol.map((v) => PROTOCOL_NAMES[v] || v).join(",")}`,
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
      out: [iface.index],
    },
    { action: FW_ACTIONS.MASQUERADE },
  );
}

async function _add(os: OS, args: string[]) {
  if (!test_args(args, _validate_table, _validate_chain_by_table(args[0]), _validate_action_by_table(args[0]))) {
    throw new Error(
      "usage: <table> <chain> <action> " +
        [
          // predicates
          "[-in name]",
          "[-out name]",
          "[-src ip]",
          "[-dst ip]",
          "[-src-port number]",
          "[-dst-port number]",
          `[-state ${STATES.join("|")}]`,
          "[-protocol icmp|udp|tcp]",
          "[-to-ip ip]",
          "[-to-port ip]",
        ].join(" "),
    );
  }

  const table = args.shift()!;
  const chain = args.shift()!;
  const action_action = args.shift()!;

  const predicate: TPredicate = {};
  const action: TAction = { action: action_action };

  const in_args = find_args(args, "-in");
  for (const in_arg in in_args) {
    const iface = os.net.iface_by_name(in_arg);
    if (!iface) throw new Error(`Interface ${in_arg} not found`);
    predicate.in ||= [];
    predicate.in.push(iface.index);
  }

  const out_args = find_args(args, "-out");
  for (const out_arg in out_args) {
    const iface = os.net.iface_by_name(out_arg);
    if (!iface) throw new Error(`Interface ${out_arg} not found`);
    predicate.out ||= [];
    predicate.out.push(iface.index);
  }

  const src_args = find_args(args, "-src");
  for (const src_arg in src_args) {
    if (!validate_ip(src_arg)) throw new Error(`Invalid src IP address ${src_arg}`);
    predicate.src ||= [];
    predicate.src.push(parseIPv4(src_arg));
  }

  const src_port_args = find_args(args, "-src-port");
  for (const src_port_arg in src_port_args) {
    if (!validate_port(src_port_arg)) throw new Error(`Invalid src port ${src_port_arg}`);
    predicate.src_port ||= [];
    predicate.src_port.push(Number.parseInt(src_port_arg));
  }

  const dst_args = find_args(args, "-dst");
  for (const dst_arg in dst_args) {
    if (!validate_ip(dst_arg)) throw new Error(`Invalid dst IP address ${dst_arg}`);
    predicate.dst ||= [];
    predicate.dst.push(parseIPv4(dst_arg));
  }

  const dst_port_args = find_args(args, "-dst-port");
  for (const dst_port_arg in dst_port_args) {
    if (!validate_port(dst_port_arg)) throw new Error(`Invalid src port ${dst_port_arg}`);
    predicate.dst_port ||= [];
    predicate.dst_port.push(Number.parseInt(dst_port_arg));
  }

  const protocol_args = find_args(args, "-protocol");
  for (const protocol_arg of protocol_args) {
    predicate.protocol ||= [];
    if (protocol_arg === "icmp") {
      predicate.protocol.push(IP_PROTOCOLS.ICMP);
    } else if (protocol_arg === "udp") {
      predicate.protocol.push(IP_PROTOCOLS.UDP);
    } else if (protocol_arg === "tcp") {
      predicate.protocol.push(IP_PROTOCOLS.TCP);
    } else {
      throw new Error(`Invalid protocol ${protocol_arg}`);
    }
  }

  const state_args = find_args(args, "-state");
  for (const state_arg of state_args) {
    if (STATES.includes(state_arg)) {
      predicate.state ||= [];
      predicate.state.push(state_arg);
    } else {
      throw new Error(`Invalid state ${state_arg}, allowed: ${STATES.join()}`);
    }
  }

  const to_ip_arg = find_arg(args, "-to-ip");
  if (to_ip_arg) {
    if (!validate_ip(to_ip_arg)) throw new Error(`Invalid target IP address ${to_ip_arg}`);
    action.to_ip = parseIPv4(to_ip_arg);
  }

  const to_port_arg = find_arg(args, "-to-port");
  if (to_port_arg) {
    const port = Number.parseInt(to_port_arg, 10);
    if (port <= 0 || port > 0xffff) throw new Error(`Invalid target port ${to_port_arg}`);
    action.to_port = parseIPv4(to_port_arg);
  }

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

async function _enable(os: OS, _args: string[]) {
  os.net.ip4.fw._enabled = true;
  os.print("Firewall enabled\n");
}

export async function fw(os: OS, args: string[]) {
  await run_command_of(
    {
      enable: { desc: "enable firewall", fn: () => _enable(os, args.slice(1)) },
      ls: { desc: "show rules", fn: () => _ls(os, args.slice(1)) },
      connections: { desc: "show active connections", fn: () => _connection(os, args.slice(1)) },
      masquerade: {
        desc: "quick add masquerade rule for output interface",
        fn: () => _masquerade(os, args.slice(1)),
      },
      add: { desc: "add new rule", fn: () => _add(os, args.slice(1)) },
      rm: { desc: "remove rule", fn: () => _rm(os, args.slice(1)) },
      move: { desc: "change rule priority", fn: () => _move(os, args.slice(1)) },
    },
    args[0],
  );
}
