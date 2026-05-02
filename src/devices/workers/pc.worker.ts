import { beginWorker } from "../worker";

beginWorker({
  type: "PC",
  ethernet: [{ mac: 0x00n }],
});
