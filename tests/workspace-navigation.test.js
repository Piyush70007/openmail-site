const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app-ui.js', 'utf8');

function workspace() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, open: false, dataset: {}, textContent: '', value: '',
      classList: { toggle() {}, remove() {}, add() {} },
      contains: () => false, replaceChildren() {}, append() {},
    });
    return elements.get(selector);
  };
  let loads = 0;
  let resolve;
  const events = [];
  const views = [];
  const context = vm.createContext({
    $: element, document: { querySelectorAll: () => [], dispatchEvent: event => events.push(event.type), createElement: () => ({}) }, Event,
    aiPanel: { hidden: true, dataset: {} }, domainsPanel: {}, inboxPane: {}, messageDetail: {},
    selectedMailbox: { id: 'mailbox-a', address: 'support@example.test' },
    setAIView: (view, load) => views.push({ view, load }),
    openInbox() { context.aiPanel.hidden = true; },
    loadAISetup() { loads++; return new Promise(done => { resolve = done; }); },
  });
  vm.runInContext(source.slice(source.indexOf('let aiPanelLoadPromise'), source.indexOf('async function api(')), context);
  return { context, elements, element, events, views, loads: () => loads, settle: async () => { resolve(); await Promise.resolve(); } };
}

test('switching AI sections preserves form edits and shares a pending setup request', async () => {
  const w = workspace();
  w.context.navigateWorkspace('knowledge');
  w.element('#aiCompanyName').value = 'Unsaved company change';
  w.context.navigateWorkspace('team');
  w.context.navigateWorkspace('trust');
  assert.equal(w.loads(), 1);
  assert.equal(w.events.length, 1);
  assert.deepEqual(w.views.at(-1), { view: 'trust', load: false });
  await w.settle();
  w.context.navigateWorkspace('knowledge');
  w.context.navigateWorkspace('workflows');
  assert.equal(w.loads(), 1);
  assert.equal(w.element('#aiCompanyName').value, 'Unsaved company change');
  assert.deepEqual(w.views.at(-1), { view: 'workflows', load: true });
  assert.equal(w.element('#mobileWorkspaceCurrent').textContent, 'Mail rules');
  assert.equal(w.element('.ai-workspace').hidden, true);
  assert.equal(w.element('.ai-automation-card').hidden, true);
});

test('AI reply settings and company knowledge appear in their own sections', async () => {
  const w = workspace();
  w.context.navigateWorkspace('representative');
  assert.equal(w.element('.ai-automation-card').hidden, false);
  assert.equal(w.element('.ai-workspace').hidden, true);
  assert.equal(w.element('.ai-data-disclosure').hidden, false);
  await w.settle();
  w.context.navigateWorkspace('knowledge');
  assert.equal(w.element('.ai-automation-card').hidden, true);
  assert.equal(w.element('.ai-workspace').hidden, false);
  w.context.navigateWorkspace('inbox');
  assert.equal(w.context.aiPanel.hidden, true);
  w.context.selectedMailbox = { id: 'mailbox-b', address: 'sales@example.test' };
  w.context.navigateWorkspace('representative');
  assert.equal(w.loads(), 2);
  assert.equal(w.element('#currentMailboxHeading').textContent, 'SALES@EXAMPLE.TEST');
  await w.settle();
});

test('stale AI setup responses cannot overwrite another mailbox’s controls', async () => {
  const w = workspace();
  vm.runInContext(source.slice(source.indexOf('async function loadAISetup('), source.indexOf('$("#aiProfileForm").addEventListener')), w.context);
  w.context.api = async () => ({});
  const request = w.context.loadAISetup();
  w.context.selectedMailbox = { id: 'mailbox-b' };
  await request;
  assert.equal(w.element('#aiCompanyName').value, '');
  assert.equal(w.elements.has('#aiAutomaticReplies'), false);
});

test('demo and both real navigation variants keep the same seven sections', () => {
  const demo = fs.readFileSync('frontend/src/ProductDemo.jsx', 'utf8');
  const ids = [...demo.slice(demo.indexOf('const VIEWS ='), demo.indexOf('const CATEGORIES =')).matchAll(/id: "([^"]+)"/g)].map(match => match[1]);
  const html = fs.readFileSync('app.html', 'utf8');
  const liveIds = [...html.matchAll(/data-workspace-view="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 7);
  assert.deepEqual(liveIds, [...ids, ...ids]);
  assert.match(html, /workspace-navigation\.css/);
  assert.match(demo, /import "\.\.\/\.\.\/workspace-navigation\.css"/);
});

test('a setup failure stays visible from every AI tool and allows another load', async () => {
  const w = workspace();
  w.context.api = async () => { throw new Error('Please try again shortly.'); };
  vm.runInContext(source.slice(source.indexOf('async function loadAISetup('), source.indexOf('$("#aiProfileForm").addEventListener')), w.context);
  await w.context.loadAISetup();
  assert.equal(w.element('#aiWorkspaceLoadNotice').hidden, false);
  assert.match(w.element('#aiWorkspaceLoadStatus').textContent, /couldn’t load your AI workspace/);
  assert.equal(vm.runInContext('aiPanelLoadMailbox', w.context), undefined);
});
