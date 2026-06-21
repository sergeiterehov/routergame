import z from "zod";
import { nd_extend, type ND } from ".";
import { formatMAC } from "../../format";
import { INTERFACE_TYPES } from "../../os/net";
import { NDUtils } from "./utils";

const TYPE = "ethernet";

const z_data = z.object({
  default_name: z.string(),
});

declare module "./" {
  export namespace ND {
    export namespace Interface {
      export interface T {
        ethernet: Ethernet.T;
      }

      export interface TypesProps {
        [TYPE]: Ethernet.Props;
      }

      export namespace Ethernet {
        export type Props = {
          default_name: string;
        };

        export type Item = Interface.Item<typeof TYPE>;

        export type TSerialized = z.infer<typeof z_data>;

        type _T = {
          init(): void;
          edit(id: string, update: Item): void;
        };
        export interface T extends _T {}
      }
    }
  }
}

nd_extend((nd) => {
  const THIS: ND.Interface.Ethernet.T = {
    init() {
      for (const iface of nd.os.net._interfaces) {
        if (!iface) continue;
        if (iface.type !== INTERFACE_TYPES.ETHERNET) continue;

        const item: ND.Interface.Ethernet.Item = {
          id: NDUtils.rand_id(),
          mac: formatMAC(iface.mac),
          name: iface.name,
          type: TYPE,
          props: {
            default_name: iface.name,
          },
        };

        nd.interface.append(item, iface);
      }
    },
    edit(id, update) {
      const item = nd.interface.map.get(id);
      if (!item) throw new Error("Item not found");
      if (item.type !== TYPE) throw new Error("Item type mismatch");

      nd.interface.edit(id, update);
    },
  };

  nd.interface.ethernet = THIS;

  nd.interface.type_serializers[TYPE] = {
    weight: 100,
    serialize(item): ND.Interface.Ethernet.TSerialized {
      return {
        default_name: item.props.default_name,
      };
    },
    deserialize(item, data: ND.Interface.Ethernet.TSerialized) {
      z_data.parse(data);

      item.props = {
        default_name: data.default_name,
      };

      const iface = nd.os.net.iface_by_name(item.props.default_name);
      if (!iface) return;

      nd.interface.append(item, iface);
    },
  };
});
