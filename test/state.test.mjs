import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeState, invert, randomScramble } from '../src/state.js';

test('a fresh cube is solved', () => {
  assert.ok(new CubeState().isSolved());
});

test('every move has order 4', () => {
  for (const f of ['U', 'D', 'L', 'R', 'F', 'B', 'x', 'y', 'z']) {
    const s = new CubeState();
    s.move(f);
    assert.ok(!s.isSolved(), `${f} once should scramble`);
    s.move(f).move(f).move(f);
    assert.ok(s.isSolved(), `${f} x4 should return to solved`);
  }
});

test("a move and its inverse cancel; a double move applied twice cancels", () => {
  for (const f of ['U', 'R', 'F', 'L', 'D', 'B']) {
    assert.ok(new CubeState().move(f).move(f + "'").isSolved(), `${f} ${f}'`);
    assert.ok(new CubeState().move(f + '2').move(f + '2').isSolved(), `${f}2 ${f}2`);
  }
});

test('the "sexy move" (R U R\' U\') has order 6', () => {
  const s = new CubeState();
  for (let i = 0; i < 6; i++) s.moves("R U R' U'");
  assert.ok(s.isSolved());
});

test('scramble followed by its inverse returns to solved (1000 trials)', () => {
  for (let i = 0; i < 1000; i++) {
    const scramble = randomScramble(25);
    const s = new CubeState().moves(scramble).moves(invert(scramble));
    assert.ok(s.isSolved(), `failed on: ${scramble.join(' ')}`);
  }
});
