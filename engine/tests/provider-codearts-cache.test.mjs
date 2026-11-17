// provider-codearts-cache.test.mjs — the private refresh cache must be isolated per principal so that
// hand-added .enc accounts sharing one source file cannot leak each other's rotated AK/SK. Tests the pure
// path helper only; no DPAPI, no real credentials, no ambient network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {codeartsCachePath} from '../src/provider-codearts.mjs';

test('codearts: two principals on one source file get distinct cache paths', () => {
  const file = 'C:\\Users\\u\\AppData\\Roaming\\codearts-agent\\shared.enc';
  const a = codeartsCachePath(file, 'codearts:aaa', {localAppData: 'C:\\Users\\u\\AppData\\Local'});
  const b = codeartsCachePath(file, 'codearts:bbb', {localAppData: 'C:\\Users\\u\\AppData\\Local'});
  assert.notEqual(a, b, 'different principals must not share a cache file');
  assert.ok(a.includes('codearts-'), 'path keeps the codearts- prefix');
  assert.ok(a.endsWith('.json'), 'cache file keeps the .json extension');
  // Same principal, same file → stable path (deterministic hashing).
  assert.equal(codeartsCachePath(file, 'codearts:aaa', {localAppData: 'C:\\Users\\u\\AppData\\Local'}), a);
});

test('codearts: a missing principal falls back to the legacy file-only cache name', () => {
  const file = 'C:\\Users\\u\\AppData\\Roaming\\codearts-agent\\shared.enc';
  const legacy = codeartsCachePath(file, undefined, {localAppData: 'C:\\Users\\u\\AppData\\Local'});
  assert.ok(legacy.includes('codearts-'), 'keeps the codearts- prefix');
  // Legacy name has exactly one hash segment (file only), no trailing '-<principal>' suffix.
  const name = legacy.slice(legacy.lastIndexOf('\\') + 1);
  assert.equal(name.split('-').length, 2, 'legacy cache name is codearts-<filehash>.json with no principal segment');
  assert.ok(legacy.endsWith('.json'));
});

test('codearts: principal segment does not disturb the file-hash prefix (same file keeps the same base)', () => {
  const file = 'C:\\Users\\u\\AppData\\Roaming\\codearts-agent\\shared.enc';
  const root = 'C:\\Users\\u\\AppData\\Local';
  const a = codeartsCachePath(file, 'codearts:aaa', {localAppData: root});
  const b = codeartsCachePath(file, 'codearts:bbb', {localAppData: root});
  // Both share the leading 'codearts-<filehash>-' prefix; only the principal suffix differs.
  const prefix = a.slice(0, a.lastIndexOf('\\') + 1 + 'codearts-'.length + 16);
  assert.equal(b.startsWith(prefix), true, 'same source file shares the file-hash base prefix');
  assert.notEqual(a, b);
});
