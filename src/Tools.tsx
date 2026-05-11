import {
  IconDeviceImac,
  IconLayoutSidebarRight,
  IconPlugConnected,
  IconServer2,
  IconTerminal2,
  IconTopologyBus,
  IconTopologyStar,
} from "@tabler/icons-react";
import { observer } from "mobx-react-lite";
import { store } from "./store";

function Btn(props: { children: React.ReactNode }) {
  const { children } = props;
  return <div className="p-2 rounded-md hover:bg-black/5 cursor-pointer">{children}</div>;
}

export const Tools = observer(function Tools() {
  const { console_visible, sidebar_visible } = store;

  return (
    <div className="p-2 flex gap-1 select-none cursor-default">
      <Btn>
        <IconPlugConnected stroke="1" size="24" />
      </Btn>
      <div className="border-l border-black/5 m-1" />
      <Btn>
        <IconDeviceImac stroke="1" size="24" />
      </Btn>
      <Btn>
        <IconServer2 stroke="1" size="24" />
      </Btn>
      <div className="border-l border-black/5 m-1" />
      <Btn>
        <IconTopologyBus stroke="1" size="24" />
      </Btn>
      <Btn>
        <IconTopologyStar stroke="1" size="24" />
      </Btn>
      <div className="border-l border-black/5 m-1" />
      <div
        className={`p-2 rounded-md cursor-pointer ${console_visible ? "bg-gray-700 text-white" : "hover:bg-black/5"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.console_visible_set(!console_visible);
        }}
      >
        <IconTerminal2 stroke="1" size="24" />
      </div>
      <div
        className={`p-2 rounded-md cursor-pointer ${sidebar_visible ? "bg-gray-300" : "hover:bg-black/5"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.sidebar_visible_set(!sidebar_visible);
        }}
      >
        <IconLayoutSidebarRight stroke="1" size="24" />
      </div>
    </div>
  );
});
