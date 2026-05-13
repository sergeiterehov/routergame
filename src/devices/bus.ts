export namespace Bus {
  export namespace Message {
    type _Frame = { $: "ethernet_frame"; port: number; frame: Uint8Array };
    type _LinkUpDown = { $: "link/up" | "link/down"; port: number };
    type _Exec = { $: "exec"; app: string; args: string[] };
    type _Print = { $: "print"; text: string };

    export type Master = _Frame | _Exec | _LinkUpDown;

    export type Slave = _Frame | _Print;
  }
}
