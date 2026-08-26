/**
 * Field data escaping for `^FH^FD`.
 *
 * Three characters have to leave: `^` and `~` start ZPL commands, and `_` is
 * the ^FH hex-escape introducer. Everything else passes through byte for byte,
 * which is the whole point — the label stream is UTF-8 and `^CI28` tells the
 * printer to read it that way, so hangul must survive untouched. Any
 * "sanitiser" that strips non-ASCII here silently deletes the Korean name.
 *
 * Order matters: `_` is substituted first, otherwise the underscores introduced
 * by the `^` and `~` substitutions would themselves be escaped. Same rule and
 * same order as `src/main/zpl-font/commands.ts escapeFieldData`.
 *
 * C0 control characters are dropped rather than escaped. They cannot appear in
 * a product name for any good reason, and a stray CR/LF mid-field desynchronises
 * the serial transport.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function fieldData(text: string): string {
  return text
    .replace(CONTROL_CHARS, "")
    .replaceAll("_", "_5F")
    .replaceAll("^", "_5E")
    .replaceAll("~", "_7E");
}
