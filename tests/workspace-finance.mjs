import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingCsv, accountingTotals, csvCell, parseAmountCents } from '../lib/workspace/accounting.ts';
import { emptyLegalData, legalStarterRecords, localDay, nextLegalDate, safeSourceUrl, shiftDate, starterRequestId } from '../lib/workspace/legal-starters.ts';

function transaction(type, amountCents, status = 'paid', extra = {}) {
  return { id: 'test', module: 'accounting', appSlug: null, title: 'Bookkeeping entry', status, version: 1, createdAt: '2026-11-04T12:00:00Z', updatedAt: '2026-11-04T12:00:00Z', createdBy: 'test', data: { type, amountCents, currency: 'USD', occurredOn: '2026-11-04', category: 'Other', payee: '', reference: '', notes: '', attachments: [], ...extra } };
}

test('cashbook parses exact cents and rejects ambiguous or invalid amounts', () => {
  assert.equal(parseAmountCents('0.01'), 1);
  assert.equal(parseAmountCents('0.29'), 29);
  assert.equal(parseAmountCents('1.1'), 110);
  assert.equal(parseAmountCents(' 42 '), 4200);
  assert.equal(parseAmountCents('999999999.99'), 99999999999);
  for (const value of ['', '0', '-1', '+1', '1,000', '1e3', 'NaN', 'Infinity', '1.001', '.99', '1000000000']) {
    assert.equal(parseAmountCents(value), null, value);
  }
});

test('paid operating totals separate capital, transfers, pending, and void entries', () => {
  const entries = [
    transaction('income', 1050), transaction('expense', 299),
    transaction('owner_contribution', 50000), transaction('owner_draw', 10000), transaction('transfer', 8000),
    transaction('income', 123, 'pending'), transaction('expense', 321, 'pending'), transaction('owner_draw', 1, 'pending'),
    transaction('income', 900000, 'void'), transaction('expense', 900000, 'void'), transaction('owner_contribution', 900000, 'void'),
    transaction('income', 900000, 'unexpected'), transaction('income', Number.NaN), transaction('expense', -500),
  ];
  assert.deepEqual(accountingTotals(entries), {
    income: 1050, expenses: 299, contributions: 50000, draws: 10000, transfers: 8000,
    pendingIncome: 123, pendingExpenses: 321, pendingCount: 3, net: 751, cashMovement: 40751,
  });
  assert.equal(accountingTotals([transaction('expense', 999, 'void')]).pendingCount, 0);
});

test('CSV quotes user text and prevents spreadsheet formula execution', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-1+1', '@SUM(A1)', '  =1', '\t=1', '\rtext', '\ntext']) {
    assert.ok(csvCell(value).startsWith('"\''), value);
  }
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('42.00'), '"42.00"');
  const item = transaction('income', 29, 'paid', { payee: '=WEBSERVICE("https://example.test")' });
  item.title = 'Revenue, November';
  const csv = accountingCsv([item]);
  assert.ok(csv.includes('"0.29"'));
  assert.ok(csv.includes('"Revenue, November"'));
  assert.ok(csv.includes('"\'=WEBSERVICE(""https://example.test"")"'));
  assert.equal(csv.split('\r\n').length, 2);
});

test('recurrences preserve calendar dates with month-end clamping', () => {
  assert.equal(shiftDate('2027-01-31', 1), '2027-02-28');
  assert.equal(shiftDate('2028-01-31', 1), '2028-02-29');
  assert.equal(shiftDate('2028-02-29', 12), '2029-02-28');
  assert.equal(shiftDate('2026-11-30', 3), '2027-02-28');
  assert.equal(nextLegalDate({ ...emptyLegalData(), dueDate: '2027-05-17', recurrence: 'annual' }), '2028-05-17');
  assert.equal(nextLegalDate({ ...emptyLegalData(), reviewDate: '2026-11-04', recurrence: 'quarterly' }), '2027-02-04');
  for (const recurrence of ['none', 'continuous']) assert.equal(nextLegalDate({ ...emptyLegalData(), dueDate: '2027-05-17', recurrence }), null);
  assert.equal(localDay(new Date('2026-11-04T01:00:00Z')), '2026-11-03');
});

test('starter checklist imports review prompts, with no assumed fees or filing deadlines', () => {
  const company = legalStarterRecords('company', ['novanook'], '2026-11-04');
  const app = legalStarterRecords('novanook', ['novanook'], '2026-11-04');
  const all = legalStarterRecords('all', ['novanook', 'example-app'], '2026-11-04');
  assert.equal(company.length, 5);
  assert.equal(app.length, 2);
  assert.equal(all.length, 9);
  assert.ok(company.every((record) => record.appSlug === null));
  assert.ok(app.every((record) => record.appSlug === 'novanook'));
  for (const record of all) {
    assert.equal(record.data.dueDate, null);
    assert.equal(record.data.amountCents, null);
    assert.equal(record.data.reviewDate, '2026-11-04');
    assert.equal(record.status, 'open');
    assert.ok(record.data.condition.length > 0);
    assert.match(record.data.sourceUrl, /^https:\/\//);
  }
  const ids = all.map((record) => starterRequestId(record.data.starterKey, record.appSlug));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(starterRequestId('registered-agent', null), starterRequestId('registered-agent', null));
  assert.notEqual(starterRequestId('coppa-review', 'novanook'), starterRequestId('coppa-review', 'example-app'));
});

test('source links match the HTTPS-only API contract and reject credentials', () => {
  assert.equal(safeSourceUrl('https://www.irs.gov/'), 'https://www.irs.gov/');
  for (const url of ['http://www.irs.gov/', 'https://user:password@example.test/', 'javascript:alert(1)', 'data:text/html,hi', 'file:///tmp/file', '/relative', 'not a url']) assert.equal(safeSourceUrl(url), undefined);
});
