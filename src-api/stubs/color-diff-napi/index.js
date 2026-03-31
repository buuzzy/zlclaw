// Stub for color-diff-napi — satisfies the import from @shipany/open-agent-sdk
// The actual native module is not available; these no-op exports prevent runtime crashes.

export class ColorDiff {
  constructor() {}
  diff() { return ''; }
}

export class ColorFile {
  constructor() {}
}

export function getSyntaxTheme() {
  return null;
}
