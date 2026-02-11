import iconv from "iconv-lite";

type LabelElement =
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
      format: "code128" | "ean13";
    }
  | { type: "datamatrix"; x: number; y: number; data: string; size: number };

export class LabelBuilder {
  private width: number = 800;
  private height: number = 1200;
  private elements: LabelElement[] = [];

  setSize(w: number, h: number) {
    // Input in DOTS (203dpi: 1mm = 8 dots)
    this.width = w;
    this.height = h;
    return this;
  }

  text(
    x: number,
    y: number,
    data: string,
    fontSize: number = 30,
    bold: boolean = false,
  ) {
    this.elements.push({ type: "text", x, y, data, fontSize, bold });
    return this;
  }

  barcode(
    x: number,
    y: number,
    data: string,
    height: number = 100,
    text: boolean = true,
    format: "code128" | "ean13" = "code128",
  ) {
    this.elements.push({ type: "barcode", x, y, data, height, text, format });
    return this;
  }

  datamatrix(x: number, y: number, data: string, size: number = 6) {
    this.elements.push({ type: "datamatrix", x, y, data, size });
    return this;
  }

  build(language: "zpl" | "slcs"): string | Buffer {
    if (language === "slcs") {
      return this.buildSLCS();
    } else {
      return this.buildZPL();
    }
  }

  private buildZPL(): string {
    let zpl = `^XA^PW${this.width}^LL${this.height}`;

    for (const el of this.elements) {
      if (el.type === "text") {
        // Use default font 0 (Scalable)
        // ^A0N,h,w
        zpl += `^FO${el.x},${el.y}^A0N,${el.fontSize},${el.fontSize}^FD${el.data}^FS`;
      } else if (el.type === "barcode") {
        // ZPL
        if (el.format === "ean13") {
          // EAN-13 (^BE)
          // ^BEn,h,f,g
          zpl += `^FO${el.x},${el.y}^BEN,${el.height},Y,N^FD${el.data}^FS`;
        } else {
          // Default Code 128 (^BC)
          const hri = el.text ? "Y" : "N";
          zpl += `^FO${el.x},${el.y}^BY2,3,${el.height}^BCN,${el.height},${hri},N,N^FD${el.data}^FS`;
        }
      } else if (el.type === "datamatrix") {
        // DataMatrix (^BX)
        // ^BXo,h,s,c,r,f,g
        // h = size (1-10+)
        // quality 200
        zpl += `^FO${el.x},${el.y}^BXN,${el.size},200^FD${el.data}^FS`;
      }
    }

    zpl += "^XZ";
    return zpl;
  }

  private buildSLCS(): Buffer {
    const parts: Buffer[] = [];

    const CRLF = (s: string) => Buffer.from(s + "\r\n", "ascii");
    const RAW = (s: string) => Buffer.from(s, "ascii");

    parts.push(CRLF("CB"));
    parts.push(CRLF(`SW${this.width}`));
    parts.push(CRLF("CS13,0"));

    for (const el of this.elements) {
      if (el.type === "text") {
        const mul = el.fontSize > 40 ? 2 : 1;

        parts.push(
          RAW(
            `T${el.x},${el.y},b,${mul},${mul},0,0,N,${el.bold ? "B" : "N"},'`,
          ),
        );
        parts.push(iconv.encode(el.data, "euc-kr"));
        parts.push(RAW("'\r\n"));
      } else if (el.type === "barcode") {
        const hri = el.text ? 1 : 0;
        const bType = el.format === "ean13" ? 7 : 9;

        parts.push(
          CRLF(
            `B1${el.x},${el.y},${bType},2,6,${el.height},0,${hri},'${el.data}'`,
          ),
        );
      } else if (el.type === "datamatrix") {
        const slcsSize = Math.max(1, Math.min(el.size, 10));
        parts.push(CRLF(`B2${el.x},${el.y},D,${slcsSize},N,'${el.data}'`));
      }
    }

    parts.push(Buffer.from("P1\r", "ascii"));

    return Buffer.concat(parts);
  }
}
