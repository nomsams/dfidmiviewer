// Static, dependency-free PE32/VB6 inventory. Never loads or executes the target.
// Layout references: https://github.com/williballenthin/python-vb/blob/master/vb/__init__.py
// and https://sandsprite.com/vbdec/VB6_FileFormat_Spec.html (native lpMethods caveat).
// Usage: node tools/re/vb6-map.mjs <binary COPY> <output.json> [GhidraScript.java]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export class Pe32 {
  constructor(bytes) {
    this.bytes = Buffer.from(bytes);
    const b = this.bytes;
    this.range(0, 64);
    if (b.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected a DOS/PE header');
    const pe = b.readUInt32LE(60); this.range(pe, 24);
    if (b.readUInt32LE(pe) !== 0x4550 || b.readUInt16LE(pe + 4) !== 0x14c) throw new Error('Expected an x86 PE');
    const opt = pe + 24, size = b.readUInt16LE(pe + 20);
    this.range(opt, size);
    if (size < 96 || b.readUInt16LE(opt) !== 0x10b) throw new Error('Expected PE32 optional header');
    this.imageBase = b.readUInt32LE(opt + 28);
    this.entry = this.imageBase + b.readUInt32LE(opt + 16);
    this.headerSize = b.readUInt32LE(opt + 60);
    const n = b.readUInt16LE(pe + 6), start = opt + size;
    this.range(start, n * 40);
    this.sections = Array.from({ length: n }, (_, i) => {
      const o = start + i * 40, raw = b.readUInt32LE(o + 20), rawSize = b.readUInt32LE(o + 16);
      this.range(raw, rawSize);
      return { name: b.toString('ascii', o, o + 8).replace(/\0.*$/, ''), rva: b.readUInt32LE(o + 12), raw, rawSize,
        executable: !!(b.readUInt32LE(o + 36) & 0x20000000) };
    });
  }
  range(offset, size) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > this.bytes.length) throw new Error('Truncated PE data');
    return offset;
  }
  offset(address, size = 1) {
    const rva = address - this.imageBase;
    if (rva >= 0 && rva + size <= this.headerSize) return this.range(rva, size);
    const section = this.sections.find(s => rva >= s.rva && rva + size <= s.rva + s.rawSize);
    if (!section) throw new Error('VA is not backed by file data: 0x' + address.toString(16));
    return this.range(section.raw + rva - section.rva, size);
  }
  address(offset) {
    const s = this.sections.find(s => offset >= s.raw && offset < s.raw + s.rawSize);
    if (s) return this.imageBase + s.rva + offset - s.raw;
    if (offset >= 0 && offset < this.headerSize) return this.imageBase + offset;
    throw new Error('File offset is not mapped');
  }
  u16(address) { return this.bytes.readUInt16LE(this.offset(address, 2)); }
  u32(address) { return this.bytes.readUInt32LE(this.offset(address, 4)); }
  string(address) {
    if (!address) return null;
    const o = this.offset(address), end = this.bytes.indexOf(0, o);
    if (end < 0 || end - o > 4096) throw new Error('Invalid VB name');
    this.offset(address, end - o + 1);
    return this.bytes.toString('latin1', o, end);
  }
  executable(address) {
    return this.sections.some(s => s.executable && address >= this.imageBase + s.rva && address < this.imageBase + s.rva + s.rawSize);
  }
}

export function mapVb6(bytes) {
  const pe = new Pe32(bytes), b = pe.bytes;
  // Follow the entry-point push, instead of accepting an incidental 'VB5!' string.
  const entry = pe.offset(pe.entry, 10);
  if (b[entry] !== 0x68 || b[entry + 5] !== 0xe8) throw new Error('Expected VB entry-point push/call');
  const header = b.readUInt32LE(entry + 1), h = pe.offset(header, 0x68);
  if (b.toString('ascii', h, h + 4) !== 'VB5!') throw new Error('Invalid VB header signature');
  const project = pe.u32(header + 0x30), table = pe.u32(project + 4);
  const native = pe.u32(project + 0x20) !== 0;
  const n = pe.u16(table + 0x2a), array = pe.u32(table + 0x30);
  pe.offset(array, n * 0x30);
  const objects = [], warnings = [], symbols = [];
  for (let i = 0; i < n; i++) {
    const address = array + i * 0x30, info = pe.u32(address), flags = pe.u32(address + 0x28);
    const count = pe.u32(address + 0x1c), names = pe.u32(address + 0x20);
    if (count > 65535) throw new Error('Invalid VB procedure count');
    if (names) pe.offset(names, count * 4);
    const object = { index: i, address, info, name: pe.string(pe.u32(address + 0x18)), flags, procedureCount: count,
      // Native ObjectInfo.lpMethods contains API declarations, not application procedures.
      procedureNames: names ? Array.from({ length: count }, (_, j) => pe.string(pe.u32(names + j * 4))) : [], nativeProcedures: [], controls: [] };
    if (flags & 0x80) {
      const opt = info + 0x38, controls = pe.u32(opt + 0x24), c = pe.u32(opt + 0x20);
      // Native forms retain a method-link table even when their private names are stripped.
      // Its pointers enter at the E9 jump (eight bytes after the this-adjustment thunk).
      const links = pe.u32(opt + 0x30), linkCount = pe.u16(opt + 0x28);
      if (native && linkCount) {
        pe.offset(links, linkCount * 4);
        for (let index = 0; index < linkCount; index++) {
          const thunk = pe.u32(links + index * 4), off = pe.offset(thunk, 5);
          if (b[off] !== 0xe9) { warnings.push('Unsupported native method link at 0x' + thunk.toString(16)); continue; }
          const target = thunk + 5 + b.readInt32LE(off + 1);
          if (!pe.executable(target)) throw new Error('VB method target is outside executable data');
          object.nativeProcedures.push({ index, thunk, address: target, name: object.procedureNames[index] || null });
        }
      }
      if (c > 65535) throw new Error('Invalid VB control count');
      if (c) pe.offset(controls, c * 0x28);
      for (let j = 0; j < c; j++) {
        const ci = controls + j * 0x28, type = pe.u16(ci), eventCount = pe.u16(ci + 2), eventTable = pe.u32(ci + 0x18);
        const control = { name: pe.string(pe.u32(ci + 0x20)), index: pe.u16(ci + 0x0c), type, events: [] };
        // Decode only the known native table/thunk shape; preserve unknown slot numbers.
        if (native && type === 0x40 && eventTable) {
          pe.offset(eventTable, 0x18 + eventCount * 4);
          for (let slot = 0; slot < eventCount; slot++) {
            const thunk = pe.u32(eventTable + 0x18 + slot * 4);
            if (!thunk) continue;
            const off = pe.offset(thunk, 13);
            if (b.subarray(off, off + 4).equals(Buffer.from([0x81, 0x6c, 0x24, 0x04])) && b[off + 8] === 0xe9) {
              const target = thunk + 13 + b.readInt32LE(off + 9);
              if (!pe.executable(target)) throw new Error('VB event target is outside executable data');
              control.events.push({ slot, thunk, address: target });
              symbols.push({ address: target, name: object.name + '_' + control.name + '_event' + slot, evidence: 'native-event-thunk' });
            } else warnings.push('Unsupported event thunk at 0x' + thunk.toString(16));
          }
        }
        object.controls.push(control);
      }
    }
    objects.push(object);
  }
  // Diagnostic strings are real BSTRs. Their PUSH references give candidate names;
  // the enclosing prologue remains a heuristic and must be checked in disassembly.
  const diagnostics = [];
  for (const section of pe.sections) {
    const data = b.subarray(section.raw, section.raw + section.rawSize);
    const text = data.toString('utf16le'), re = /\) dans la procédure ([^\0]+?) du module ([^\0]+)/g;
    for (const match of text.matchAll(re)) {
      const off = section.raw + match.index * 2;
      if (off < 4 || b.readUInt32LE(off - 4) !== match[0].length * 2) continue;
      const address = pe.address(off), needle = Buffer.alloc(5); needle[0] = 0x68; needle.writeUInt32LE(address, 1);
      const references = [];
      if (native) for (const code of pe.sections.filter(s => s.executable)) {
        const end = code.raw + code.rawSize;
        for (let at = b.indexOf(needle, code.raw); at >= code.raw && at + 5 <= end; at = b.indexOf(needle, at + 5)) {
          let start = b.lastIndexOf(Buffer.from([0x55, 0x8b, 0xec]), at);
          while (start >= code.raw && !((b[start + 3] === 0x83 || b[start + 3] === 0x81) && b[start + 4] === 0xec)) start = b.lastIndexOf(Buffer.from([0x55, 0x8b, 0xec]), start - 1);
          const reference = { address: pe.address(at), candidate: start >= code.raw ? pe.address(start) : null };
          references.push(reference);
        }
      }
      diagnostics.push({ name: match[1], module: match[2], address, references });
    }
  }
  return { sha256: createHash('sha256').update(b).digest('hex'), imageBase: pe.imageBase, header, project, table, native, objects, symbols, diagnostics, warnings };
}

export function ghidraScript(map, className) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(className)) throw new Error('Ghidra script filename must be a Java class name');
  // Apply only descriptor-derived event and anonymous method labels. Diagnostic candidates stay in JSON
  // until a human verifies their function boundaries and duplicated error strings.
  const procedures = (map.objects || []).flatMap(o => (o.nativeProcedures || []).map(p => ({ address: p.address, name: o.name + '_nativeProc' + p.index })));
  const rows = map.symbols.concat(procedures).map(s => '    label(0x' + s.address.toString(16) + 'L, ' + JSON.stringify(s.name.replace(/[^A-Za-z0-9_]/g, '_')) + ');').join('\n');
  return '// Generated by vb6-map.mjs; binary SHA-256: ' + map.sha256 + '\n' +
    'import ghidra.app.script.GhidraScript;\nimport ghidra.program.model.symbol.SourceType;\n' +
    'public class ' + className + ' extends GhidraScript {\n' +
    '  private void label(long address, String name) throws Exception {\n' +
    '    createLabel(toAddr(address), name, false, SourceType.USER_DEFINED);\n  }\n' +
    '  public void run() throws Exception {\n' + rows + '\n  }\n}\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [binary, output, script] = process.argv.slice(2);
  if (!binary || !output) { console.error('usage: node tools/re/vb6-map.mjs <binary COPY> <output.json> [GhidraScript.java]'); process.exitCode = 2; }
  else {
    const map = mapVb6(fs.readFileSync(binary));
    fs.writeFileSync(output, JSON.stringify(map, null, 2) + '\n');
    if (script) fs.writeFileSync(script, ghidraScript(map, path.basename(script, '.java')));
    const procedures = map.objects.reduce((n, o) => n + o.nativeProcedures.length, 0);
    console.log(map.objects.length + ' objects, ' + procedures + ' native method links, ' + map.symbols.length + ' event labels, ' + map.diagnostics.length + ' diagnostic strings, ' + map.warnings.length + ' warnings');
  }
}
