// Tests for the site-list and format helpers in shared/sites.ts and shared/formats.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { couldBeFormat, detectFormat } from '../src/shared/formats.ts';
import { findSite, formatsFor, isSiteEnabled, normalizeOrigin, originToMatch, siteKey } from '../src/shared/sites.ts';
import type { FormatId } from '../src/shared/types.ts';
import { installI18n } from './chrome-i18n.ts';

installI18n('en');

test('normalizeOrigin: plain addresses', () => {
  assert.equal(normalizeOrigin('app.example.com'), 'https://app.example.com');
  assert.equal(normalizeOrigin(' https://App.Example.com:8080/x?y '), 'https://app.example.com');
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost');
});

test('normalizeOrigin: leading wildcard', () => {
  assert.equal(normalizeOrigin('*.example.com'), 'https://*.example.com');
  assert.equal(normalizeOrigin('*.Example.com/path'), 'https://*.example.com');
  assert.equal(normalizeOrigin('http://*.example.com'), 'http://*.example.com');
});

test('normalizeOrigin: rejects invalid entries', () => {
  assert.throws(() => normalizeOrigin(''), /Enter a site address/);
  assert.throws(() => normalizeOrigin('ftp://example.com'), /http\(s\)/);
  assert.throws(() => normalizeOrigin('app.*.example.com'), /asterisk/);
  assert.throws(() => normalizeOrigin('app-*.example.com'), /asterisk/);
  assert.throws(() => normalizeOrigin('*.*.example.com'), /asterisk/);
});

test('originToMatch and siteKey', () => {
  assert.equal(originToMatch('https://app.example.com'), 'https://app.example.com/*');
  assert.equal(originToMatch('https://*.example.com'), 'https://*.example.com/*');
  assert.equal(originToMatch('https://app.example.com/a/b?c'), 'https://app.example.com/*');
  assert.equal(siteKey('https://*.Example.com'), 'https://*.example.com');
  assert.equal(siteKey('not an address'), null);
});

test('findSite: exact match', () => {
  const sites = ['https://app.example.com'];
  assert.equal(findSite('https://app.example.com/x', sites), 'https://app.example.com');
  assert.equal(findSite('https://other.example.com/', sites), null);
  assert.equal(findSite('http://app.example.com/', sites), null);
});

test('findSite: wildcard covers the domain and subdomains (like Chrome patterns)', () => {
  const sites = ['https://*.example.com'];
  assert.equal(findSite('https://example.com/', sites), 'https://*.example.com');
  assert.equal(findSite('https://app.example.com/x', sites), 'https://*.example.com');
  assert.equal(findSite('https://a.b.example.com/', sites), 'https://*.example.com');
  assert.equal(findSite('https://*.a.example.com', sites), 'https://*.example.com');
  assert.equal(findSite('https://badexample.com/', sites), null);
  assert.equal(findSite('https://example.com.evil.net/', sites), null);
  assert.equal(findSite('http://app.example.com/', sites), null);
});

test('findSite: the most specific entry wins, regardless of order', () => {
  const sites = ['https://*.example.com', 'https://*.app.example.com', 'https://app.example.com'];
  assert.equal(findSite('https://app.example.com/', sites), 'https://app.example.com');
  assert.equal(findSite('https://x.app.example.com/', sites), 'https://*.app.example.com');
  assert.equal(findSite('https://api.example.com/', sites), 'https://*.example.com');
  assert.equal(isSiteEnabled('https://api.example.com/', sites), true);
  assert.equal(isSiteEnabled('chrome://extensions/', sites), false);
});

test('formatsFor: formats of the most specific entry, JSON by default', () => {
  const settings = {
    sites: ['https://*.example.com', 'https://app.example.com', 'https://other.org'],
    siteFormats: { 'https://*.example.com': ['json', 'csv'], 'https://app.example.com': ['xml'] } as Record<
      string,
      FormatId[]
    >,
  };
  assert.deepEqual(formatsFor('https://api.example.com/x', settings), ['json', 'csv']);
  assert.deepEqual(formatsFor('https://app.example.com/x', settings), ['xml']);
  assert.deepEqual(formatsFor('https://other.org/', settings), ['json']);
  assert.deepEqual(formatsFor('https://unknown.pl/', settings), []);
});

test('detectFormat: only enabled formats', () => {
  assert.equal(detectFormat({ mime: 'text/csv', name: 'a.csv', text: 'a;b' }, ['json']), null);
  assert.equal(detectFormat({ mime: 'text/csv', name: 'a.csv', text: 'a;b' }, ['json', 'csv']), 'csv');
  assert.equal(detectFormat({ mime: 'text/plain', name: 'a.txt', text: '{"a":1}' }, ['text']), 'text');
  assert.equal(detectFormat({ mime: 'text/plain', name: 'a.txt', text: '{"a":1}' }, ['json', 'text']), 'json');
  // Server downloads: name taken from a URL with a query string.
  assert.equal(detectFormat({ mime: '', name: ['', 'https://x.pl/api/export.json?v=2'] }), 'json');
  // text/plain: only with no extension or a text one; a URL's domain is not an extension.
  assert.equal(detectFormat({ mime: 'text/plain', name: 'backup.sql', text: 'x' }), null);
  assert.equal(detectFormat({ mime: 'text/plain', name: ['', 'https://company.pl'], text: 'x' }), 'text');
  assert.equal(detectFormat({ mime: 'text/plain', name: ['report', 'https://x.pl/dl?id=1'], text: 'x' }), 'text');
});

test('couldBeFormat: pre-filter before reading the content', () => {
  assert.equal(couldBeFormat({ mime: 'text/plain', name: 'x' }, ['json']), true);
  assert.equal(couldBeFormat({ mime: 'text/plain', name: 'x' }, ['csv']), false);
  assert.equal(couldBeFormat({ mime: 'application/pdf', name: 'a.pdf' }, ['json', 'csv', 'xml', 'text']), false);
  assert.equal(couldBeFormat({ mime: 'text/csv', name: 'a.csv' }, ['csv']), true);
});
