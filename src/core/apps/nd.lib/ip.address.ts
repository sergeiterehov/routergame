import z from "zod";
import { nd, type ND } from ".";
import { applyPrefix, formatCIDRv4, parseCIDRv4 } from "../../format";
import type { TIP4 } from "../../os/net";
import "./ip";
import { NDUtils } from "./utils";

const z_data = z.object({
  ip__address: z.object({
    list: z.array(
      z.object({
        id: z.string(),
        address: z.string(),
        interface_id: z.string(),
        comment: z.string().optional(),
      }),
    ),
  }),
});

declare module "./" {
  export namespace ND {
    export interface Serialized extends IP.Address.Serialized {}

    export namespace IP {
      export interface T {
        address: Address.T;
      }

      export namespace Address {
        export type Data = {
          id: string;
          address: string;
          interface: Interface.Item;
          comment?: string;
          dynamic?: boolean;
        };

        export type Item = {
          data: Data;
          address: TIP4;
          route: Route.Data;
        };

        type _Serialized = z.infer<typeof z_data>;
        export interface Serialized extends _Serialized {}

         type _T = {
          map: Map<string, Item>;
          list: Item[];
          add(data: Data): void;
          remove(id: string): void;
        };
        export interface T extends _T {}
      }
    }
  }
}

const THIS: ND.IP.Address._T = {
  list: [],
  map: new Map(),

  add(data: ND.IP.Address.Data) {
    const iface = nd.interface.iface_map.get(data.interface.id);
    if (!iface) throw new Error("Interface not found");

    const address = parseCIDRv4(data.address);
    iface.ips.push(address);

    const route: ND.IP.Route.Data = {
      id: NDUtils.rand_id(),
      dynamic: true,
      interface: data.interface,
      network: formatCIDRv4({ ip: applyPrefix(address.ip, address.prefix), prefix: address.prefix }),
    };

    const item: ND.IP.Address.Item = { data, address, route };
    THIS.list.push(item);
    THIS.map.set(data.id, item);

    nd.ip.route.add(route);
  },

  remove(id) {
    const item = THIS.map.get(id);
    if (!item) throw new Error("Address not found");

    const iface = nd.interface.iface_map.get(item.data.interface.id);
    if (!iface) throw new Error("Interface not found");

    nd.ip.route.remove(item.route.id);

    iface.ips.splice(iface.ips.indexOf(item.address), 1);

    THIS.list.splice(THIS.list.indexOf(item), 1);
    THIS.map.delete(id);
  },
};

nd.ip.address = THIS as ND.IP.Address.T;

nd.serializers.push({
  serialize() {
    return {
      ip__address: {
        list: THIS.list
          .filter((i) => !i.data.dynamic)
          .map((i) => ({
            id: i.data.id,
            address: i.data.address,
            interface_id: i.data.interface.id,
            comment: i.data.comment,
          })),
      },
    };
  },
  deserialize(data) {
    z_data.parse(data);

    for (const ip of data.ip__address.list) {
      const _interface = nd.interface.map.get(ip.interface_id);
      if (!_interface) continue;

      const data: ND.IP.Address.Data = {
        id: ip.id,
        address: ip.address,
        comment: ip.comment,
        interface: _interface,
      };

      THIS.add(data);
    }
  },
});
