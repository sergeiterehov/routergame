import { Switch } from "../core/store/switch.hardware";
import { expose } from "./helpers";

function begin() {
  console.log("Hello Switch", self.name);

  const sw = new Switch(16);

  for (let i = 0; i < sw._devices.length; i += 1) {
    expose(i, sw._devices[i].port);
  }
}

begin();
