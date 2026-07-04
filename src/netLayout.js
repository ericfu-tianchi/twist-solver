// Colour-editor net layout — pure data, NO render deps, so the mobile controller
// and the test suite import the SAME source of truth (see test/mobileEditor.test.mjs).
//
// A net maps each on-screen tile of a face (row-major, idx 0..8) to the cubie
// position [x,y,z] it represents; the tile's colour is that cubie's sticker on
// FACE_NORMAL[face]. The mapping therefore encodes how each face is *oriented*
// when unfolded — which depends on where the face sits in the net.
//
// The MOBILE net is a vertical cross (CSS grid areas):
//        . u .
//        l f r
//        . d .
//        . b .
// U/L/F/R/D sit exactly where the desktop net puts them, so their maps match
// desktop. But desktop unfolds B in the L·F·R·B *strip*, while mobile unfolds it
// *below D* — a 180° rotation — so mobile's B is the reversed row/col order.

const rows = (rowVals, colVals, mk) => {
  const a = [];
  for (const r of rowVals) for (const c of colVals) a.push(mk(r, c));
  return a;
};

export const MOBILE_FACELET_POS = {
  U: rows([-1, 0, 1], [-1, 0, 1], (z, x) => [x, 1, z]),
  F: rows([1, 0, -1], [-1, 0, 1], (y, x) => [x, y, 1]),
  R: rows([1, 0, -1], [1, 0, -1], (y, z) => [1, y, z]),
  L: rows([1, 0, -1], [-1, 0, 1], (y, z) => [-1, y, z]),
  B: rows([-1, 0, 1], [-1, 0, 1], (y, x) => [x, y, -1]), // below-D unfold = 180° of the strip B
  D: rows([1, 0, -1], [-1, 0, 1], (z, x) => [x, -1, z]),
};

export const NET_ORDER = ['U', 'L', 'F', 'R', 'B', 'D'];
