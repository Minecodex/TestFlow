const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual prototype logic, with no browser, DOM or network shortcuts.
function loadDemo({ now, randomSeed } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../docs/demo.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script); // Include event handlers in syntax validation.
  const prefix = script.slice(0, script.indexOf("document.addEventListener('click'"));
  const sandbox = { Blob, URL, performance, setTimeout, clearTimeout };
  if (now !== undefined) {
    sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
  }
  if (randomSeed !== undefined) {
    let seed = randomSeed;
    sandbox.Math = Object.create(Math);
    sandbox.Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  }
  vm.createContext(sandbox);
  vm.runInContext(prefix + '\nthis.demo={state,clone,moduleRuntimeErrors,makeNode,flowSnapshot,validateFlow,buildTask,makeExecution,runExecution,caseInputErrors,pairErrors,resolveInputs,latestAttempt,latestEval,verdict,rates,taskCounts,reportSnapshot,evaluationFor,taskResultStatus,outputPreview,controllers,pageRenderers,actions};', sandbox);
  sandbox.demo.state.route = 'modules';
  return sandbox.demo;
}

module.exports = { loadDemo };
