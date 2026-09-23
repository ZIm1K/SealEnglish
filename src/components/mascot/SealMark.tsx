import { SEAL } from "./seal-geometry";

const P = SEAL.paths;
const C = SEAL.palette;

const EYES = [
  { cx: 450.7, cy: 404.5, rot: -19, rx: 41.5, ry: 45.7, ix: 458.7, iy: 407.5, hx: 465.7, hy: 384 },
  { cx: 650.9, cy: 352.7, rot: -7.4, rx: 41, ry: 45.7, ix: 642.9, iy: 356.7, hx: 628.2, hy: 341.9 },
];

/** Static head of Сілі — server-renderable (logo, icons, avatars). */
export function SealMark({ className, withBody = false }: { className?: string; withBody?: boolean }) {
  return (
    <svg viewBox={withBody ? "200 120 740 830" : "330 160 460 400"} className={className} aria-hidden="true">
      {withBody && (
        <>
          <path d={P.footL} fill={C.body} />
          <path d={P.footR} fill={C.body} />
          <path d={P.arm} fill={C.body} />
          <path d={P.torso} fill={C.body} />
          <path d={P.belly} fill={C.light} />
        </>
      )}
      <path d={P.hair} fill={C.body} />
      <path d={P.head} fill={C.body} />
      <path d={P.muzzle} fill={C.light} />
      <ellipse cx={432.9} cy={469.6} rx={21} ry={20} fill={C.cheek} />
      <ellipse cx={690.7} cy={408} rx={21} ry={20} fill={C.cheek} />
      {EYES.map((e) => (
        <g key={e.cx}>
          <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="#fff" stroke={C.navy} strokeWidth={5} transform={`rotate(${e.rot} ${e.cx} ${e.cy})`} />
          <ellipse cx={e.ix} cy={e.iy} rx={34} ry={40} fill={C.navy} transform={`rotate(${e.rot} ${e.ix} ${e.iy})`} />
          <circle cx={e.hx} cy={e.hy} r={8.5} fill="#fff" />
        </g>
      ))}
      <path d={P.browL} fill={C.navy} />
      <path d={P.browR} fill={C.navy} />
      <path d={P.mouth} fill={C.navy} />
      <path d={P.tongue} fill={C.coral} />
      <path d={P.nose} fill={C.navy} />
    </svg>
  );
}
