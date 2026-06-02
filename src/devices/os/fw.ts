import {
  extract_ip_ports,
  ICMP_TYPES,
  inject_ip_ports,
  IP_PROTOCOLS,
  pack_icmp_packet,
  pack_ip4_packet,
  unpack_icmp_packet,
  unpack_ip4_packet,
  type TIP4Packet,
} from "../pack";
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
  untracked?: boolean;
  conn?: TConnection;
  state?: "new" | "established" | "invalid" | "related";
  in?: number;
  out?: number;
};

export type TPredicate = {
  in?: number[];
  out?: number[];
  src?: number[];
  dst?: number[];
  src_port?: number[];
  dst_port?: number[];
  protocol?: number[];
  state?: string[];
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
  if (rule.in !== undefined && !rule.in.includes(ctx.in!)) return false;
  if (rule.out !== undefined && !rule.out.includes(ctx.out!)) return false;

  if (rule.state !== undefined && !rule.state.includes(ctx.state!)) return false;

  const { header } = packet;
  if (rule.src !== undefined && !rule.src.includes(header.src!)) return false;
  if (rule.dst !== undefined && !rule.dst.includes(header.dst!)) return false;
  if (rule.protocol !== undefined && !rule.protocol.includes(header.protocol!)) return false;

  if (rule.src_port !== undefined || rule.dst_port !== undefined) {
    const { protocol } = header;
    if (protocol === IP_PROTOCOLS.TCP || protocol === IP_PROTOCOLS.UDP) {
      const ports = extract_ip_ports(packet);
      if (rule.src_port !== undefined && !rule.src_port.includes(ports.src)) return false;
      if (rule.dst_port !== undefined && !rule.dst_port.includes(ports.dst)) return false;
    }
  }

  return true;
}

const _ERRORS = {
  NO_PORT_AVAILABLE: 1,
} as const;

function _test_has_ports(packet: TIP4Packet) {
  const { protocol } = packet.header;
  return protocol === IP_PROTOCOLS.TCP || protocol === IP_PROTOCOLS.UDP;
}

export class Firewall {
  _enabled = false;

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
        const err = this._masquerade(packet, ctx);
        if (err) return true;
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
    if (!this._enabled) return false;

    if (chain === FW_CHAINS.PRE_ROUTING) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, ctx)) return true;
      this.ip4.tracker.handle_packet(packet, ctx);
      this._reverse_snat(packet, ctx);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.DST_NAT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.INPUT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.FORWARD) {
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.OUTPUT) {
      if (this._handle_rules(FW_TABLES.RAW, chain, packet, ctx)) return true;
      this.ip4.tracker.handle_packet(packet, ctx);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
      if (this._handle_rules(FW_TABLES.FILTER, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.POST_ROUTING) {
      this._reverse_dnat(packet, ctx);
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    } else if (chain === FW_CHAINS.SRC_NAT) {
      if (this._handle_rules(FW_TABLES.NAT, chain, packet, ctx)) return true;
    }

    return false;
  }

  private _reverse_snat(packet: TIP4Packet, ctx: TPacketContext) {
    const { conn } = ctx;
    if (!conn) return;

    const has_port = _test_has_ports(packet);

    const { dst } = packet.header;
    let dst_port = conn.reply_dst_port;
    if (has_port) {
      const ports = extract_ip_ports(packet);
      dst_port = ports.dst;
    }

    if (conn.flags.src_nat && dst === conn.reply_dst && dst_port === conn.reply_dst_port) {
      packet.header.dst = conn.src;
      if (has_port) inject_ip_ports(packet, { dst: conn.src_port });
    }

    if (packet.header.protocol === IP_PROTOCOLS.ICMP) {
      const icmp = unpack_icmp_packet(packet.payload);
      if (icmp.type === ICMP_TYPES.DEST_UNREACHABLE || icmp.type === ICMP_TYPES.TIME_EXCEEDED) {
        const src_packet = unpack_ip4_packet(icmp.payload);
        const src_has_port = _test_has_ports(src_packet);

        let src_src_port = conn.reply_src_port;
        if (src_has_port) {
          const ports = extract_ip_ports(src_packet);
          src_src_port = ports.src;
        }

        if (conn.flags.src_nat && src_packet.header.src === conn.reply_dst && src_src_port === conn.reply_dst_port) {
          src_packet.header.src = conn.src;
          if (src_has_port) inject_ip_ports(src_packet, { src: conn.src_port });

          icmp.payload = pack_ip4_packet(src_packet);
          packet.payload = pack_icmp_packet(icmp);
        }
      }
    }
  }

  private _reverse_dnat(packet: TIP4Packet, ctx: TPacketContext) {
    const { conn } = ctx;
    if (!conn) return;

    const has_port = _test_has_ports(packet);

    const { src } = packet.header;
    let src_port = conn.reply_src_port;
    if (has_port) {
      const ports = extract_ip_ports(packet);
      src_port = ports.src;
    }

    if (conn.flags.dst_nat && src === conn.reply_src && src_port === conn.reply_src_port) {
      packet.header.src = conn.dst;
      if (has_port) inject_ip_ports(packet, { src: conn.dst_port });
    }

    if (packet.header.protocol === IP_PROTOCOLS.ICMP) {
      const icmp = unpack_icmp_packet(packet.payload);
      if (icmp.type === ICMP_TYPES.DEST_UNREACHABLE || icmp.type === ICMP_TYPES.TIME_EXCEEDED) {
        const src_packet = unpack_ip4_packet(icmp.payload);
        const src_has_port = _test_has_ports(src_packet);

        let src_dst_port = conn.reply_dst_port;
        if (src_has_port) {
          const ports = extract_ip_ports(src_packet);
          src_dst_port = ports.dst;
        }

        if (conn.flags.dst_nat && src_packet.header.dst === conn.reply_src && src_dst_port === conn.reply_src_port) {
          src_packet.header.dst = conn.dst;
          if (src_has_port) inject_ip_ports(src_packet, { dst: conn.dst_port });

          icmp.payload = pack_ip4_packet(src_packet);
          packet.payload = pack_icmp_packet(icmp);
        }
      }
    }
  }

  private _snat(packet: TIP4Packet, context: TPacketContext, action: TAction) {
    if (action.to_ip !== undefined) {
      packet.header.src = action.to_ip;

      if (context.conn) {
        context.conn.reply_dst = action.to_ip;
        context.conn.flags.src_nat = true;
      }
    }

    if (action.to_port !== undefined) {
      if (_test_has_ports(packet)) inject_ip_ports(packet, { src: action.to_port });
    }
  }

  private _dnat(packet: TIP4Packet, context: TPacketContext, action: TAction) {
    if (action.to_ip !== undefined) {
      packet.header.dst = action.to_ip;

      if (context.conn) {
        context.conn.reply_src = action.to_ip;
        context.conn.flags.dst_nat = true;
      }
    }

    if (action.to_port !== undefined) {
      if (_test_has_ports(packet)) inject_ip_ports(packet, { dst: action.to_port });
    }
  }

  private _masquerade(packet: TIP4Packet, context: TPacketContext) {
    const { conn, out: outInterface } = context;
    if (!conn || outInterface === undefined) return;

    const has_port = _test_has_ports(packet);

    if (!conn.flags.src_nat) {
      const iface = this.ip4.net._interfaces[outInterface];

      const [ip] = iface.ips;
      if (!ip) return;

      if (has_port) {
        const { protocol } = packet.header;
        let { src: src_port } = extract_ip_ports(packet);
        port_searching: for (let _try = 30; _try >= 0; _try -= 1) {
          if (!_try) return _ERRORS.NO_PORT_AVAILABLE;

          let busy = false;
          for (const c of this.ip4.tracker._table) {
            if (c.protocol !== protocol) continue;
            if (c.reply_dst_port !== src_port) continue;
            if (c === conn) continue;

            busy = true;
            break;
          }

          if (!busy) break port_searching;

          // TODO: check busy ports (socket, ...)
          src_port = Math.round(0x1000 + Math.random() * 0xefff);
        }

        conn.reply_dst_port = src_port;
      }

      conn.flags.src_nat = true;
      conn.reply_dst = ip.address;
    }

    packet.header.src = conn.reply_dst;
    if (has_port && conn.src_port !== conn.reply_dst_port) {
      inject_ip_ports(packet, { src: conn.reply_dst_port });
    }
  }
}
