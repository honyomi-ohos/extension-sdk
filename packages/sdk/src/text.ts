// 文本工具：实体解码 / 去标签 / 日期解析。

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return String(text ?? '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match: string, entity: string): string => {
      if (entity.startsWith('#')) {
        const isHex = entity.charAt(1) === 'x' || entity.charAt(1) === 'X';
        const code = parseInt(entity.substring(isHex ? 2 : 1), isHex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
          return match;
        }
        return String.fromCodePoint(code);
      }
      const named = NAMED_ENTITIES[entity];
      return named !== undefined ? named : match;
    });
}

export function stripTags(html: string): string {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ''));
}

// 可解析日期 → 毫秒时间戳；不可解析 → 0（宿主 dateUpload 缺省值）
export function parseDate(input: string): number {
  const ts = Date.parse(String(input ?? ''));
  return Number.isNaN(ts) ? 0 : ts;
}
