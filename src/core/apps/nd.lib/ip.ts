import { nd_extend, type ND } from ".";

declare module "./" {
  export namespace ND {
    export namespace IP {
      export type _T = object;
      export interface T extends _T {}
    }

    export interface T {
      ip: IP.T;
    }
  }
}

nd_extend((nd) => {
  const THIS: ND.IP._T = {};

  nd.ip = THIS as ND.IP.T;
});
