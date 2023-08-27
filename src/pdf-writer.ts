import fs from 'fs';
import { debugLog, log } from './logger';
const PDFDocument = require('pdfkit');

interface TextStyle {
  font?: FontFace;
  fontSize?: number;
  fillColor?: string;
  indent?: number;
  lineGap?: number;
}

interface TextOptions {
  continued?: boolean;
  destination?: string;
  goTo?: string | null;
  underline?: boolean;
  x?: number;
  y?: number;
};

enum FontFace {
  NORM = 0,
  BOLD = 1,
  ITALIC = 2,
  BOLD_ITALIC = 3,
};

export class PdfWriter {
  private topRightText: string = '';
  private doc;

  private docOutlines: any[] = [];
  private styleStack: TextStyle[] = [];

  private fonts = [
    'Helvetica',
    'Helvetica-Bold',
    'Helvetica-Oblique',
    'Helvetica-BoldOblique'
  ];

  private colorMain = 'black';
  private colorAccent = 'blue';
  private colorDisabled = 'grey';

  private paraGap = 4;
  private subHeaderGap = 6;
  private headerGap = 8;

  private baseStyle: TextStyle = {};

  constructor(outputFilePath: string) {
    this.doc = new PDFDocument();

    const writeStream = fs.createWriteStream(outputFilePath);
    this.doc.pipe(writeStream);
    this.doc.on('pageAdded', () => this.onNewPageAdded());

    this.baseStyle = {
      font: FontFace.NORM,
      fontSize: 12,
      fillColor: this.colorMain,
      indent: 0,
      lineGap: 0,
    };
  }

  newSection(name: string) {
    this.topRightText = name;
    this.resetStyle();
    this.doc.addPage();
  }

  text(str: string, options?: TextOptions): PdfWriter {
    const style = this.currentStyle();
    const styledOpt = { lineGap: style.lineGap, indent: style.indent, ...options };

    if (styledOpt.x !== undefined || styledOpt.y !== undefined) {
      styledOpt.indent = 0; // when absolute coordinates specified ignore indent
      this.doc.text(str, styledOpt.x ?? this.doc.x, styledOpt.y ?? this.doc.y, styledOpt);
    } else {
      this.doc.text(str, styledOpt);
    }
    return this;
  }

  header(level: number, str: string, anchor?: string) {
    const doc = this.doc;

    this.withStyle({ font: FontFace.NORM, fontSize: 18 - level * 2, lineGap: this.headerGap }, () => {
      this.text(str, { destination: anchor });
    });

    let newOutline;
    const outlinesLen = this.docOutlines.length;
    let headerLevelError = false;

    // debugLog(`header: level=${level}, text="${text}"`);

    if (level === 0) {
      newOutline = doc.outline.addItem(str);
    } else if (level > 0 && level <= outlinesLen) {
      newOutline = this.docOutlines[level - 1].addItem(str);
    } else {
      headerLevelError = true;
    }
    
    if (!headerLevelError) {
      if (level === outlinesLen) {
        this.docOutlines.push(newOutline);
      } else if (level < outlinesLen) {
        this.docOutlines[level] = newOutline;
        this.docOutlines.splice(level + 1); // remore remainings
      } else if (level > outlinesLen) {
        headerLevelError = true;
      }
    }

    if (headerLevelError) {
      throw new Error(`A header can only be nested inside headers with level - 1. level=${level}, previousLevel=${outlinesLen-1}`);
    }
  }

  subHeader(str: string) {
    this.withStyle({ font: FontFace.BOLD, fontSize: 12,  lineGap: this.subHeaderGap }, () => {
      this.text(str);
    });
  }

  indentStart(): PdfWriter {
    this.pushStyle({ indent: 12 });
    return this;
  }

  indentEnd(): PdfWriter {
    this.popStyle();
    return this;
  }

  lineBreak(n: number = 1): PdfWriter {
    this.doc.moveDown(n);
    return this;
  }

  para(str: string): PdfWriter {
    this.withStyle({ lineGap: this.paraGap }, () => {
      this.text(str);
    });
    return this;
  }

  comment(str: string, options?: TextOptions) {
    this.withStyle({ fillColor: this.colorDisabled }, () => {
      this.text(str, options);
    });
  }

  dataField(fieldName: string, fieldType?: string, description?: string, typeAnchor?: string) {
    this.text(fieldName, { continued: true });
    if (fieldType) {
      this.text(': ', { continued: true });
      this.withStyle({ fillColor: this.colorAccent }, () => {
        this.text(fieldType, { goTo: typeAnchor, underline: typeAnchor ? true : false, continued: description ? true : false });
      });
      if (description) {
        this.comment(`  // ${description}`, { goTo: null, underline: false });
      }
    }
  }

  schemaType(typeName: string) {
    this.text('Type: ', { continued: true });
    this.withStyle({ fillColor: this.colorAccent }, () => {
      this.text(typeName);
    });
  }

  enumValues(values: string[]) {
    values.forEach((value, index, array) => {
      const str = (index < array.length - 1) ? `${value}, ` : value;
      const continued = (index < array.length - 1) ? true : false;
      this.text(str, { continued });
    });
  }

  finish() {
    this.doc.end();
  }

  private onNewPageAdded() {
    const x = this.doc.x;
    const y = this.doc.y;
    if (this.topRightText) {
      this.withStyle({ font: FontFace.NORM, fontSize: 8, fillColor: this.colorDisabled }, () => {
        this.text(this.topRightText, { x: 50, y: 20 });
      });
    }
    this.doc.x = x;
    this.doc.y = y;
  }

  private setStyle(style: TextStyle) {
    this.doc.font(this.fonts[style.font ?? 0]).fontSize(style.fontSize).fillColor(style.fillColor);
  }

  private resetStyle() {
    this.styleStack = [];
    this.setStyle(this.baseStyle);
  }

  private withStyle(style: TextStyle, fn: (style: TextStyle) => void) {
    const newStyle = this.pushStyle(style);
    fn(newStyle);
    this.popStyle();
  }

  private pushStyle(style: TextStyle): TextStyle {
    const mergedStyle = { ...this.currentStyle(), ...style };
    mergedStyle.indent = (this.currentStyle().indent ?? 0) + (style.indent ?? 0); // nested indent
    this.setStyle(mergedStyle);
    this.styleStack.push(mergedStyle);
    return mergedStyle;
  }

  private popStyle(): TextStyle {
    this.styleStack.pop();
    const prevStyle = this.currentStyle();
    this.setStyle(prevStyle);
    return prevStyle;
  }

  private currentStyle(): TextStyle {
    return (this.styleStack.length > 0)
      ? this.styleStack[this.styleStack.length-1]
      : this.baseStyle;
  }
}
