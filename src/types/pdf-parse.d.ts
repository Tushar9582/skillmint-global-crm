declare module 'pdf-parse' {
  export default function pdfParse(bytes: Buffer): Promise<{text:string;numpages:number}>;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  export { default } from 'pdf-parse';
}
