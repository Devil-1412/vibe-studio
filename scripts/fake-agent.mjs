// Stand-in for `claude -p --input-format stream-json`: one result line per user message, interrupt support.
import readline from 'readline';

let pending;
let waiting;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const d = JSON.parse(line);
  if (d.type === 'user') {
    const c = d.message.content; // a string, or an array of blocks when files are attached
    const text = typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join('');
    console.log(JSON.stringify({ type: 'assistant', pid: process.pid, text }));
    // "ask" / "askq" wait for the host's answer to a can_use_tool request, like the real CLI
    if (text === 'ask' || text === 'askq') {
      waiting = text === 'ask' ? 'r1' : 'r2';
      const input = text === 'ask' ? { command: 'ls' } : { questions: [{ question: 'Which?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] };
      console.log(JSON.stringify({ type: 'control_request', request_id: waiting, request: { subtype: 'can_use_tool', tool_name: text === 'ask' ? 'Bash' : 'AskUserQuestion', input, tool_use_id: 't1', permission_suggestions: [] } }));
      return;
    }
    // "slow" messages wait for an interrupt instead of finishing
    if (text === 'slow') return void (pending = true);
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, pid: process.pid }));
  } else if (d.type === 'control_response' && waiting && d.response?.request_id === waiting) {
    console.log(JSON.stringify({ type: 'assistant', pid: process.pid, text: 'answer:' + JSON.stringify(d.response.response) }));
    waiting = undefined;
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, pid: process.pid }));
  } else if (d.type === 'control_request' && d.request.subtype === 'set_permission_mode') {
    console.log(JSON.stringify({ type: 'assistant', pid: process.pid, text: 'mode:' + d.request.mode }));
  } else if (d.type === 'control_request' && d.request.subtype === 'interrupt' && waiting) {
    console.log(JSON.stringify({ type: 'control_cancel_request', request_id: waiting }));
    waiting = undefined;
    console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, pid: process.pid }));
  } else if (d.type === 'control_request' && d.request.subtype === 'interrupt' && pending) {
    pending = false;
    console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, pid: process.pid }));
  }
});
