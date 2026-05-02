import { observer } from "mobx-react-lite";
import { Canvas } from "./Canvas";
import { Console } from "./Console";
import { store } from "./store";
import { useState } from "react";

export const Root = observer(function Root() {
  const { active_id } = store;

  const [console_height, console_height_set] = useState(480);

  return (
    <div className="flex flex-col h-svh">
      <div className="grow overflow-hidden">
        <Canvas />
      </div>
      <div className="shrink-0 flex" style={{ height: console_height }}>
        {active_id ? <Console id={active_id} /> : null}
      </div>
    </div>
  );
});
