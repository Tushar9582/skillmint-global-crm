declare module 'pdf-parse' {
  export default function pdfParse(bytes: Buffer): Promise<{text:string;numpages:number}>;
}
