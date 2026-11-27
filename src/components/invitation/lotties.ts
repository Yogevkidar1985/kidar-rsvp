/**
 * Hand-built Lottie documents for the invitation's small moments. Drawn from code, in the invitation's own colours:
 * nothing is downloaded, and a palette change recolours them.
 */
const rgb = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = m ? parseInt(m[1], 16) : 0xb7a08c;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const still = (k: unknown) => ({ a: 0, k });
const tr = { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) };
const e1 = { i: { x: [0.2], y: [1] }, o: { x: [0.4], y: [0] } };
const e3 = { i: { x: [0.3, 0.3, 0.3], y: [1, 1, 1] }, o: { x: [0.4, 0.4, 0.4], y: [0, 0, 0] } };
const layer = (ind: number, nm: string, op: number, ks: Record<string, unknown>, shapes: unknown[]) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op, st: 0, bm: 0,
  ks: { o: still(100), r: still(0), p: still([0, 0, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]), ...ks }, shapes,
});
const path = (v: number[][], closed: boolean) => ({ ty: 'sh', ks: still({ i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), v, c: closed }) });
const star = (r: number) => { const q = r * 0.24; return path([[0, -r], [q, -q], [r, 0], [q, q], [0, r], [-q, q], [-r, 0], [-q, -q]], true); };

/** Four-point stars that swell and fade in turn, to sit beside the hosts' names. One pass is two seconds. */
export function sparkleLottie(color: string, soft: string) {
  const OP = 120;
  const spots: [number, number, number, number, string][] = [ // x, y, size, first frame, colour
    [16, 30, 12, 0, color], [306, 26, 9, 26, soft], [22, 100, 8, 48, soft], [300, 104, 11, 14, color], [164, 8, 6, 62, color],
  ];
  return {
    v: '5.7.4', fr: 60, ip: 0, op: OP, w: 320, h: 120, nm: 'sparkles', ddd: 0, assets: [],
    layers: spots.map(([x, y, r, t, c], i) => layer(i + 1, `star-${i}`, OP, {
      p: still([x, y, 0]),
      s: { a: 1, k: [{ t, s: [0, 0, 100], ...e3 }, { t: t + 24, s: [100, 100, 100], ...e3 }, { t: t + 52, s: [0, 0, 100] }] },
      r: { a: 1, k: [{ t, s: [-20], ...e1 }, { t: t + 52, s: [25] }] },
    }, [{ ty: 'gr', nm: 'star', it: [star(r), { ty: 'fl', c: still(rgb(c)), o: still(100), r: 1 }, tr] }])),
  };
}

/** The divider under the names draws itself: a diamond pops, then a line runs out to each side. Plays once. */
export function ornamentLottie(color: string) {
  const OP = 70, c = rgb(color);
  const line = (ind: number, from: number, to: number) => layer(ind, `line-${ind}`, OP, { p: still([110, 12, 0]) }, [
    { ty: 'gr', nm: 'line', it: [path([[from, 0], [to, 0]], false), { ty: 'st', c: still(c), o: still(80), w: still(1.2), lc: 2, lj: 2 }, tr] },
    { ty: 'tm', nm: 'draw', s: still(0), o: still(0), m: 1, e: { a: 1, k: [{ t: 14, s: [0], ...e1 }, { t: 56, s: [100] }] } },
  ]);
  return {
    v: '5.7.4', fr: 60, ip: 0, op: OP, w: 220, h: 24, nm: 'ornament', ddd: 0, assets: [],
    layers: [
      layer(1, 'diamond', OP, {
        p: still([110, 12, 0]), r: still(45),
        s: { a: 1, k: [{ t: 0, s: [0, 0, 100], i: { x: [0.3, 0.3, 0.3], y: [1.6, 1.6, 1] }, o: { x: [0.4, 0.4, 0.4], y: [0, 0, 0] } }, { t: 22, s: [100, 100, 100] }] },
      }, [{ ty: 'gr', nm: 'diamond', it: [{ ty: 'rc', p: still([0, 0]), s: still([7, 7]), r: still(0) }, { ty: 'fl', c: still(c), o: still(100), r: 1 }, tr] }]),
      line(2, 14, 62), line(3, -14, -62),
    ],
  };
}

/** After a confirmed RSVP: a disc pops in, a ring ripples out, rays burst, and the check mark draws itself. */
export function successLottie(color = '#2F7D5B') {
  const OP = 90, c = rgb(color);
  const at = (ks: Record<string, unknown>) => ({ p: still([100, 100, 0]), ...ks });
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
    return { ty: 'gr', nm: `ray-${i}`, it: [path([[x * 74, y * 74], [x * 94, y * 94]], false), { ty: 'st', c: still(c), o: still(100), w: still(4), lc: 2, lj: 2 }, tr] };
  });
  return {
    v: '5.7.4', fr: 60, ip: 0, op: OP, w: 200, h: 200, nm: 'rsvp-success', ddd: 0, assets: [],
    layers: [
      layer(1, 'check', OP, at({}), [
        { ty: 'gr', nm: 'check', it: [path([[-32, 2], [-10, 24], [34, -22]], false), { ty: 'st', c: still([1, 1, 1, 1]), o: still(100), w: still(11), lc: 2, lj: 2 }, tr] },
        { ty: 'tm', nm: 'draw', s: still(0), o: still(0), m: 1, e: { a: 1, k: [{ t: 24, s: [0], ...e1 }, { t: 52, s: [100] }] } },
      ]),
      layer(2, 'disc', OP, at({
        s: { a: 1, k: [{ t: 0, s: [0, 0, 100], i: { x: [0.3, 0.3, 0.3], y: [1.5, 1.5, 1] }, o: { x: [0.4, 0.4, 0.4], y: [0, 0, 0] } }, { t: 30, s: [100, 100, 100] }] },
      }), [{ ty: 'gr', nm: 'disc', it: [{ ty: 'el', p: still([0, 0]), s: still([124, 124]) }, { ty: 'fl', c: still(c), o: still(100), r: 1 }, tr] }]),
      layer(3, 'rays', OP, at({}), [
        ...rays,
        // each ray shoots out: its far end runs ahead, then its near end catches up
        { ty: 'tm', nm: 'shoot', o: still(0), m: 1, e: { a: 1, k: [{ t: 26, s: [0], ...e1 }, { t: 46, s: [100] }] }, s: { a: 1, k: [{ t: 38, s: [0], ...e1 }, { t: 62, s: [100] }] } },
      ]),
      layer(4, 'ring', OP, at({
        s: { a: 1, k: [{ t: 14, s: [70, 70, 100], ...e3 }, { t: 70, s: [155, 155, 100] }] },
        o: { a: 1, k: [{ t: 14, s: [55], ...e1 }, { t: 70, s: [0] }] },
      }), [{ ty: 'gr', nm: 'ring', it: [{ ty: 'el', p: still([0, 0]), s: still([124, 124]) }, { ty: 'st', c: still(c), o: still(100), w: still(5), lc: 2, lj: 2 }, tr] }]),
    ],
  };
}
