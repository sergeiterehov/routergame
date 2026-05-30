import { observer } from "mobx-react-lite";
import { Canvas } from "./Canvas";
import { Console } from "./Console";
import { store } from "./state/store";
import { useState } from "react";
import { NodeProps } from "./NodeProps";
import { Tools } from "./Tools";
import { MultiProps } from "./MultiProps";
import { ConnectionProps } from "./ConnectionProps";
import { FileEditor } from "./FileEditor";
import { ExchangeJournal } from "./ExchangeJournal";

export const Root = observer(function Root() {
  const {
    selected_node,
    selected_connection,
    selected,
    sidebar_visible,
    console_visible,
    node_editing_file,
    exchange_state,
  } = store;

  const [props_width, props_width_set] = useState(350);
  const [console_height, console_height_set] = useState(420);

  return (
    <div className="flex flex-col h-svh">
      <div className="grow overflow-hidden flex">
        <div className="grow overflow-hidden flex flex-col">
          <div className="relative grow overflow-hidden">
            <Canvas />
            <div className="absolute shadow-md outline outline-base-content/5 rounded-xl bg-base-200 top-2 left-1/2 -translate-x-1/2">
              <Tools />
            </div>
          </div>
          {console_visible && (
            <div className="shrink-0 flex bg-gray-500/5 border-t border-gray-500/10" style={{ height: console_height }}>
              {selected_node && selected_node.type !== "l2" ? <Console id={selected_node.id} /> : null}
            </div>
          )}
        </div>
        {sidebar_visible && (
          <div
            className="shrink-0 bg-gray-500/5 border-l border-gray-500/10 top-2 bottom-2 right-2 p-2 overflow-x-hidden overflow-y-auto *:grow"
            style={{ width: props_width }}
          >
            {selected_node ? (
              <NodeProps id={selected_node.id} />
            ) : selected_connection ? (
              <ConnectionProps id={selected_connection.id} />
            ) : selected.length ? (
              <MultiProps />
            ) : null}
          </div>
        )}
        {node_editing_file ? (
          <FileEditor node={store.node_by_id(node_editing_file.id)!} path={node_editing_file.path} />
        ) : null}
        {exchange_state ? <ExchangeJournal /> : null}
      </div>
    </div>
  );
});
