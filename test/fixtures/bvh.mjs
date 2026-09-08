export const assumptions = { units: 'meters', upAxis: 'Y', positionConvention: 'offset_relative', leftFootJoint: 'left', rightFootJoint: 'right', groundHeight: 0 };
export function fixture({ fps = 30, seconds = 3, scale = 1, up = 'Y', setup = false, rotation = 0 } = {}) {
  const offset = up === 'Y' ? [0, -scale, 0] : [0, 0, -scale];
  const positions = [0, 0, 0]; positions[up === 'Y' ? 1 : 2] = scale;
  const hierarchy = `HIERARCHY\nROOT pelvis\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\nJOINT left\n{\nOFFSET ${offset.join(' ')}\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n}\nJOINT right\n{\nOFFSET ${offset.join(' ')}\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n}\n}\n`;
  const rows = Array.from({ length: seconds * fps + 1 }, (_, frame) => {
    const t = frame / fps, root = [...positions]; root[0] = t * scale;
    // World-stationary feet despite a traveling root, then a brief clear flight.
    const foot = [-t * scale, 0, 0]; foot[up === 'Y' ? 1 : 2] = t > 2 && t < 2.3 ? .4 * scale : 0;
    return [...root, 0, 0, 0, ...foot, rotation, 0, 0, ...foot, 0, 0, 0];
  });
  if (setup) rows.unshift([...positions, 0, 0, 0, ...Array(12).fill(0)]);
  return `${hierarchy}MOTION\nFrames: ${rows.length}\nFrame Time: ${1 / fps}\n${rows.map(r => r.join(' ')).join('\n')}\n`;
}
