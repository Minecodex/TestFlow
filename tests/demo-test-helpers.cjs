const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual prototype logic, with no browser, DOM or network shortcuts.
function loadDemo() {
  const html = fs.readFileSync(path.join(__dirname, '../docs/demo.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(script); // Include event handlers in syntax validation.
  const prefix = script.slice(0, script.indexOf("document.addEventListener('click'"));
  const sandbox = { Blob, URL, performance, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(prefix + '\nthis.demo={state,clone,moduleRuntimeErrors,makeNode,flowSnapshot,validateFlow,buildTask,makeExecution,runExecution,caseInputErrors,pairErrors,resolveInputs,latestAttempt,latestEval,verdict,rates,taskCounts,reportSnapshot,evaluationFor,taskResultStatus,outputPreview,controllers,pageRenderers};', sandbox);
  sandbox.demo.state.route = 'modules';
  return sandbox.demo;
}

module.exports = { loadDemo };
