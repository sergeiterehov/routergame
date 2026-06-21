import z from "zod";
import { nd_extend, type ND } from ".";
import type { TBridge } from "../../os/br";
import { INTERFACE_TYPES } from "../../os/net";
import "./interface";
import { parseMAC } from "../../format";

const TYPE = "bridge";

const z_data = z.object({
  pvid: z.number(),
  vlan_filtering: z.boolean(),
});

declare module "./" {
  export namespace ND {
    export namespace Interface {
      export interface T {
        bridge: Bridge.T;
      }

      export interface TypesProps {
        [TYPE]: Bridge.Props;
      }

      export namespace Bridge {
        export type Props = {
          pvid: number;
          vlan_filtering: boolean;
        };

        export type Item = Interface.Item<typeof TYPE>;

        export type TSerialized = z.infer<typeof z_data>;

        type _T = {
          bridge_map: Map<string, TBridge>;

          is_bridge(item: ND.Interface.Item): item is Item;

          get(id: string): Item | undefined;
          get_list(): Item[];

          add(item: Item): void;
          edit(id: string, update: Item): void;
          remove(id: string): void;
        };
        export interface T extends _T {}
      }
    }
  }
}

nd_extend((nd) => {
  const THIS: ND.Interface.Bridge._T = {
    bridge_map: new Map(),

    is_bridge(item): item is ND.Interface.Bridge.Item {
      return item.type === TYPE;
    },

    get(id) {
      const item = nd.interface.map.get(id);
      if (item && THIS.is_bridge(item)) return item;
    },
    get_list() {
      return nd.interface.list.filter(THIS.is_bridge);
    },

    add(item) {
      const iface = nd.os.net.add_interface(INTERFACE_TYPES.BRIDGE, `br_${item.id}`, -1);
      iface.mac = parseMAC(item.mac);
      iface.flags.UP = true;
      iface.flags.MASTER = true;
      iface.flags.RUNNING = true;

      const br: TBridge = { iBridge: iface.index, pvid: item.props.pvid, vlan_filtering: item.props.vlan_filtering };
      nd.os.net.br._bridges.push(br);

      THIS.bridge_map.set(item.id, br);

      nd.interface.append(item, iface);
    },
    edit(id, update) {
      const item = nd.interface.map.get(id);
      if (!item) throw new Error("Item not found");
      if (!THIS.is_bridge(item)) throw new Error("Item type mismatch");

      const iface = nd.interface.iface_map.get(id);
      if (!iface) throw new Error("Interface not found");

      const br = THIS.bridge_map.get(id);
      if (!br) throw new Error("Bridge not found");

      if (item.props.pvid !== update.props.pvid) {
        br.pvid = update.props.pvid;
        nd.os.net.br.fbd_clear(iface.index, undefined);

        item.props.pvid = update.props.pvid;
      }

      if (item.props.vlan_filtering !== update.props.vlan_filtering) {
        br.vlan_filtering = update.props.vlan_filtering;
        nd.os.net.br.fbd_clear(iface.index, undefined);

        item.props.vlan_filtering = update.props.vlan_filtering;
      }

      nd.interface.edit(id, update);
    },
    remove(id) {
      const item = nd.interface.map.get(id);
      if (!item) throw new Error("Item not found");
      if (!THIS.is_bridge(item)) throw new Error("Item type mismatch");

      const iface = nd.interface.iface_map.get(id);
      if (!iface) throw new Error("Interface not found");

      const br = THIS.bridge_map.get(id);
      if (!br) throw new Error("Bridge not found");

      nd.os.net.br._bridges.splice(nd.os.net.br._bridges.indexOf(br), 1);

      nd.os.net.br.fbd_clear(iface.index, undefined);

      nd.interface.remove(id);
    },
  };

  nd.interface.bridge = THIS as ND.Interface.Bridge.T;

  nd.interface.type_serializers[TYPE] = {
    weight: 300,
    serialize(item): ND.Interface.Bridge.TSerialized {
      return {
        pvid: item.props.pvid,
        vlan_filtering: item.props.vlan_filtering,
      };
    },
    deserialize(item, data: ND.Interface.Bridge.TSerialized) {
      z_data.parse(data);

      item.props = {
        pvid: data.pvid,
        vlan_filtering: data.vlan_filtering,
      };

      THIS.add(item);
    },
  };
});
