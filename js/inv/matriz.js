// Lluvia de caracteres tipo "Matriz" de fondo. Muy tenue, ~20 cuadros por segundo,
// se pausa cuando la pestaña no está visible y se desactiva si el equipo pide menos movimiento.
const cv = document.getElementById('lluvia');
const ctx = cv?.getContext('2d');
const CH = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789$%+-';
const T = 16;
let cols = [], timer = null, ultimo = 0;
const reducir = matchMedia('(prefers-reduced-motion: reduce)');

const quiere = () => { try { return localStorage.getItem('inv_lluvia') !== '0'; } catch { return true; } };
const activa = () => document.documentElement.dataset.theme === 'matriz' && quiere() && !reducir.matches;
window.lluviaActiva = quiere;

function medir() {
  if (!cv) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = Math.ceil(innerWidth / T);
  cols = Array.from({ length: n }, (_, i) => cols[i] ?? Math.random() * -50);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, innerWidth, innerHeight);
}

function cuadro(t) {
  timer = requestAnimationFrame(cuadro);
  if (t - ultimo < 50) return; ultimo = t;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.font = `${T - 2}px "Share Tech Mono", monospace`;
  for (let i = 0; i < cols.length; i++) {
    const y = cols[i] * T;
    if (y > 0) {
      ctx.fillStyle = Math.random() < 0.04 ? '#c8ffd8' : '#00ff66';
      ctx.fillText(CH[(Math.random() * CH.length) | 0], i * T, y);
    }
    cols[i] = y > innerHeight && Math.random() > 0.975 ? 0 : cols[i] + 1;
  }
}

function refrescar() {
  if (!cv) return;
  cancelAnimationFrame(timer); timer = null;
  if (activa() && !document.hidden) { cv.hidden = false; medir(); timer = requestAnimationFrame(cuadro); }
  else { cv.hidden = true; }
}
window.lluviaRefrescar = refrescar;
addEventListener('resize', () => { if (timer) medir(); });
document.addEventListener('visibilitychange', refrescar);
reducir.addEventListener?.('change', refrescar);
refrescar();
