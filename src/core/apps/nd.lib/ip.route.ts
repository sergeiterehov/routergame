import z from "zod";
import { type ND, nd_extend } from ".";
import { parseCIDRv4 } from "../../format";
import type { TRoute } from "../../os/ip4";

const z_data = z.object({
  ip__route: z.object({
    list: z.array(
      z.object({
        id: z.string(),
        network: z.string(),
        interface_id: z.string(),
        gateway: z.ipv4().optional(),
        src: z.ipv4().optional(),
        comment: z.string().optional(),
      }),
    ),
  }),
});

declare module "./" {
  export namespace ND {
    export interface Serialized extends IP.Route.Serialized {}

    export namespace IP {
      export interface T {
        route: Route.T;
      }

      export namespace Route {
        export type Data = {
          id: string;
          network: string;
          interface: Interface.Item;
          gateway?: string;
          src?: string;
          comment?: string;
          dynamic?: boolean;
        };

        export type Item = {
          data: Data;
          route: TRoute;
        };

        type _Serialize = z.infer<typeof z_data>;
        export interface Serialized extends _Serialize {}

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

nd_extend((nd) => {
  const THIS: ND.IP.Route._T = {
    map: new Map(),
    list: [],

    add(data) {
      const iface = nd.interface.iface_map.get(data.interface.id);
      if (!iface) throw new Error("Interface not found");

      const network = parseCIDRv4(data.network);
      const route: TRoute = {
        network: network.ip,
        prefix: network.prefix,
        iInterface: iface.index,
      };
      nd.os.net.ip4._routes.push(route);

      const item: ND.IP.Route.Item = {
        data,
        route,
      };
      THIS.map.set(data.id, item);
      THIS.list.push(item);
    },

    remove(id) {
      const item = THIS.map.get(id);
      if (!item) throw new Error("Route not found");

      nd.os.net.ip4._routes.splice(nd.os.net.ip4._routes.indexOf(item.route), 1);

      THIS.list.splice(THIS.list.indexOf(item), 1);
      THIS.map.delete(id);
    },
  };

  nd.ip.route = THIS as ND.IP.Route.T;

  nd.interface.hook.add((item, action) => {
    if (action === "before-remove") {
      for (const route of nd.ip.route.list) {
        if (route.data.interface !== item) continue;
        THIS.remove(route.data.id);
      }
    }
  });

  nd.serializers.push({
    serialize() {
      return {
        ip__route: {
          list: THIS.list
            .filter((r) => !r.data.dynamic)
            .map((r) => ({
              id: r.data.id,
              network: r.data.network,
              interface_id: r.data.interface.id,
              gateway: r.data.gateway,
              src: r.data.src,
              comment: r.data.comment,
            })),
        },
      };
    },
    deserialize(data) {
      z_data.parse(data);

      for (const route_data of data.ip__route.list) {
        const _interface = nd.interface.map.get(route_data.interface_id);
        if (!_interface) continue;

        const data: ND.IP.Route.Data = {
          id: route_data.id,
          network: route_data.network,
          interface: _interface,
          gateway: route_data.gateway,
          src: route_data.src,
          comment: route_data.comment,
        };

        nd.ip.route.add(data);
      }
    },
  });
});
