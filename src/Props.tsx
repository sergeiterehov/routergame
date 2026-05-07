import { observer } from "mobx-react-lite";
import { store } from "./store";

export const Props = observer(function Props(props: { id: string }) {
  const { id } = props;

  const node = store.arch.node.find((n) => n.id === id)!;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold">{node.name}</div>
      <div className="text-sm font-mono">
        {store.arch.connections
          .filter((c) => c.a_id === id || c.b_id === id)
          .map((c) => {
            const int = c.a_id === id ? c.a_pid : c.b_pid;
            const ext = c.a_id === id ? c.b_pid : c.a_pid;
            const ext_node = store.arch.node.find((n) => n.id === (c.a_id === id ? c.b_id : c.a_id));
            if (!ext_node) return null;

            return (
              <div key={c.id}>
                {int} &rarr; {ext} ({ext_node.name})
              </div>
            );
          })}
      </div>
      {"init" in node ? (
        <>
          <div className="text-md font-semibold">Init script</div>
          <div className="flex flex-col gap-1">
            {node.init.map((cmd, i) => (
              <div key={i} className="border border-gray-300 p-1 rounded-lg font-mono text-sm leading-relaxed">
                <code>{cmd}</code>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="h-[100px] shrink-0"></div>
    </div>
  );
});
