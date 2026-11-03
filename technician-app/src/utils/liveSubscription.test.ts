import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRefCountedSubscription } from './liveSubscription.ts';

const tracker = () => {
  let attaches = 0;
  let detaches = 0;
  const sub = createRefCountedSubscription(() => {
    attaches += 1;
    return () => { detaches += 1; };
  });
  return { sub, attaches: () => attaches, detaches: () => detaches };
};

test('opens one stream however many holders ask for it', () => {
  const { sub, attaches } = tracker();
  sub.acquire();
  sub.acquire();
  sub.acquire();
  assert.equal(attaches(), 1);
  assert.equal(sub.holders(), 3);
});

test('only detaches once the last holder leaves', () => {
  const { sub, detaches } = tracker();
  const releaseApp = sub.acquire();
  const releaseScreen = sub.acquire();

  releaseScreen();
  assert.equal(sub.isLive(), true);
  assert.equal(detaches(), 0);

  releaseApp();
  assert.equal(sub.isLive(), false);
  assert.equal(detaches(), 1);
  assert.equal(sub.holders(), 0);
});

test('re-attaches after everyone has left', () => {
  const { sub, attaches } = tracker();
  const first = sub.acquire();
  first();
  sub.acquire();
  assert.equal(attaches(), 2);
});

test('a second release cannot drive the count negative or detach twice', () => {
  const { sub, detaches } = tracker();
  const release = sub.acquire();
  release();
  release();
  assert.equal(sub.holders(), 0);
  assert.equal(detaches(), 1);
});

test('restart re-opens the stream for the holders that remain', () => {
  const { sub, attaches, detaches } = tracker();
  sub.acquire();
  sub.restart();
  assert.equal(attaches(), 2);
  assert.equal(detaches(), 1);
  assert.equal(sub.isLive(), true);
  assert.equal(sub.holders(), 1);
});

test('restart is a no-op when nothing is subscribed', () => {
  const { sub, attaches } = tracker();
  sub.restart();
  assert.equal(attaches(), 0);
});
