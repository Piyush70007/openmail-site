const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise chart rendering with API-shaped data without starting the mailbox.
const source = fs.readFileSync('app-ui.js', 'utf8');
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const context = vm.createContext({ document: { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) } });
vm.runInContext(source.slice(source.indexOf('function insightCount('), source.indexOf('function renderSimulationHistory(')) +
  source.slice(source.indexOf('function renderTrustMetrics('), source.indexOf('function trustDecisionLabel(')), context);
const all = node => [node, ...node.children.flatMap(all)];
const text = node => all(node).map(item => item.textContent).join(' ');

test('missing and invalid percentages stay unknown, while reported zero stays zero', () => {
  for (const value of [undefined, null, '', true, NaN, Infinity, 'unknown']) assert.equal(context.insightPercent(value), null);
  assert.equal(context.insightPercent(0), 0);
  assert.equal(context.insightPercent(-5), 0);
  assert.equal(context.insightPercent(105), 100);
  assert.equal(context.insightRate(0, 0), null);
  assert.equal(context.insightRate(0, 10), 0);
});

test('gauge exposes its meaning in accessible text and never draws an invalid arc', () => {
  const empty = context.insightGauge({title:'AI confidence',percent:null,detail:'No score reported',note:'Not accuracy'});
  assert.ok(all(empty).some(node => node.attributes['aria-label'] === 'AI confidence: no data yet. No score reported'));
  assert.equal(all(empty).filter(node => node.attributes.class === 'insight-gauge-fill').length, 0);
  const full = context.insightGauge({title:'Rate',percent:120,detail:'Checked answers',note:'Reviewed only'});
  assert.equal(all(full).find(node => node.attributes.class === 'insight-gauge-fill').attributes['stroke-dasharray'], '100 100');
});

test('horizontal bars compare absolute counts on a shared scale, without implying shares', () => {
  const bars = context.insightBars('Outcomes','Counts can overlap', [{label:'Replied',value:20},{label:'Resolved',value:10},{label:'Invalid',value:-4}]);
  assert.deepEqual(all(bars).filter(node => node.className === 'insight-bar-fill').map(node => node.style.width), ['100%', '50%', '0%']);
  assert.match(text(bars), /Counts can overlap/);
  assert.match(text(bars), /0–20 recorded events/);
});

test('reviewed accuracy excludes resolutions, handovers and unreviewed replies', () => {
  const root = new Element('div');
  context.renderTrustMetrics({days:30,summary:{totals:{markedCorrect:9,corrections:1,successfulResolutions:80,escalations:30,automaticReplies:300,labeledAccuracy:12,simulatorCases:5,simulatorPassed:4},byRepresentative:[{name:'Support',automaticReplies:12,escalations:3}]}},root);
  const labels = all(root).map(node => node.attributes['aria-label']).filter(Boolean);
  assert.deepEqual(labels, ['Answers marked correct: 90%. 9 correct out of 10 reviewed answers', 'Test pass rate: 80%. 4 of 5 practice tests passed']);
  assert.match(text(root), /practice tests cover your whole account/);
  assert.match(text(root), /Support · replies/);
});

test('an empty account shows no data instead of invented success percentages', () => {
  const root = new Element('div');
  context.renderTrustMetrics({days:7,summary:{totals:{},byRepresentative:[]}},root);
  const labels = all(root).map(node => node.attributes['aria-label']).filter(Boolean);
  assert.equal(labels.length,2);
  assert.ok(labels.every(label => label.includes('no data yet')));
  assert.match(text(root), /No team activity/);
  assert.doesNotMatch(text(root), /NaN|Infinity/);
});

test('opening a mail folder restores Compose after leaving AI or domain settings', () => {
  const controls = new Map();
  let click;
  const button = {dataset:{view:'inbox'},addEventListener:(_, callback)=>{click=callback;}};
  const state = vm.createContext({document:{querySelectorAll:()=>[button]}, closeNavigationMenu:()=>{}, selectedMessageIds:new Set(), selectedMailbox:{id:'owned-mailbox'}, systemStatus:{mailReady:true}, syncViewControls:()=>{}, domainsPanel:{}, aiPanel:{}, messageDetail:{}, inboxPane:{}, loadMessages:()=>Promise.resolve(), toast:()=>{}, $:id=>{ if(!controls.has(id)) controls.set(id,{disabled:true}); return controls.get(id); }});
  const start = source.indexOf('document.querySelectorAll(".mail-side-link[data-view], .mail-tab[data-view], .mobile-folder-scroll [data-view]")');
  vm.runInContext(source.slice(start, source.indexOf('$("#selectAll").addEventListener',start)),state);
  click();
  for(const id of ['#composeButton','#headingCompose','#mobileComposeButton']) assert.equal(controls.get(id).disabled,false);
  state.systemStatus.mailReady=false;
  click();
  for(const id of ['#composeButton','#headingCompose','#mobileComposeButton']) assert.equal(controls.get(id).disabled,true);
});
