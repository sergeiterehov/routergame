import type { Hardware } from "../hardware";
import type { Driver } from "./driver";
import { FS } from "./fs";
import { Net } from "./net";

export type TAppContext = {
  cwd: string;
  signal: AbortSignal;
  output: (string: string) => void;
  input: (cb: (string: string) => void, signal?: AbortSignal) => void;
};
export type TApp = (os: OS, args: string[], ctx: TAppContext) => Promise<void>;

export class OS {
  _system: Hardware;

  _drivers: Driver[] = [];
  _apps: { [key: string]: TApp } = {};

  _hostname = "noname";
  on_output?: (text: string) => void;

  _input_buffer: string[] = [];
  _input_callback?: () => void;
  _root_app_ctx: TAppContext = {
    cwd: "/",
    signal: new AbortController().signal,
    output: (text) => this.print(text),
    input: (cb, signal) => {
      if (signal?.aborted) return;

      if (this._input_buffer.length) {
        cb(this._input_buffer.shift()!);
        return;
      }

      this._input_callback = () => {
        const text = this._input_buffer.shift();
        if (!text) return;

        this._input_callback = undefined;
        cb(text);
      };

      signal?.addEventListener(
        "abort",
        () => {
          this._input_callback = undefined;
        },
        { once: true },
      );
    },
  };

  readonly fs = new FS(this);
  readonly net = new Net(this);

  constructor(system: Hardware) {
    this._system = system;
    this._system._interrupt = (deviceIndex) => {
      this._interruptHandlers[deviceIndex]?.();
    };
  }

  input(text: string) {
    this._input_buffer.push(text);
    this._input_callback?.();
  }

  print(...text: string[]) {
    this.on_output?.(text.join(""));
  }

  install(apps: typeof this._apps) {
    Object.assign(this._apps, apps);
    this.print(`Installed: ${Object.keys(apps).join(", ")}\n`);
  }

  async exec(name: string, args: string[], ctx: TAppContext) {
    const app = this._apps[name];
    if (!app) throw new Error(`${name} not found`);

    await app(this, args, ctx);
  }

  _interruptHandlers: { [key: number]: () => void } = {};
  interrupt_register(iDevice: number, handler: () => void) {
    this._interruptHandlers[iDevice] = handler;
  }
}
