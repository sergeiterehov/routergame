import type { TIP4Packet } from "../pack";
import type { IP4 } from "./ip4";
import type { TConnection } from "./tracker";

export const FW_TABLES = {
  RAW: "raw",
  FILTER: "filter",
  NAT: "nat",
} as const;

export const FW_CHAINS = {
  INPUT: "input",
  OUTPUT: "output",
  FORWARD: "forward",
  PRE_ROUTING: "prerouting",
  POST_ROUTING: "postrouting",
  SRC_NAT: "src-nat",
  DST_NAT: "dst-nat",
} as const;

export const FW_ACTIONS = {
  PASS: "pass",
  ACCEPT: "accept",
  DROP: "drop",
  MASQUERADE: "masquerade",
  SNAT: "snat",
  DNAT: "dnat",
} as const;

export type TPredicate = { inInterface?: number; outInterface?: number };

export type TRule = {
  table: string;
  chain: string;
  action: string;
  counters: { packets: number };
} & TPredicate;

export type TPacketContext = { inInterface?: number; outInterface?: number; conn?: TConnection };

const _TESTING_PROPS: Record<keyof TPredicate, number> = {
  inInterface: 0,
  outInterface: 0,
};
const _TESTING_PROP_NAMES = Object.keys(_TESTING_PROPS) as (keyof TPredicate)[];

function _test_rule(rule: TRule, props: TPacketContext) {
  for (const key of _TESTING_PROP_NAMES) {
    const target = rule[key];
    if (target === undefined) continue;
    if (target !== props[key]) return false;
  }
  return true;
}

export class Firewall {
  _table: TRule[] = [];

  constructor(public readonly ip4: IP4) {}

  add(table: string, chain: string, predicate: TPredicate, action: string) {
    const new_rule: TRule = {
      table,
      chain,
      action,
      counters: { packets: 0 },
      ...predicate,
    };
    this._table.push(new_rule);
    return new_rule;
  }

  private _handle_rules(table: string, chain: string, packet: TIP4Packet, context: TPacketContext): boolean {
    for (const rule of this._table) {
      if (rule.table !== table || rule.chain !== chain || !_test_rule(rule, context)) continue;

      rule.counters.packets += 1;

      const { action } = rule;

      if (action === FW_ACTIONS.ACCEPT) {
        break;
      } else if (action === FW_ACTIONS.DROP) {
        return true;
      } else if (action === FW_ACTIONS.PASS) {
        continue;
      } else if (action === FW_ACTIONS.MASQUERADE) {
        this._masquerade(packet, context);
      }

      break;
    }

    return false;
  }

  /** @returns true if drop needed */
  handle_chain(chain: string, packet: TIP4Packet, context: TPacketContext): boolean {
    if (chain === FW_CHAINS.PRE_ROUTING) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, context)) return true;
      context.conn = this.ip4.tracker.handle_packet(packet);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.DST_NAT) {
      if (context.conn) this._reverse_nat(packet, context.conn);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.INPUT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.FORWARD) {
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.OUTPUT) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, context)) return true;
      context.conn = this.ip4.tracker.handle_packet(packet);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.POST_ROUTING) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
    } else if (chain === FW_CHAINS.SRC_NAT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, context)) return true;
    }

    return false;
  }

  private _reverse_nat(packet: TIP4Packet, conn: TConnection) {
    if (packet.header.dst === conn.reply_dst && conn.flags.src_nat) {
      packet.header.dst = conn.src;
    }
  }

  private _masquerade(packet: TIP4Packet, context: TPacketContext) {
    const { conn, outInterface } = context;
    if (!conn || outInterface === undefined) return;

    if (!conn.flags.dst_nat) {
      const iface = this.ip4.net._interfaces[outInterface];

      const [ip] = iface.ips;
      if (!ip) return;

      conn.reply_dst = ip.address;
      conn.flags.src_nat = true;
    }

    packet.header.src = conn.reply_dst;
  }
}
