import type { System, Driver } from "../system";
import { FS } from "./fs";
import { Net } from "./net";

export type TAppContext = {
  cwd: string;
  signal: AbortSignal;
};
export type TApp = (os: OS, args: string[], ctx: TAppContext) => Promise<void>;

export class OS {
  _system: System;

  _drivers: Driver[] = [];
  _apps: { [key: string]: TApp } = {};

  on_print?: (text: string) => void;
  on_input?: (text: string) => void;

  readonly fs = new FS(this);
  readonly net = new Net(this);

  constructor(system: System) {
    this._system = system;
    this._system._interrupt = (deviceIndex) => {
      this._interruptHandlers[deviceIndex]?.();
    };
  }

  print(...text: string[]) {
    this.on_print?.(text.join(""));
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
