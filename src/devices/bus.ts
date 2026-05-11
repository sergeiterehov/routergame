export namespace Bus {
  export namespace Message {
    type _Frame = { $: "ethernet_frame"; port: number; frame: Uint8Array };
    type _Exec = { $: "exec"; app: string; args: string[] };
    type _Print = { $: "print"; text: string };

    export type Master = _Frame | _Exec;

    export type Slave = _Frame | _Print;
  }
}
