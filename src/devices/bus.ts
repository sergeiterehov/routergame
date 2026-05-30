export namespace Bus {
  export namespace Message {
    type _Frame = { $: "ethernet_frame"; port: number; frame: Uint8Array };
    type _Configure = { $: "configure"; hw_address?: { port: number; mac: string }[] };
    type _Init = { $: "init"; args: string[] };
    type _Input = { $: "input"; text: string };
    type _Print = { $: "print"; text: string };
    type _FS = { $: "fs"; fs: { [key: string]: string | undefined } };

    export type Master = _Frame | _FS | _Configure | _Init | _Input;

    export type Slave = _Frame | _FS | _Print;
  }
}
