import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePcAddressInput,
  parseQrPairingPayload,
  removeSavedPcAddress,
  toWebSocketUrl,
  upsertSavedPcAddress,
  type SavedPcAddress,
} from './pcAddressMath.ts';

test('parsePcAddressInput normalizes bare IP/host and extracts pair code from URLs', () => {
  const bare = parsePcAddressInput('192.168.1.45:3000');
  assert.deepEqual(bare, {
    address: 'http://192.168.1.45:3000',
    displayHost: '192.168.1.45:3000',
    pairCode: undefined,
  });

  const fullQrUrl = parsePcAddressInput('https://office-pc.local:3000/?pair=482910&mode=mobile');
  assert.deepEqual(fullQrUrl, {
    address: 'https://office-pc.local:3000',
    displayHost: 'office-pc.local:3000',
    pairCode: '482910',
  });

  assert.equal(parsePcAddressInput('   '), null);
});

test('upsertSavedPcAddress saves new entries at top, deduplicates case-insensitively, and preserves codes', () => {
  const first = upsertSavedPcAddress([], {
    address: '192.168.1.10:3000',
    label: 'Office PC',
    pairCode: '112233',
    nowIso: '2026-11-26T01:00:00Z',
    idFactory: () => 'pc_1',
  });
  assert.equal(first.nextList.length, 1);
  assert.equal(first.savedEntry?.label, 'Office PC');

  const second = upsertSavedPcAddress(first.nextList, {
    address: '192.168.1.25:3000',
    nowIso: '2026-11-26T02:00:00Z',
    idFactory: () => 'pc_2',
  });
  assert.equal(second.nextList.length, 2);
  assert.equal(second.nextList[0].id, 'pc_2');

  // Re-selecting/updating first PC brings it to top and keeps its id & label
  const updated = upsertSavedPcAddress(second.nextList, {
    address: 'HTTP://192.168.1.10:3000/',
    pairCode: '654321',
    nowIso: '2026-11-26T03:00:00Z',
  });
  assert.equal(updated.nextList.length, 2);
  assert.equal(updated.nextList[0].id, 'pc_1');
  assert.equal(updated.nextList[0].label, 'Office PC');
  assert.equal(updated.nextList[0].pairCode, '654321');
});

test('removeSavedPcAddress removes only target item and toWebSocketUrl picks ws vs wss', () => {
  const items: SavedPcAddress[] = [
    {
      id: 'pc_1',
      address: 'http://192.168.1.10:3000',
      displayHost: '192.168.1.10:3000',
      label: 'Desk 1',
      lastUsedAt: '2026-11-26T01:00:00Z',
    },
    {
      id: 'pc_2',
      address: 'https://scan.example.com',
      displayHost: 'scan.example.com',
      label: 'Cloud Relay',
      lastUsedAt: '2026-11-26T02:00:00Z',
    },
  ];

  const remaining = removeSavedPcAddress(items, 'pc_1');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'pc_2');

  assert.equal(toWebSocketUrl('192.168.1.10:3000'), 'ws://192.168.1.10:3000/ws');
  assert.equal(toWebSocketUrl('https://scan.example.com'), 'wss://scan.example.com/ws');
});

test('parseQrPairingPayload parses desktop pairing URLs, JSON payloads, schemes, and raw 6-digit codes', () => {
  assert.deepEqual(
    parseQrPairingPayload('http://192.168.1.25:3000/?pair=482910&mode=mobile'),
    {
      address: 'http://192.168.1.25:3000',
      pairCode: '482910',
      label: '192.168.1.25:3000',
    }
  );

  assert.deepEqual(
    parseQrPairingPayload('{"address":"10.0.0.15:3000","pairCode":"918273","label":"Reception"}'),
    {
      address: 'http://10.0.0.15:3000',
      pairCode: '918273',
      label: 'Reception',
    }
  );

  assert.deepEqual(
    parseQrPairingPayload('oklivo://pair?host=192.168.0.5:3000&code=554433'),
    {
      address: 'http://192.168.0.5:3000',
      pairCode: '554433',
      label: '192.168.0.5:3000',
    }
  );

  assert.deepEqual(parseQrPairingPayload('778899'), { pairCode: '778899' });
  assert.deepEqual(parseQrPairingPayload('pair: 123456'), { pairCode: '123456' });
  assert.equal(parseQrPairingPayload('random text'), null);
});
