import z from "zod";
import { nd_extend, type ND } from ".";
import type { TBridgePort } from "../../os/br";

const z_data = z.object({
  interface__bridge__port: z.object({
    list: z.array(
      z.object({
        id: z.string(),
        bridge_interface_id: z.string(),
        port_interface_id: z.string(),
        pvid: z.number(),
        tagged: z.array(z.number()),
        untagged: z.array(z.number()),
        comment: z.string().optional(),
      }),
    ),
  }),
});

declare module "." {
  export namespace ND {
    export interface Serialized extends Interface.Bridge.Port.Serialized {}

    export namespace Interface {
      export namespace Bridge {
        export namespace Port {
          export type Data = {
            id: string;
            bridge_interface: Bridge.Item;
            port_interface: Interface.Item;
            pvid: number;
            tagged: number[];
            untagged: number[];
            comment?: string;
            dynamic?: boolean;
          };

          export type Item = {
            data: Data;
            ref: TBridgePort;
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

        export interface T {
          port: Port.T;
        }
      }
    }
  }
}

nd_extend((nd) => {
  const THIS: ND.Interface.Bridge.Port._T = {
    map: new Map(),
    list: [],

    add(data) {
      const br_iface = nd.interface.iface_map.get(data.bridge_interface.id);
      if (!br_iface) throw new Error("Bridge interface not found");

      const bridge = nd.interface.bridge.bridge_map.get(data.bridge_interface.id);
      if (!bridge) throw new Error("Bridge not found");

      const port_iface = nd.interface.iface_map.get(data.port_interface.id);
      if (!port_iface) throw new Error("Port interface not found");

      if (port_iface.iMasterInterface !== undefined) throw new Error("Port is slave");

      try {
        nd.os.net.br.get_port(port_iface.index);
        throw new Error("Port already exists");
      } catch {
        // OK
      }

      const _port: TBridgePort = {
        iBridge: br_iface.index,
        iPort: port_iface.index,
        pvid: data.pvid,
        tagged: data.tagged,
        untagged: data.untagged,
      };

      port_iface.iMasterInterface = br_iface.index;
      port_iface.flags.SLAVE = true;
      port_iface.flags.PROMISC = true;

      if (!br_iface.mac && port_iface.mac) {
        nd.os.net.change_mac(br_iface.index, port_iface.mac);
      }

      nd.os.net.br._ports.push(_port);

      const item: ND.Interface.Bridge.Port.Item = {
        data,
        ref: _port,
      };
      THIS.map.set(data.id, item);
      THIS.list.push(item);
    },

    remove(id) {
      const item = THIS.map.get(id);
      if (!item) throw new Error("Port not found");

      const port_iface = nd.interface.iface_map.get(item.data.port_interface.id);
      if (!port_iface) throw new Error("Port interface not found");

      delete port_iface.iMasterInterface;
      delete port_iface.flags.SLAVE;
      delete port_iface.flags.PROMISC;

      nd.os.net.br._ports.splice(nd.os.net.br._ports.indexOf(item.ref), 1);

      // clear fdb
      nd.os.net.br.fbd_clear(undefined, port_iface.index);
    },
  };

  nd.interface.bridge.port = THIS as ND.Interface.Bridge.Port.T;

  nd.serializers.push({
    serialize() {
      return {
        interface__bridge__port: {
          list: THIS.list
            .filter((p) => !p.data.dynamic)
            .map((p) => ({
              id: p.data.id,
              bridge_interface_id: p.data.bridge_interface.id,
              port_interface_id: p.data.port_interface.id,
              pvid: p.data.pvid,
              tagged: p.data.tagged,
              untagged: p.data.untagged,
              comment: p.data.comment,
            })),
        },
      };
    },
    deserialize(data) {
      z_data.parse(data);

      for (const port_data of data.interface__bridge__port.list) {
        const bridge_interface = nd.interface.bridge.get(port_data.bridge_interface_id);
        if (!bridge_interface) continue;

        const port_interface = nd.interface.map.get(port_data.port_interface_id);
        if (!port_interface) continue;

        const data: ND.Interface.Bridge.Port.Data = {
          id: port_data.id,
          bridge_interface,
          port_interface,
          pvid: port_data.pvid,
          tagged: port_data.tagged,
          untagged: port_data.untagged,
          comment: port_data.comment,
        };

        THIS.add(data);
      }
    },
  });
});
