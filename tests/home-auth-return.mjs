import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffHomeAuthReturn, homeAuthReturnDestination } from '../components/auth/home-auth-return-url.ts';

const origin = 'https://www.geofoxapps.com';
const access = 'test-only-access-token';
const refresh = 'test-only-refresh-token';
const fragment = type => new URLSearchParams({ type, access_token: access, refresh_token: refresh });

for (const type of ['invite', 'recovery']) {
  test(`${type} on the homepage goes to the password callback with fragment credentials`, () => {
    const target = new URL(homeAuthReturnDestination(`${origin}/#${fragment(type)}`), origin);
    assert.equal(target.origin, origin);
    assert.equal(target.pathname, '/auth/callback');
    assert.equal(target.searchParams.get('next'), '/admin/password');
    assert.deepEqual([...target.searchParams.keys()], ['next']);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(target.hash.slice(1))), { type, access_token: access, refresh_token: refresh });
  });
}

test('normal anchors and unrelated auth flows are not intercepted', () => {
  for (const suffix of ['', '#apps', '#company', '#type=invite', '?code=test-only-code', '#access_token=example&refresh_token=example', `#${fragment('signup')}`, `#${fragment('magiclink')}`, '#type=INVITE&access_token=example&refresh_token=example']) {
    assert.equal(homeAuthReturnDestination(`${origin}/${suffix}`), null);
  }
});

test('only the exact homepage is eligible for this fallback', () => {
  for (const path of ['/support', '/admin', '/auth/callback', '/admin/password', '/home', '//other.example/']) {
    assert.equal(homeAuthReturnDestination(`${origin}${path}#${fragment('invite')}`), null);
  }
  assert.equal(homeAuthReturnDestination('not a URL'), null);
  assert.equal(homeAuthReturnDestination(`file:///#${fragment('invite')}`), null);
});

test('untrusted redirects, provider tokens, and query parameters are never forwarded', () => {
  const input = `${origin}/?next=https://outside.example&code=do-not-forward#${fragment('invite')}&next=https://outside.example&redirect_to=//outside.example&provider_token=do-not-forward`;
  const target = new URL(homeAuthReturnDestination(input), origin);
  assert.equal(target.origin, origin);
  assert.equal(target.pathname, '/auth/callback');
  assert.equal(target.search, '?next=/admin/password');
  assert.equal(target.href.includes('outside.example'), false);
  assert.equal(target.href.includes('do-not-forward'), false);
});

test('recognized malformed returns reach the callback without forwarding partial credentials', () => {
  for (const value of [
    'type=invite&access_token=test-only-private',
    'type=recovery&refresh_token=test-only-private',
    'type=invite&access_token=&refresh_token=test-only-private',
    'type=invite&access_token=first&access_token=second&refresh_token=test-only-private',
    `type=recovery&access_token=${'a'.repeat(16385)}&refresh_token=test-only-private`,
    `type=invite&access_token=test-only-private&refresh_token=${'a'.repeat(4097)}`,
  ]) assert.equal(homeAuthReturnDestination(`${origin}/#${value}`), '/auth/callback?next=/admin/password#error=invalid_link');
});

test('provider error text and any included credentials are discarded', () => {
  const input = `${origin}/#${fragment('recovery')}&error=access_denied&error_description=private-account-information`;
  assert.equal(homeAuthReturnDestination(input), '/auth/callback?next=/admin/password#error=invalid_link');
});

test('ambiguous types and errors without an invite/recovery type are not treated as staff invitations', () => {
  assert.equal(homeAuthReturnDestination(`${origin}/#${fragment('invite')}&type=recovery`), null);
  assert.equal(homeAuthReturnDestination(`${origin}/#error=access_denied&error_code=otp_expired`), null);
});

test('credentials are removed from the current history entry before same-origin navigation', () => {
  const calls = [];
  const browser = {
    location: {
      href: `${origin}/?next=https://outside.example#${fragment('invite')}`,
      replace(value) { calls.push(['navigate', value]); this.href = new URL(value, origin).href; },
    },
    history: {
      replaceState(state, title, value) { calls.push(['clean', state, title, value]); browser.location.href = new URL(value, origin).href; },
    },
  };
  assert.equal(handoffHomeAuthReturn(browser), true);
  assert.deepEqual(calls[0], ['clean', null, '', '/']);
  assert.equal(calls[1][0], 'navigate');
  assert.equal(new URL(calls[1][1], origin).pathname, '/auth/callback');
  assert.equal(handoffHomeAuthReturn(browser), false);
  assert.equal(calls.length, 2);
});

test('ordinary homepage visits do not change history or navigate', () => {
  const browser = {
    location: { href: `${origin}/#apps`, replace() { assert.fail('Unexpected navigation'); } },
    history: { replaceState() { assert.fail('Unexpected history change'); } },
  };
  assert.equal(handoffHomeAuthReturn(browser), false);
});
