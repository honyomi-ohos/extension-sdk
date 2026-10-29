import test from 'node:test';
import assert from 'node:assert/strict';

enum Mode { A = 'a', B = 'b' }

test('esbuild loader 支持 enum（非可擦除语法）', () => {
  const m: Mode = Mode.B;
  assert.equal(m, 'b');
  assert.equal(Object.keys(Mode).length, 2);
});
