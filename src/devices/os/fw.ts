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

export type TPacketContext = {
  conn?: TConnection;
  in?: number;
  out?: number;
};

export type TPredicate = {
  in?: number;
  out?: number;
  src?: number;
  dst?: number;
  protocol?: number;
};

export type TAction = { action: string; to_ip?: number; to_port?: number };

export type TCounters = { packets: number };

export type TRule = {
  table: string;
  chain: string;
  action: TAction;
  counters: TCounters;
} & TPredicate;

function _test_rule(rule: TRule, packet: TIP4Packet, ctx: TPacketContext) {
  if (rule.in !== undefined && rule.in !== ctx.in) return false;
  if (rule.out !== undefined && rule.out !== ctx.out) return false;

  const { header } = packet;
  if (rule.src !== undefined && rule.src !== header.src) return false;
  if (rule.dst !== undefined && rule.dst !== header.dst) return false;
  if (rule.protocol !== undefined && rule.protocol !== header.protocol) return false;

  return true;
}

export class Firewall {
  _table: TRule[] = [];

  constructor(public readonly ip4: IP4) {}

  add(table: string, chain: string, predicate: TPredicate, action: TAction) {
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

  private _handle_rules(table: string, chain: string, packet: TIP4Packet, ctx: TPacketContext): boolean {
    for (const rule of this._table) {
      if (rule.table !== table || rule.chain !== chain || !_test_rule(rule, packet, ctx)) continue;

      rule.counters.packets += 1;

      const { action: act } = rule.action;

      if (act === FW_ACTIONS.ACCEPT) {
        break;
      } else if (act === FW_ACTIONS.DROP) {
        return true;
      } else if (act === FW_ACTIONS.PASS) {
        continue;
      } else if (act === FW_ACTIONS.MASQUERADE) {
        this._masquerade(packet, ctx);
      } else if (act === FW_ACTIONS.SNAT) {
        this._snat(packet, ctx, rule.action);
      } else if (act === FW_ACTIONS.DNAT) {
        this._dnat(packet, ctx, rule.action);
      }

      break;
    }

    return false;
  }

  /** @returns true if drop needed */
  handle_chain(chain: string, packet: TIP4Packet, ctx: TPacketContext): boolean {
    if (chain === FW_CHAINS.PRE_ROUTING) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, ctx)) return true;
      ctx.conn = this.ip4.tracker.handle_packet(packet);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.DST_NAT) {
      if (ctx.conn) this._reverse_nat(packet, ctx.conn);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.INPUT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.FORWARD) {
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.OUTPUT) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, ctx)) return true;
      ctx.conn = this.ip4.tracker.handle_packet(packet);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.POST_ROUTING) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.SRC_NAT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    }

    return false;
  }

  private _reverse_nat(packet: TIP4Packet, conn: TConnection) {
    if (packet.header.dst === conn.reply_dst && conn.flags.src_nat) {
      packet.header.dst = conn.src;
    }

    // FIXME: port!

    if (packet.header.src === conn.reply_src && conn.flags.dst_nat) {
      packet.header.src = conn.dst;
    }

    // FIXME: port!
  }

  private _snat(packet: TIP4Packet, context: TPacketContext, action: TAction) {
    if (action.to_ip !== undefined) {
      packet.header.src = action.to_ip;

      if (context.conn) {
        context.conn.reply_dst = action.to_ip;
        context.conn.flags.src_nat = true;
      }
    }

    // FIXME: port!
  }

  private _dnat(packet: TIP4Packet, context: TPacketContext, action: TAction) {
    if (action.to_ip !== undefined) {
      packet.header.dst = action.to_ip;

      if (context.conn) {
        context.conn.reply_src = action.to_ip;
        context.conn.flags.dst_nat = true;
      }
    }

    // FIXME: port!
  }

  private _masquerade(packet: TIP4Packet, context: TPacketContext) {
    const { conn, out: outInterface } = context;
    if (!conn || outInterface === undefined) return;

    if (!conn.flags.dst_nat) {
      const iface = this.ip4.net._interfaces[outInterface];

      const [ip] = iface.ips;
      if (!ip) return;

      // FIXME: port!

      conn.reply_dst = ip.address;
      conn.flags.src_nat = true;
    }

    packet.header.src = conn.reply_dst;
  }
}
