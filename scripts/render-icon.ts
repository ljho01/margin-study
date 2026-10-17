import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

// Renders the editable SVG source into the 1024px PNG that `tauri icon` expands.
const source = new URL("../assets/icon/icon.svg", import.meta.url);
const target = new URL("../assets/icon/icon.png", import.meta.url);
const png = new Resvg(readFileSync(source, "utf8"), {
  fitTo: { mode: "width", value: 1024 },
})
  .render()
  .asPng();
writeFileSync(target, png);
console.log("Icon rendered.");
