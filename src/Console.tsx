import { observer } from "mobx-react-lite";
import { useRef, useEffect } from "react";
import { store } from "./state/store";
import { makeAutoObservable } from "mobx";

class State {
  readonly id: string;

  pHistory = -1;
  history: string[] = [];
  cmd = "";

  get actualCmd() {
    return this.pHistory !== -1 ? this.history[this.pHistory] : this.cmd;
  }

  constructor(id: string) {
    this.id = id;
    makeAutoObservable(this);
  }

  cmd_set(cmd: string) {
    this.cmd = cmd;
    this.pHistory = -1;
  }

  send() {
    const { id, actualCmd } = this;

    this.history.push(actualCmd);
    this.cmd_set("");

    store.node_send_input(id, `${actualCmd}\n`);
  }

  send_ctrl_c() {
    store.node_send_input(this.id, `^c`);
  }

  prev() {
    if (!this.history.length) return;
    if (this.pHistory === -1) {
      this.pHistory = this.history.length - 1;
    } else {
      this.pHistory = Math.max(0, this.pHistory - 1);
    }
  }

  next() {
    if (!this.history.length) return;
    if (this.pHistory === -1) return;
    if (this.pHistory === this.history.length - 1) {
      this.pHistory = -1;
    } else {
      this.pHistory = Math.min(this.history.length - 1, this.pHistory + 1);
    }
  }
}

const states: { [key in string]?: State } = {};

export const Console = observer(function Console(props: { id: string }) {
  const { id } = props;
  const state = (states[id] ||= new State(id));

  const consoleRef = useRef<HTMLPreElement>(null);
  const text = store.consoles[id];

  useEffect(() => {
    if (text) consoleRef.current?.scrollTo({ top: 999999 });
  }, [text]);

  return (
    <div className="grow flex flex-col">
      <pre
        ref={consoleRef}
        className="p-2 grow overflow-x-hidden overflow-y-scroll whitespace-pre-wrap wrap-break-word"
      >
        {text}
      </pre>
      <input
        autoFocus
        className="block font-mono border-0 outline-0 px-3 py-2 placeholder-gray-400 bg-gray-900/5 focus:bg-indigo-500/10"
        placeholder="#"
        disabled={!id}
        value={state.actualCmd}
        onChange={(e) => state.cmd_set(e.currentTarget.value)}
        onKeyDown={(e) => {
          let prevent = true;

          if (e.key === "c" && e.ctrlKey) {
            state.send_ctrl_c();
          } else if (e.key === "Enter") {
            state.send();
          } else if (e.key === "ArrowUp") {
            state.prev();
          } else if (e.key === "ArrowDown") {
            state.next();
          } else {
            prevent = false;
          }

          if (prevent) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      />
    </div>
  );
});
