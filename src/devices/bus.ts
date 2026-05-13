export namespace Bus {
  export namespace Message {
    type _Frame = { $: "ethernet_frame"; port: number; frame: Uint8Array };
    type _LinkUpDown = { $: "link/up" | "link/down"; port: number };
    type _Exec = { $: "exec"; app: string; args: string[] };
    type _Print = { $: "print"; text: string };
    type _FS = { $: "fs"; fs: { [key: string]: string | undefined } };

    export type Master = _Frame | _Exec | _LinkUpDown | _FS;

    export type Slave = _Frame | _Print | _FS;
  }
}
