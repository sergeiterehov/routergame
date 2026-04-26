import { createRoot } from "react-dom/client";
import "./main.css";
import { Canvas } from "./Canvas.tsx";

createRoot(document.getElementById("root")!).render(<Canvas />);
