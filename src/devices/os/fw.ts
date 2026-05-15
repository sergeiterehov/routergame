import type { TIP4Packet } from "../pack";
import type { IP4 } from "./ip4";
import type { TConnection } from "./tracker";

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
  chain: string;
  action: string;
  counters: { packets: number };
} & TPredicate;

export type TPacketProps = { inInterface?: number; outInterface?: number; conn?: TConnection };

const _TESTING_PROPS: Record<keyof TPredicate, number> = {
  inInterface: 0,
  outInterface: 0,
};
const _TESTING_PROP_NAMES = Object.keys(_TESTING_PROPS) as (keyof TPredicate)[];

function _test_rule(rule: TRule, props: TPacketProps) {
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

  add(chain: string, predicate: TPredicate, action: string) {
    const new_rule: TRule = {
      chain,
      action,
      counters: { packets: 0 },
      ...predicate,
    };
    this._table.push(new_rule);
    return new_rule;
  }

  handle_chain(chain: string, packet: TIP4Packet, props: TPacketProps): boolean {
    for (const rule of this._table) {
      if (rule.chain !== chain || !_test_rule(rule, props)) continue;

      rule.counters.packets += 1;

      const { action } = rule;

      if (action === FW_ACTIONS.ACCEPT) {
        break;
      } else if (action === FW_ACTIONS.DROP) {
        return false;
      } else if (action === FW_ACTIONS.PASS) {
        continue;
      } else if (action === FW_ACTIONS.MASQUERADE) {
        this._masquerade(packet, props);
      }

      break;
    }

    return true;
  }

  _masquerade(packet: TIP4Packet, props: TPacketProps) {
    const { conn, outInterface } = props;
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
