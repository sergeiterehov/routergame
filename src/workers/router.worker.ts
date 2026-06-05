import { beginWorkerOS } from "./helpers";

beginWorkerOS({
  type: "Router",
  ethernet: [
    { mac: 0x00n },
    { mac: 0x01n },
    { mac: 0x02n },
    { mac: 0x03n },
    { mac: 0x04n },
    { mac: 0x05n },
    { mac: 0x06n },
    { mac: 0x07n },
  ],
});
