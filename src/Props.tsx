import { observer } from "mobx-react-lite";
import { store } from "./store";

export const Props = observer(function Props(props: { id: string }) {
  const { id } = props;

  const node = store.arch.node.find((n) => n.id === id)!;

  const handle_rename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const name = prompt("New name", node.name);
    if (!name) return;
    store.rename_node(id, name);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-semibold cursor-pointer hover:bg-gray-900/5" onClick={handle_rename}>
        {node.name}
      </div>
      <div className="text-sm font-mono">
        {node.ports.map((p) => {
          for (const c of store.arch.connections) {
            if ((c.a_id === id && c.a_pid === p.id) || (c.b_id === id && c.b_pid === p.id)) {
              const ext = c.a_id === id ? c.b_pid : c.a_pid;
              for (const ext_node of store.arch.node) {
                if (ext_node.id === (c.a_id === id ? c.b_id : c.a_id)) {
                  return (
                    <div key={p.id}>
                      {p.id} &rarr; {ext_node.name}: {ext}
                    </div>
                  );
                }
              }
            }
          }

          return (
            <div key={p.id} className="text-black/33">
              {p.id}
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
      <div className="h-25 shrink-0"></div>
    </div>
  );
});
