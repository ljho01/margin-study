import { cp } from "node:fs/promises";
for (const name of ["cmaps", "standard_fonts", "wasm"])
  await cp(
    new URL(`../node_modules/pdfjs-dist/${name}`, import.meta.url),
    new URL(`../public/${name}`, import.meta.url),
    { recursive: true },
  );
