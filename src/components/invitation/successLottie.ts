/** Hand-built Lottie document: a disc pops in, a ring ripples out, the check mark draws itself. */
const hex = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = m ? parseInt(m[1], 16) : 0x2f7d5b;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const still = (k: unknown) => ({ a: 0, k });
const tr = { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) };
const ease = { i: { x: [0.2], y: [1] }, o: { x: [0.5], y: [0] } };
const layer = (ind: number, nm: string, ks: Record<string, unknown>, shapes: unknown[]) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: 90, st: 0, bm: 0,
  ks: { o: still(100), r: still(0), p: still([100, 100, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]), ...ks }, shapes,
});

export function successLottie(color = '#2F7D5B') {
  const c = hex(color);
  return {
    v: '5.7.4', fr: 60, ip: 0, op: 90, w: 200, h: 200, nm: 'rsvp-success', ddd: 0, assets: [],
    layers: [
      layer(1, 'check', {}, [
        { ty: 'gr', nm: 'check', it: [
          { ty: 'sh', ks: still({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-32, 2], [-10, 24], [34, -22]], c: false }) },
          { ty: 'st', c: still([1, 1, 1, 1]), o: still(100), w: still(11), lc: 2, lj: 2 }, tr,
        ] },
        { ty: 'tm', nm: 'draw', s: still(0), o: still(0), m: 1, e: { a: 1, k: [{ t: 24, s: [0], ...ease }, { t: 52, s: [100] }] } },
      ]),
      layer(2, 'disc', {
        s: { a: 1, k: [{ t: 0, s: [0, 0, 100], i: { x: [0.3, 0.3, 0.3], y: [1.5, 1.5, 1] }, o: { x: [0.4, 0.4, 0.4], y: [0, 0, 0] } }, { t: 30, s: [100, 100, 100] }] },
      }, [{ ty: 'gr', nm: 'disc', it: [{ ty: 'el', p: still([0, 0]), s: still([124, 124]) }, { ty: 'fl', c: still(c), o: still(100), r: 1 }, tr] }]),
      layer(3, 'ring', {
        s: { a: 1, k: [{ t: 14, s: [70, 70, 100], i: { x: [0.2, 0.2, 0.2], y: [1, 1, 1] }, o: { x: [0.3, 0.3, 0.3], y: [0, 0, 0] } }, { t: 70, s: [155, 155, 100] }] },
        o: { a: 1, k: [{ t: 14, s: [55], ...ease }, { t: 70, s: [0] }] },
      }, [{ ty: 'gr', nm: 'ring', it: [{ ty: 'el', p: still([0, 0]), s: still([124, 124]) }, { ty: 'st', c: still(c), o: still(100), w: still(5), lc: 2, lj: 2 }, tr] }]),
    ],
  };
}
