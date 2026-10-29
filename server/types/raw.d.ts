// Nitro's raw plugin imports .md files as strings (prompts in server/pipeline/prompts/).
declare module '*.md' {
  const content: string
  export default content
}

// `raw:` imports (Nitro's raw plugin): Method B's sandbox scripts, copied into the VM as files.
// A .mjs may come back as bytes (Nitro decides by MIME type); both are valid writeFiles content.
declare module 'raw:*' {
  const content: string | Uint8Array
  export default content
}
