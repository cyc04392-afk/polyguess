// 눈 달린 도형 아바타(SVG). avatar = { shape: 0~9, color: 0~11 }
export const AVATAR_COLORS = ['#ff6b8a', '#ff9f43', '#ffd93d', '#6bcb77', '#4dd0e1', '#4d96ff', '#9b5de5', '#f15bb5', '#a0e7e5', '#b8f2a6', '#ffc8dd', '#c0c0ff'];
export const AVATAR_SHAPES = ['상자', '공', '원뿔', '원기둥', '도넛', '피라미드', '별', '하트', '캡슐', '보석'];

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c * k)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function avatarSVG(avatar = { shape: 0, color: 0 }, size = 48) {
  const c = AVATAR_COLORS[(avatar.color ?? 0) % AVATAR_COLORS.length];
  const d = shade(c, 0.72), l = shade(c, 1.18);
  const eyes = (x1, x2, y, r = 5) => `<circle cx="${x1}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x2}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x1 + 1}" cy="${y + 1}" r="${r * 0.5}" fill="#222"/><circle cx="${x2 + 1}" cy="${y + 1}" r="${r * 0.5}" fill="#222"/>`;
  let body = '';
  switch ((avatar.shape ?? 0) % 10) {
    case 0: body = `<polygon points="50,12 86,30 86,70 50,88 14,70 14,30" fill="${c}"/><polygon points="50,12 86,30 50,48 14,30" fill="${l}"/><polygon points="50,48 86,30 86,70 50,88" fill="${d}"/>${eyes(32, 50, 66)}`; break;
    case 1: body = `<circle cx="50" cy="50" r="38" fill="${c}"/><ellipse cx="36" cy="32" rx="12" ry="7" fill="${l}" opacity="0.7"/>${eyes(40, 60, 50)}`; break;
    case 2: body = `<polygon points="50,10 84,76 16,76" fill="${c}"/><ellipse cx="50" cy="76" rx="34" ry="11" fill="${d}"/>${eyes(42, 58, 56)}`; break;
    case 3: body = `<rect x="18" y="26" width="64" height="48" fill="${c}"/><ellipse cx="50" cy="74" rx="32" ry="12" fill="${d}"/><ellipse cx="50" cy="26" rx="32" ry="12" fill="${l}"/>${eyes(40, 60, 52)}`; break;
    case 4: body = `<circle cx="50" cy="50" r="38" fill="${c}"/><circle cx="50" cy="50" r="14" fill="${d}"/>${eyes(30, 70, 46, 5)}`; break;
    case 5: body = `<polygon points="50,12 88,70 12,70" fill="${c}"/><polygon points="50,12 88,70 50,84" fill="${d}"/><polygon points="50,12 12,70 50,84" fill="${l}"/>${eyes(40, 60, 58)}`; break;
    case 6: body = `<polygon points="50,8 61,36 92,38 68,57 75,88 50,71 25,88 32,57 8,38 39,36" fill="${c}"/>${eyes(42, 58, 50)}`; break;
    case 7: body = `<path d="M50 86 C20 64 10 48 14 32 C18 16 40 14 50 30 C60 14 82 16 86 32 C90 48 80 64 50 86Z" fill="${c}"/>${eyes(40, 60, 42)}`; break;
    case 8: body = `<rect x="24" y="10" width="52" height="80" rx="26" fill="${c}"/><rect x="24" y="50" width="52" height="40" rx="26" fill="${d}"/>${eyes(42, 58, 40)}`; break;
    default: body = `<polygon points="50,8 88,40 50,92 12,40" fill="${c}"/><polygon points="50,8 88,40 50,40" fill="${l}"/><polygon points="12,40 50,40 50,92" fill="${d}"/>${eyes(40, 60, 54)}`;
  }
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export function randomAvatar() {
  return { shape: Math.floor(Math.random() * AVATAR_SHAPES.length), color: Math.floor(Math.random() * AVATAR_COLORS.length) };
}
