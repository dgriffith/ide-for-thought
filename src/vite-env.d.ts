declare module '*.ttl?raw' {
  const content: string;
  export default content;
}

// Vite's `?url` suffix — returns the asset's final URL as a string.
// Used by the OCR worker to locate the bundled traineddata and the
// pdfjs worker script (#95).
declare module '*?url' {
  const url: string;
  export default url;
}
