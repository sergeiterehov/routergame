import { observer } from "mobx-react-lite";
import { useRef, useState, useEffect } from "react";
import { store } from "./store";

export const Console = observer(function Console(props: { id: string }) {
  const { id } = props;

  const consoleRef = useRef<HTMLPreElement>(null);

  const [pHistory, setPHistory] = useState<number>(-1);
  const [history, setHistory] = useState<string[]>([]);
  const [cmd, setCmd] = useState<string>("");

  const actualCmd = pHistory !== -1 ? history[pHistory] : cmd;
  const text = store.consoles[id];

  useEffect(() => {
    if (text) consoleRef.current?.scrollTo({ top: 999999 });
  }, [text]);

  return (
    <div className="grow flex flex-col bg-black text-white">
      <pre ref={consoleRef} className="grow overflow-x-hidden overflow-y-scroll whitespace-pre-wrap wrap-break-word">
        {text}
      </pre>
      <input
        className="block font-mono border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm invalid:border-pink-500 invalid:text-pink-600 focus:border-sky-500 focus:outline focus:outline-sky-500 focus:invalid:border-pink-500 focus:invalid:outline-pink-500 disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500 disabled:shadow-none sm:text-sm dark:disabled:border-gray-700 dark:disabled:bg-gray-800/20"
        placeholder="#"
        disabled={!id}
        value={actualCmd}
        onChange={(e) => {
          setCmd(e.currentTarget.value);
          setPHistory(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();

            store.console_append(id, `# ${actualCmd}\n`);

            setHistory((prev) => [...prev, actualCmd]);
            setPHistory(-1);
            setCmd("");

            const [app, ...args] = actualCmd.split(/\s+/);

            if (app === "clear") return store.console_clear(id);
            store.instances[id]?.postMessage({ $: "exec", app, args });

            return;
          }

          if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();

            if (!history.length) return;

            setPHistory((prev) => {
              if (prev === -1) return history.length - 1;

              return Math.max(0, prev - 1);
            });
          }

          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();

            if (!history.length) return;

            setPHistory((prev) => {
              if (prev === -1) return prev;
              if (prev === history.length - 1) return -1;

              return Math.min(history.length - 1, prev + 1);
            });
          }
        }}
      />
    </div>
  );
});
