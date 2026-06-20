import z from "zod";
import { nd, type ND } from ".";
import type { TBridgeVlan } from "../../os/br";
import { INTERFACE_TYPES } from "../../os/net";
import { parseMAC } from "../../format";

const TYPE = "vlan";

const z_data = z.object({
  bridge_interface_id: z.string(),
  pvid: z.number(),
});

declare module "." {
  namespace ND {
    namespace Interface {
      interface TypesProps {
        [TYPE]: Bridge.VLAN.Props;
      }

      namespace Bridge {
        namespace VLAN {
          interface Props {
            bridge_interface: Interface.Item;
            pvid: number;
          }

          type Item = Interface.Item<typeof TYPE>;

          type Ref = {
            item: Item;
            vlan: TBridgeVlan;
          };

          type TSerialized = z.infer<typeof z_data>;

          type _T = {
            refs: Map<string, Ref>;

            add(item: Item): void;
          };
          interface T extends _T {}
        }

        interface T {
          vlan: VLAN.T;
        }
      }
    }
  }
}

const THIS: ND.Interface.Bridge.VLAN._T = {
  refs: new Map(),

  add(item) {
    const bridge = nd.interface.bridge.get(item.props.bridge_interface.id);
    if (!bridge) throw new Error("Bridge not found");

    const _br = nd.interface.bridge.bridge_map.get(bridge.id);
    if (!_br) throw new Error("OS Bridge not found");

    const _iface = nd.os.net.add_interface(INTERFACE_TYPES.VLAN, `vlan_${item.id}`, -1);
    _iface.mac = parseMAC(item.mac);

    const _vlan: TBridgeVlan = {
      iBridge: _br.iBridge,
      iVlan: _iface.index,
      vid: item.props.pvid,
    };

    const ref: ND.Interface.Bridge.VLAN.Ref = { item, vlan: _vlan };
    THIS.refs.set(item.id, ref);

    nd.interface.append(item, _iface);
  },
};

nd.interface.bridge.vlan = THIS as ND.Interface.Bridge.VLAN.T;

nd.interface.type_serializers[TYPE] = {
  weight: 310,
  serialize(item): ND.Interface.Bridge.VLAN.TSerialized {
    return {
      bridge_interface_id: item.props.bridge_interface.id,
      pvid: item.props.pvid,
    };
  },
  deserialize(item, data: ND.Interface.Bridge.VLAN.TSerialized) {
    z_data.parse(data);

    const bridge_interface = nd.interface.bridge.get(data.bridge_interface_id);
    if (!bridge_interface) throw new Error("Bridge not found");

    item.props = {
      bridge_interface,
      pvid: data.pvid,
    };

    THIS.add(item);
  },
};
