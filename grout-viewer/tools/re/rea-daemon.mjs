// Keeps ONE Ghidra session open (the first query imports and analyses the binary, 10-15 minutes; every later query takes seconds).
// It talks to REA (https://github.com/morluto/rea, npm "rea-agents") over MCP/stdio and serves requests from a folder queue:
//   write  <dir>/in/<name>.json   = { "name": "<REA tool>", "args": { ... } }      e.g. search_strings, xrefs, procedure_pseudo_code,
//                                    resolve_containing_procedure, read_function_instructions, read_bytes, search_bytes, ...
//   read   <dir>/out/<name>.json  = the tool's JSON answer (or "ERROR ..." text)
// Setup (once, inside a work folder, NOT inside the repo):
//   npm install rea-agents @modelcontextprotocol/client --ignore-scripts
//   download Ghidra 12.1.x (portable zip) and a 64-bit JDK 21 and unpack them anywhere
// Run (from the work folder; paths are examples):
//   set GHIDRA_INSTALL_DIR=...\ghidra_12.1.4_PUBLIC  JAVA_HOME=...\jdk-21  REA_ANALYSIS_PROVIDER=ghidra
//   set REA_GHIDRA_STARTUP_TIMEOUT_MS=1800000  REA_GHIDRA_DISABLED_ANALYZERS=WindowsResourceReference
//   node rea-daemon.mjs <path to a COPY of DLGPVD.EXE> <queue dir>
// Ghidra drops x87 results from its decompiler output (VB6 arithmetic): read formulas from read_function_instructions, not from the pseudo code.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [target, dir] = process.argv.slice(2);
if (!target || !dir) { console.error('usage: node rea-daemon.mjs <binary copy> <queue dir>'); process.exit(2); }
const IN = path.join(dir, 'in'), OUT = path.join(dir, 'out'), log = (m) => fs.appendFileSync(path.join(dir, 'daemon.log'), new Date().toISOString() + ' ' + m + '\n');
fs.mkdirSync(IN, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const transport = new StdioClientTransport({ command: 'node', args: ['node_modules/rea-agents/scripts/rea.mjs', '--mcp'], env: { ...process.env }, stderr: 'pipe' });
const client = new Client({ name: 'daemon', version: '1' });
await client.connect(transport); log('connected');
const call = (name, args, ms = 1800000) => client.callTool({ name, arguments: args }, { timeout: ms });
const opened = await call('open_binary', { path: path.resolve(target), provider_id: 'ghidra' });
fs.writeFileSync(path.join(OUT, '_open.json'), JSON.stringify(opened)); log('opened');
for (;;) {
  for (const f of fs.readdirSync(IN).filter((x) => x.endsWith('.json')).sort()) {
    const p = path.join(IN, f); let req;
    try { req = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
    fs.unlinkSync(p);
    try { const res = await call(req.name, req.args || {}); fs.writeFileSync(path.join(OUT, f), (res.content || []).map((x) => x.text || '').join('\n') || JSON.stringify(res)); log('done ' + f); }
    catch (e) { fs.writeFileSync(path.join(OUT, f), 'ERROR ' + e.message); log('error ' + f + ' ' + e.message); }
  }
  await new Promise((r) => setTimeout(r, 500));
}
