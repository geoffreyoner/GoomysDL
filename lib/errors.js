export function explainError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  let message = errorLine
    ? errorLine.replace(/^ERROR:\s*/, '')
    : String(err?.message || 'Extraction failed.');
  message = message.split('\n')[0].slice(0, 300);
  if (/Unsupported URL/i.test(message)) return 'This URL is not supported by the extractor.';
  if (/Sign in|log in|login|cookies|private|rate.?limit|401|unauthorized|authentication/i.test(message)) {
    return 'This post needs login/cookies or is rate-limited. Public posts only.';
  }
  if (/Spotify album|playlist/i.test(message)) return message;
  if (/no downloadable media|no download links|no files found|no chapter images/i.test(message)) {
    return 'No downloadable media found at this URL.';
  }
  if (/timed? ?out/i.test(message)) return 'The platform took too long to respond. Try again.';
  return message;
}
