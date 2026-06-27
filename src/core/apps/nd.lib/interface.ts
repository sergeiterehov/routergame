import z from "zod";
import { nd_extend, type ND } from ".";
import { parseMAC } from "../../format";
import type { TInterface } from "../../os/net";
import { NDUtils } from "./utils";

const z_data = z.object({
  interface: z.object({
    list: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        mac: z.string(),
        comment: z.string().optional(),
        type: z.string(),
        props: z.any(),
      }),
    ),
  }),
});

declare module "./" {
  export namespace ND {
    export interface Serialized extends Interface.Serialized {}

    export namespace Interface {
      export interface TypesProps {}

      export type Item<K extends keyof TypesProps = keyof TypesProps> = {
        id: string;
        name: string;
        comment?: string;
        mac: string;
        dynamic?: boolean;
      } & {
        type: K;
        props: TypesProps[K];
      };

      type _Serialized = z.infer<typeof z_data>;
      export interface Serialized extends _Serialized {}

      type TSerializer<K extends keyof TypesProps = keyof TypesProps> = {
        weight: number;
        serialize(item: Item<K>): unknown;
        deserialize(item: Item<K>, data: unknown): void;
      };

      type _T = {
        list: Item[];
        map: Map<string, Item>;
        iface_map: Map<string, TInterface>;

        type_serializers: { [K in keyof TypesProps]?: TSerializer<K> };

        hook: NDUtils.Hook<Item, "add" | "before-remove" | "edit">;

        by_name<T extends keyof TypesProps = keyof TypesProps>(name: string, type?: T): Item<T> | undefined;

        append(item: Item, iface: TInterface): void;
        remove(id: string): void;
        edit(id: string, item: Item): void;
      };
      export interface T extends _T {}
    }

    export interface T {
      interface: Interface.T;
    }
  }
}

nd_extend((nd) => {
  const THIS: ND.Interface._T = {
    list: [],
    map: new Map(),
    iface_map: new Map(),

    type_serializers: {},

    hook: new NDUtils.Hook(),

    by_name: ((name, type) => {
      for (const item of THIS.list) {
        if (type && item.type !== type) continue;
        if (item.name === name) return item;
      }
    }) as ND.Interface._T["by_name"],

    append(item, iface) {
      THIS.list.push(item);
      THIS.map.set(item.id, item);
      THIS.iface_map.set(item.id, iface);

      THIS.hook.notify(item, "add");
    },
    remove(id) {
      const item = THIS.map.get(id);
      if (!item) throw new Error(`Interface item not found: ${id}`);

      const iface = THIS.iface_map.get(id);
      if (!iface) throw new Error(`Interface not found: ${id}`);

      THIS.hook.notify(item, "before-remove");

      // clear arp
      nd.os.net.arp.clear_interface(iface.index);

      // clear fdb
      nd.os.net.br.fbd_clear(undefined, iface.index);

      delete nd.os.net._interfaces[iface.index];

      THIS.list.splice(THIS.list.indexOf(item), 1);
      THIS.map.delete(id);
    },
    edit(id, update) {
      const item = nd.interface.map.get(id);
      if (!item) throw new Error("Item not found");

      const iface = nd.interface.iface_map.get(id);
      if (!iface) throw new Error("Interface not found");

      item.name = update.name;
      item.comment = update.comment;

      if (item.mac !== update.mac) {
        nd.os.net.change_mac(iface.index, parseMAC(update.mac));
        item.mac = update.mac;
      }

      THIS.hook.notify(item, "edit");
    },
  };

  nd.interface = THIS as ND.Interface.T;

  function get_weight(type: string) {
    return THIS.type_serializers[type as keyof ND.Interface.TypesProps]?.weight || 999_999_999;
  }

  nd.serializers.push({
    serialize() {
      return {
        interface: {
          list: THIS.list
            .filter((item) => !item.dynamic)
            .map((item) => ({
              id: item.id,
              name: item.name,
              comment: item.comment,
              mac: item.mac,
              type: item.type,
              props: (THIS.type_serializers[item.type] as ND.Interface.TSerializer)?.serialize(item),
            }))
            .filter((d) => d.props),
        },
      };
    },
    deserialize(data) {
      z_data.parse(data);

      const sorted_list = data.interface.list.toSorted((a, b) => get_weight(a.type) - get_weight(b.type));
      for (const item_data of sorted_list) {
        const type = item_data.type as keyof ND.Interface.TypesProps;

        const item: ND.Interface.Item = {
          id: item_data.id,
          name: item_data.name,
          mac: item_data.mac,
          comment: item_data.comment,
          type,
          props: null!,
        };

        (THIS.type_serializers[type] as ND.Interface.TSerializer)?.deserialize(item, item_data.props);
      }
    },
  });
});
