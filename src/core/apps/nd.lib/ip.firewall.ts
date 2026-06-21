import z from "zod";
import { FW_ACTIONS, FW_CHAINS, FW_CONN_STATES, FW_TABLES, type TRule } from "../../os/fw";
import { nd, type ND } from ".";
import { parseIPv4 } from "../../format";

const z_rule = z.object({
  id: z.string(),
  comment: z.string().optional(),
  table: z.enum(Object.values(FW_TABLES)),
  chain: z.enum(Object.values(FW_CHAINS)),
  action: z.union([
    z.object({ type: z.literal(FW_ACTIONS.PASS) }),
    z.object({ type: z.literal(FW_ACTIONS.ACCEPT) }),
    z.object({ type: z.literal(FW_ACTIONS.DROP) }),
    z.object({ type: z.literal(FW_ACTIONS.SNAT), ip: z.ipv4().optional(), port: z.number().optional() }),
    z.object({ type: z.literal(FW_ACTIONS.DNAT), ip: z.ipv4().optional(), port: z.number().optional() }),
    z.object({ type: z.literal(FW_ACTIONS.MASQUERADE) }),
  ]),
  in_interface_ids: z.array(z.string()).optional(),
  out_interface_ids: z.array(z.string()).optional(),
  src: z.array(z.ipv4()).optional(),
  dst: z.array(z.ipv4()).optional(),
  protocol: z.array(z.number()).optional(),
  src_port: z.array(z.number()).optional(),
  dst_port: z.array(z.number()).optional(),
  state: z.array(z.enum(Object.values(FW_CONN_STATES))).optional(),
});

const z_data = z.object({
  ip__firewall: z.object({
    list: z.array(z_rule),
  }),
});

type TSerializedRule = z.infer<typeof z_rule>;

declare module "." {
  namespace ND {
    interface Serialized extends IP.Firewall.Serialized {}

    namespace IP {
      namespace Firewall {
        type Data = {
          id: string;
          dynamic?: boolean;
          comment?: string;
          table: (typeof FW_TABLES)[keyof typeof FW_TABLES];
          chain: (typeof FW_CHAINS)[keyof typeof FW_CHAINS];
          action: {
            action: (typeof FW_ACTIONS)[keyof typeof FW_ACTIONS];
            to_ip?: string;
            to_port?: number;
          };
          in_interface?: Interface.Item[];
          out_interface?: Interface.Item[];
          src?: string[];
          dst?: string[];
          protocol?: number[];
          src_port?: number[];
          dst_port?: number[];
          state?: (typeof FW_CONN_STATES)[keyof typeof FW_CONN_STATES][];
        };

        interface Item {
          data: Data;
          rule: TRule;
        }

        type _Serialized = z.infer<typeof z_data>;
        interface Serialized extends _Serialized {}

        type _T = {
          map: Map<string, Item>;
          list: Item[];

          add(item: Data): void;
        };
        interface T extends _T {}
      }

      interface T {
        firewall: Firewall.T;
      }
    }
  }
}

const THIS: ND.IP.Firewall._T = {
  map: new Map(),
  list: [],

  add(data) {
    const _rule = nd.os.net.ip4.fw.add(
      data.table,
      data.chain,
      {
        in: data.in_interface?.map((i) => nd.interface.iface_map.get(i.id)!.index),
        out: data.out_interface?.map((i) => nd.interface.iface_map.get(i.id)!.index),
        src: data.src?.map((i) => parseIPv4(i)),
        dst: data.dst?.map((i) => parseIPv4(i)),
        protocol: data.protocol?.flat(),
        src_port: data.src_port?.flat(),
        dst_port: data.dst_port?.flat(),
        state: data.state?.flat(),
      },
      {
        action: data.action.action,
        to_ip: data.action.to_ip ? parseIPv4(data.action.to_ip) : undefined,
        to_port: data.action.to_port,
      },
    );

    nd.os.net.ip4.fw._enabled = true;

    const item: ND.IP.Firewall.Item = {
      data,
      rule: _rule,
    };
    THIS.map.set(data.id, item);
    THIS.list.push(item);
  },
};

nd.ip.firewall = THIS as ND.IP.Firewall.T;

nd.interface.hook.add((item, action) => {
  if (action === "before-remove") {
    for (const {
      data: { in_interface, out_interface },
    } of nd.ip.firewall.list) {
      if (!in_interface?.includes(item) && !out_interface?.includes(item)) continue;
      throw new Error("Interface is used in firewall rules, cannot remove");
    }
  }
});

nd.serializers.push({
  serialize(): ND.IP.Firewall.Serialized {
    return {
      ip__firewall: {
        list: THIS.list
          .filter((i) => !i.data.dynamic)
          .map(
            ({ data }): TSerializedRule => ({
              id: data.id,
              comment: data.comment,
              table: data.table,
              chain: data.chain,
              action: {
                type: data.action.action,
                ip: data.action.to_ip,
                port: data.action.to_port,
              },
              in_interface_ids: data.in_interface?.map((i) => i.id),
              out_interface_ids: data.out_interface?.map((i) => i.id),
              src: data.src?.flat(),
              dst: data.dst?.flat(),
              protocol: data.protocol?.flat(),
              src_port: data.src_port?.flat(),
              dst_port: data.dst_port?.flat(),
              state: data.state?.flat(),
            }),
          ),
      },
    };
  },
  deserialize(data: ND.IP.Firewall.Serialized) {
    z_data.parse(data);

    for (const rule_data of data.ip__firewall.list) {
      const rule: ND.IP.Firewall.Data = {
        id: rule_data.id,
        comment: rule_data.comment,
        table: rule_data.table,
        chain: rule_data.chain,
        action: {
          action: rule_data.action.type,
          to_ip: "ip" in rule_data.action ? rule_data.action.ip : undefined,
          to_port: "port" in rule_data.action ? rule_data.action.port : undefined,
        },
        in_interface: rule_data.in_interface_ids?.map((id) => nd.interface.map.get(id)!).filter(Boolean),
        out_interface: rule_data.out_interface_ids?.map((id) => nd.interface.map.get(id)!).filter(Boolean),
        src: rule_data.src?.flat(),
        dst: rule_data.dst?.flat(),
        protocol: rule_data.protocol?.flat(),
        src_port: rule_data.src_port?.flat(),
        dst_port: rule_data.dst_port?.flat(),
        state: rule_data.state?.flat(),
      };

      THIS.add(rule);
    }
  },
});
