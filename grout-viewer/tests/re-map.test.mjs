import test from 'node:test';
import assert from 'node:assert/strict';
import { Pe32, mapVb6, ghidraScript } from '../tools/re/vb6-map.mjs';

// Entirely synthetic: no original binary, field data or copied resources in git.
function fixture() {
  const b = Buffer.alloc(0x2000), va = o => 0x402000 + o - 0x200;
  const u16 = (o, v) => b.writeUInt16LE(v, o), u32 = (o, v) => b.writeUInt32LE(v, o);
  const str = (o, s) => b.write(s + '\0', o, 'latin1');
  b.write('MZ'); u32(60, 0x80); b.write('PE\0\0', 0x80); u16(0x84, 0x14c); u16(0x86, 1); u16(0x94, 0xe0);
  u16(0x98, 0x10b); u32(0xa8, 0x2000); u32(0xb4, 0x400000); u32(0xd4, 0x200);
  b.write('.text', 0x178); u32(0x180, 0x2000); u32(0x184, 0x2000); u32(0x188, 0x1e00); u32(0x18c, 0x200); u32(0x19c, 0x60000020);
  b[0x200] = 0x68; u32(0x201, va(0x300)); b[0x205] = 0xe8;
  b.write('VB5!', 0x300); u32(0x330, va(0x400)); u32(0x404, va(0x500)); u32(0x420, va(0x1f00));
  u16(0x52a, 1); u32(0x530, va(0x600));
  u32(0x600, va(0x700)); u32(0x618, va(0x800)); str(0x800, 'PrintForm'); u32(0x61c, 2);
  u32(0x620, va(0x820)); u32(0x820, va(0x840)); str(0x840, 'DrawPage'); u32(0x628, 0x18083);
  // Native lpMethods is deliberately an invalid heap pointer; the parser must not follow it.
  u32(0x724, 0xdeadbeef); u32(0x758, 1); u32(0x75c, va(0x900));
  u16(0x900, 0x40); u16(0x902, 2); u16(0x90c, 3); u32(0x918, va(0xa00)); u32(0x920, va(0x880)); str(0x880, 'PrintButton');
  u32(0xa18, va(0xa80)); b.set([0x81, 0x6c, 0x24, 4, 0xff, 0xff, 0, 0, 0xe9], 0xa80); b.writeInt32LE(va(0xb00) - va(0xa80) - 13, 0xa89);
  u16(0x760, 1); u32(0x768, va(0xa40)); u32(0xa40, va(0xa88));
  b.set([0x55, 0x8b, 0xec, 0x83, 0xec, 0x18], 0xb00);
  const diagnostic = ') dans la procédure DrawPage du module PrintForm';
  u32(0xbfc, diagnostic.length * 2); b.write(diagnostic + '\0', 0xc00, 'utf16le');
  b[0xb20] = 0x68; u32(0xb21, va(0xc00));
  // A raw data pointer must not become a code reference.
  u32(0xd00, va(0xc00));
  return { b, va };
}

test('VB6 map follows PE virtual addresses and recovers native event targets and diagnostic references', () => {
  const { b, va } = fixture(), map = mapVb6(b);
  assert.equal(map.native, true); assert.equal(map.header, va(0x300));
  assert.equal(map.sha256.length, 64); assert.equal(map.objects.length, 1);
  assert.equal(map.objects[0].name, 'PrintForm');
  assert.deepEqual(map.objects[0].procedureNames, ['DrawPage', null]);
  assert.deepEqual(map.objects[0].nativeProcedures, [{ index: 0, thunk: va(0xa88), address: va(0xb00), name: 'DrawPage' }]);
  assert.deepEqual(map.objects[0].controls[0].events, [{ slot: 0, thunk: va(0xa80), address: va(0xb00) }]);
  assert.deepEqual(map.symbols, [{ address: va(0xb00), name: 'PrintForm_PrintButton_event0', evidence: 'native-event-thunk' }]);
  assert.deepEqual(map.diagnostics[0].references, [{ address: va(0xb20), candidate: va(0xb00) }]);
  assert.equal(map.diagnostics[0].name, 'DrawPage'); assert.deepEqual(map.warnings, []);
  const script = ghidraScript(map, 'PrintLabels');
  assert.match(script, /class PrintLabels extends GhidraScript/); assert.match(script, /PrintForm_PrintButton_event0/);
  assert.match(script, /PrintForm_nativeProc0/, 'native method labels identify stripped procedures by owner and index');
  assert.ok(!script.includes('"DrawPage"'), 'unverified prologue candidates are not applied as labels');
});

test('VB6 map refuses malformed pointers, truncated sections, incidental signatures and unsafe script names', () => {
  assert.throws(() => new Pe32(Buffer.alloc(8)), /Truncated/);
  const { b, va } = fixture(), pe = new Pe32(b);
  assert.equal(pe.address(pe.offset(va(0xb00))), va(0xb00));
  assert.throws(() => pe.offset(0x800000), /not backed/);
  assert.throws(() => new Pe32(b.subarray(0, 0x1000)), /Truncated/);
  const bad = Buffer.from(b); bad[0x200] = 0x90;
  assert.throws(() => mapVb6(bad), /entry-point/);
  const count = Buffer.from(b); count.writeUInt32LE(0xffffffff, 0x61c);
  assert.throws(() => mapVb6(count), /procedure count/);
  const target = Buffer.from(b); target.writeInt32LE(0x70000000, 0xa89);
  assert.throws(() => mapVb6(target), /outside executable/);
  assert.throws(() => ghidraScript({ symbols: [] }, 'Bad-name'), /Java class/);
});
