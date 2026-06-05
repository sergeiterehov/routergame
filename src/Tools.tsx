import {
  IconDeviceImac,
  IconGrid3x3,
  IconLayoutSidebarRight,
  IconPlugConnected,
  IconServer2,
  IconTopologyBus,
  IconTerminal2,
  IconSwitch3,
  IconCopy,
  IconSpy,
} from "@tabler/icons-react";
import { observer } from "mobx-react-lite";
import { store, TOOL } from "./state/store";
import { toJS } from "mobx";

function Separator() {
  return <div className="border-l border-black/5 m-1" />;
}

function Btn({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={[
        "p-2 rounded-md hover:bg-base-content/5 cursor-pointer",
        "data-active:bg-indigo-500 data-active:hover:bg-indigo-600 data-active:text-white",
        "data-active:data-gray:bg-base-content/10 data-active:data-gray:text-base-content data-active:data-gray:hover:bg-base-content/15",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export const Tools = observer(function Tools() {
  const { console_visible, sidebar_visible, tool, grid } = store;

  return (
    <div className="p-2 flex gap-1 select-none cursor-default">
      <Btn
        data-active={tool === TOOL.CONNECT || undefined}
        title="Connecting"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.tool_set(tool === TOOL.CONNECT ? TOOL.NONE : TOOL.CONNECT);
        }}
      >
        <IconPlugConnected stroke="1" size="24" />
      </Btn>
      <Separator />
      <Btn
        title="Add PC"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = prompt("Name", "New PC");
          if (!name) return;
          store.node_create_pc({ name });
        }}
      >
        <IconDeviceImac stroke="1" size="24" />
      </Btn>
      <Btn
        title="Add Server"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = prompt("Name", "New Server");
          if (!name) return;
          store.node_create_server({ name });
        }}
      >
        <IconServer2 stroke="1" size="24" />
      </Btn>
      <Separator />
      <Btn
        title="Add L2 Switch"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = prompt("Name", "New Switch");
          if (!name) return;
          store.node_create_switch({ name });
        }}
      >
        <IconTopologyBus stroke="1" size="24" />
      </Btn>
      <Btn
        title="Add Router"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const name = prompt("Name", "New Router");
          if (!name) return;
          store.node_create_router({ name });
        }}
      >
        <IconSwitch3 stroke="1" size="24" />
      </Btn>
      <Separator />
      <Btn
        data-gray
        title="Align by grid"
        data-active={grid > 1 || undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.grid_set(grid > 1 ? 1 : 50);
        }}
      >
        <IconGrid3x3 stroke="1" size="24" />
      </Btn>
      <Btn
        data-gray
        title="Exchange journal"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.exchange_open();
        }}
      >
        <IconSpy stroke="1" size="24" />
      </Btn>
      <Btn
        data-gray
        title="Console"
        data-active={console_visible || undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.console_visible_set(!console_visible);
        }}
      >
        <IconTerminal2 stroke="1" size="24" />
      </Btn>
      <Btn
        data-gray
        title="Sidebar"
        data-active={sidebar_visible || undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          store.sidebar_visible_set(!sidebar_visible);
        }}
      >
        <IconLayoutSidebarRight stroke="1" size="24" />
      </Btn>
      <Separator />
      <Btn
        data-gray
        title="Copy architecture to clipboard"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(JSON.stringify(toJS(store.arch)));
        }}
      >
        <IconCopy stroke="1" size="24" />
      </Btn>
    </div>
  );
});
