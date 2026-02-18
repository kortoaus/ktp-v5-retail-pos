export type BarcodeFormat = "RAW" | "GTIN" | "EAN13";

export type LabelLanguage = "zpl" | "slcs";

export type LabelElement =
  | {
      type: "text";
      x: number;
      y: number;
      data: string;
      fontSize: number;
      bold?: boolean;
    }
  | {
      type: "barcode";
      x: number;
      y: number;
      data: string;
      height: number;
      text?: boolean;
      format: BarcodeFormat;
    }
  | { type: "datamatrix"; x: number; y: number; data: string; size: number };

export interface SLCSPart {
  type: "raw" | "euc-kr";
  data: string;
}

export type LabelOutput =
  | { language: "zpl"; data: string }
  | { language: "slcs"; parts: SLCSPart[] };

export class LabelBuilder {
  private width = 800;
  private height = 1200;
  private elements: LabelElement[] = [];

  setSize(w: number, h: number) {
    this.width = w;
    this.height = h;
    return this;
  }

  text(x: number, y: number, data: string, fontSize = 30, bold = false) {
    this.elements.push({ type: "text", x, y, data, fontSize, bold });
    return this;
  }

  barcode(
    x: number,
    y: number,
    data: string,
    height = 100,
    text = true,
    format: BarcodeFormat = "GTIN",
  ) {
    this.elements.push({ type: "barcode", x, y, data, height, text, format });
    return this;
  }

  datamatrix(x: number, y: number, data: string, size = 6) {
    this.elements.push({ type: "datamatrix", x, y, data, size });
    return this;
  }

  build(language: LabelLanguage): LabelOutput {
    if (language === "slcs") {
      return { language: "slcs", parts: this.buildSLCS() };
    }
    return { language: "zpl", data: this.buildZPL() };
  }

  private buildZPL(): string {
    let zpl = `^XA^PW${this.width}^LL${this.height}`;

    for (const el of this.elements) {
      if (el.type === "text") {
        zpl += `^FO${el.x},${el.y}^A0N,${el.fontSize},${el.fontSize}^FD${el.data}^FS`;
      } else if (el.type === "barcode") {
        if (el.format === "GTIN") {
          zpl += `^FO${el.x},${el.y}^BCN,${el.height},Y,N^FD${el.data}^FS`;
        } else if (el.format === "EAN13") {
          zpl += `^FO${el.x},${el.y}^BEN,${el.height},Y,N^FD${el.data}^FS`;
        } else {
          const hri = el.text ? "Y" : "N";
          zpl += `^FO${el.x},${el.y}^BY2,3,${el.height}^BCN,${el.height},${hri},N,N^FD${el.data}^FS`;
        }
      } else if (el.type === "datamatrix") {
        zpl += `^FO${el.x},${el.y}^BXN,${el.size},200^FD${el.data}^FS`;
      }
    }

    zpl += "^XZ";
    return zpl;
  }

  private buildSLCS(): SLCSPart[] {
    const parts: SLCSPart[] = [];

    const raw = (s: string) => parts.push({ type: "raw", data: s + "\r\n" });

    function cleanText(text: string): string {
      const blocklist = ["'"];
      return text
        .replace(new RegExp(`[${blocklist.join("")}]`, "g"), "")
        .trim();
    }

    raw("@");
    raw("CB");
    raw(`SW${this.width}`);
    raw(`SL${this.height}`);
    raw("CS13,0");

    for (const el of this.elements) {
      if (el.type === "text") {
        let mul = 1;
        if (el.fontSize > 40) {
          mul = 2;
        }
        if (el.fontSize > 60) {
          mul = 3;
        }

        parts.push({
          type: "raw",
          data: `T${el.x},${el.y},d,${mul},${mul},0,0,N,${el.bold ? "B" : "N"},'`,
        });
        parts.push({ type: "euc-kr", data: cleanText(el.data) });
        parts.push({ type: "raw", data: "'\r\n" });
      } else if (el.type === "barcode") {
        const hri = el.text ? 1 : 0;
        const bType = el.format === "EAN13" ? 7 : 9;

        raw(
          `B1${el.x},${el.y},${bType},2,6,${el.height},0,${hri},'${el.data}'`,
        );
      } else if (el.type === "datamatrix") {
        const slcsSize = Math.max(1, Math.min(el.size, 10));
        raw(`B2${el.x},${el.y},D,${slcsSize},N,'${el.data}'`);
      }
    }

    parts.push({ type: "raw", data: "P1\r\n" });

    return parts;
  }
}
