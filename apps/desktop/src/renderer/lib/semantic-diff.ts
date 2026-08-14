export function semanticDiff(before: string, after: string): string {
  const previous = before.split(/\r?\n/);
  const next = after.split(/\r?\n/);
  const lines: string[] = ["--- live object", "+++ dry-run object"];
  const cells = (previous.length + 1) * (next.length + 1);
  if (cells > 2_000_000) {
    return [...lines, ...previous.map((line) => `- ${line}`), ...next.map((line) => `+ ${line}`)].join("\n");
  }
  const width = next.length + 1;
  const lcs = new Uint32Array(cells);
  for (let left = previous.length - 1; left >= 0; left -= 1) {
    for (let right = next.length - 1; right >= 0; right -= 1) {
      const index = left * width + right;
      lcs[index] = previous[left] === next[right]
        ? lcs[(left + 1) * width + right + 1] + 1
        : Math.max(lcs[(left + 1) * width + right], lcs[index + 1]);
    }
  }
  let left = 0;
  let right = 0;
  while (left < previous.length || right < next.length) {
    if (left < previous.length && right < next.length && previous[left] === next[right]) {
      lines.push(`  ${previous[left]}`);
      left += 1;
      right += 1;
    } else if (right < next.length && (left === previous.length || lcs[left * width + right + 1] > lcs[(left + 1) * width + right])) {
      lines.push(`+ ${next[right]}`);
      right += 1;
    } else {
      lines.push(`- ${previous[left]}`);
      left += 1;
    }
  }
  return lines.join("\n");
}
