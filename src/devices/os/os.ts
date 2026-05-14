import { FS } from "./fs";
import type { System, Driver } from "../system";
import { Net } from "./net";

export class OSChannel<T = unknown> extends EventTarget {
  private _eventMap = {
    message: new MessageEvent("message", { data: null as T }),
  };

  postMessage(message: T): void {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }

  addEventListener<K extends keyof typeof this._eventMap>(
    type: K,
    listener: (this: OSChannel, ev: (typeof this._eventMap)[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof typeof this._eventMap>(
    type: K,
    listener: (this: OSChannel, ev: (typeof this._eventMap)[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}

export class OS {
  _system: System;

  _drivers: Driver[] = [];
  _apps: { [key: string]: (os: OS, args: string[]) => void } = {};

  on_print?: (text: string) => void;

  readonly fs = new FS(this);
  readonly net = new Net(this);

  constructor(system: System) {
    this._system = system;
    this._system._interrupt = (deviceIndex) => {
      this._interruptHandlers[deviceIndex]?.();
    };
  }

  deadline(ms: number) {
    const start = Date.now();
    return {
      get start() {
        return start;
      },
      get left() {
        return ms - (Date.now() - start);
      },
    };
  }

  async channel_sync<T>(channel: OSChannel<T>, deadline: { left: number }) {
    return new Promise<[T] | [void, Error]>((resolve) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
        resolve([undefined, new Error("TIMEOUT")]);
      }, deadline.left);
      channel.addEventListener(
        "message",
        (e) => {
          clearTimeout(timeout);
          resolve([e.data]);
        },
        { signal: controller.signal },
      );
    });
  }

  print(...text: string[]) {
    this.on_print?.(text.join(""));
  }

  install(apps: typeof this._apps) {
    Object.assign(this._apps, apps);
    this.print(`Installed: ${Object.keys(apps).join(", ")}\n`);
  }

  async exec(name: string, args: string[] = []) {
    const app = this._apps[name];
    if (!app) return this.print(`Unknown app: ${name}\n`);
    try {
      await app(this, args);
    } catch (e) {
      this.print(`[${name} exit error] ${e}\n`);
    }
  }

  _interruptHandlers: { [key: number]: () => void } = {};
  interrupt_register(iDevice: number, handler: () => void) {
    this._interruptHandlers[iDevice] = handler;
  }
}
