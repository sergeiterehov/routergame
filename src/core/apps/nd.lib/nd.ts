import z from "zod";
import type { OS } from "../../os/os";

const z_data = z.object({
  version: z.number(),
});

export namespace ND {
  export type _Serialized = z.infer<typeof z_data>;
  export interface Serialized extends _Serialized {}

  export type TSerializer = {
    serialize(): Partial<Serialized>;
    deserialize(data: Serialized): void;
  };

  export interface _T {
    os: OS;
    version: number;

    serializers: TSerializer[];

    serialize(): Serialized;
    deserialize(data: Serialized): void;
  }

  export interface T extends _T {}
}

const THIS: ND._T = {
  os: null!,
  version: 1,

  serializers: [],

  serialize() {
    const data: ND._Serialized = {
      version: THIS.version,
    };

    for (const serializer of THIS.serializers) {
      Object.assign(data, serializer.serialize());
    }

    return data as ND.Serialized;
  },
  deserialize(data) {
    z_data.parse(data);

    THIS.version = data.version;

    for (const serializer of THIS.serializers) {
      serializer.deserialize(data);
    }
  },
};

export const nd = THIS as ND.T;
