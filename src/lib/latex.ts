/**
 * Page analyses arrive as JSON. When a model writes a LaTeX command with a
 * single backslash, JSON reads its first letter as an escape: "\text" becomes
 * a tab and "ext", "\frac" a form feed, "\beta" a backspace, "\rho" a carriage
 * return and "\nabla" a line break. Those cases are turned back into the
 * command; any other control character is dropped so it never shows up as a
 * broken glyph.
 */
export function repairLatex(text: string) {
  return text
    .replace(
      /\t(?=(?:ext[a-z]*|heta|au|imes|ilde|op|o|an|anh|riangle[a-z]*|herefore)(?![A-Za-z]))/g,
      "\\t",
    )
    .replace(/\f/g, "\\f")
    .replace(/\x08/g, "\\b")
    .replace(/\r(?=[A-Za-z])/g, "\\r")
    .replace(
      /\n(?=(?:abla|eq|eg|u|ot|otin|leq|geq|mid|parallel|exists|subseteq|cong)(?![A-Za-z]))/g,
      "\\n",
    )
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
