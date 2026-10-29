import test from 'node:test';
import assert from 'node:assert/strict';
import { defineExtension } from '../src/extension.ts';
import type { SourceExtension, WorkPage } from '../src/types.ts';

const emptyPage = (): WorkPage => ({ works: [], hasNextPage: false });

test('defineExtension writes host module.exports and returns the extension', () => {
  const ext: SourceExtension = {
    getPopularWorks: () => emptyPage(),
    getSearchWorks: () => emptyPage(),
  };
  const holder = globalThis as unknown as { module?: { exports?: unknown } };
  const previous = holder.module;
  holder.module = { exports: undefined };
  try {
    const returned = defineExtension(ext);
    assert.equal(returned, ext);
    assert.equal(holder.module?.exports, ext);
  } finally {
    if (previous === undefined) {
      delete holder.module;
    } else {
      holder.module = previous;
    }
  }
});

test('defineExtension tolerates missing module (vm/bundler contexts)', () => {
  const ext: SourceExtension = {
    getPopularWorks: () => emptyPage(),
    getSearchWorks: () => emptyPage(),
  };
  const holder = globalThis as unknown as { module?: { exports?: unknown } };
  const previous = holder.module;
  delete holder.module;
  try {
    const returned = defineExtension(ext);
    assert.equal(returned, ext);
  } finally {
    if (previous !== undefined) {
      holder.module = previous;
    }
  }
});
