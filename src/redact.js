export function redact(text) {
  if (typeof text !== 'string') return '';
  let result = text;

  // 1. Private key blocks
  result = result.replace(/-----BEGIN [A-Z0-9_ -]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9_ -]+ PRIVATE KEY-----/g, '<redacted>');

  // 2. Bearer <token>
  result = result.replace(/(Bearer\s+)[^\s"';,]+/gi, '$1<redacted>');

  // 3. URLs with user:pass credentials
  result = result.replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1<redacted>@');

  // 4. Known key prefixes: sk-..., ghp_..., AKIA..., xox[baprs]-...
  result = result.replace(/\bsk-[a-zA-Z0-9_-]+\b/g, '<redacted>');
  result = result.replace(/\bghp_[a-zA-Z0-9]+\b/g, '<redacted>');
  result = result.replace(/\bAKIA[0-9A-Z]{16}\b/g, '<redacted>');
  result = result.replace(/\bxox[baprs]-[a-zA-Z0-9-]+\b/g, '<redacted>');

  // 5. password=..., token=..., secret=..., apikey=... (case-insensitive, key=value and key: value)
  // Handles optional quotes around value
  result = result.replace(/\b(password|token|secret|apikey)(\s*[=:]\s*)(['"]?)[^\s'",;]+(\3)/gi, '$1$2<redacted>');

  return result;
}
