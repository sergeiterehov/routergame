import { observer } from "mobx-react-lite";
import { Canvas } from "./Canvas";
import { Console } from "./Console";
import { store } from "./store";
import { useState } from "react";
import { Props } from "./Props";

export const Root = observer(function Root() {
  const { active_node } = store;

  const [props_width, props_width_set] = useState(350);
  const [console_height, console_height_set] = useState(420);

  return (
    <div className="flex flex-col h-svh">
      <div className="grow overflow-hidden flex">
        <div className="grow overflow-hidden">
          <Canvas />
        </div>
        {active_node ? (
          <div
            className="shrink-0 flex bg-gray-100 p-2 overflow-x-hidden overflow-y-auto *:grow"
            style={{ width: props_width }}
          >
            <Props id={active_node.id} />
          </div>
        ) : null}
      </div>
      {active_node && active_node.type !== "l2" ? (
        <div className="shrink-0 flex" style={{ height: console_height }}>
          <Console id={active_node.id} />
        </div>
      ) : null}
    </div>
  );
});
