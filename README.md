# NBA JAM Tracker

Base de datos automática de box scores NBA + web app para proyectar totales por partido (asistencias, puntos, 1er cuarto, 1a mitad, pérdidas, rebotes, triples…) contra la línea. Es la versión automática de la hoja `NBA_JAM.xlsx` (OFF / DEF / JAM / registro por juego).

## Cómo funciona

```
GitHub Actions (3 veces al día)  ──►  ESPN API  ──►  data/games.json + data/games.csv  (commit automático)
                                                              │
GitHub Pages (index.html) ◄───────────────────────────────────┘
        └── además consulta ESPN en vivo desde el navegador para los partidos del día
```

- **No hay que pegar nada**: el workflow `.github/workflows/update.yml` baja cada partido terminado y lo agrega a la base.
- **En vivo**: la pestaña *Partidos* lee el marcador de ESPN directo (se refresca cada 60 s si hay juegos en curso) y muestra el acumulado actual vs. la línea.

## Instalación (una sola vez, ~5 min)

1. Crea un repo nuevo en GitHub (público para usar Pages gratis), p. ej. `nba-jam`.
2. Sube todo el contenido de esta carpeta (incluida la carpeta oculta `.github`).
3. **Settings → Actions → General → Workflow permissions** → marca **Read and write permissions** → Save.
4. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main` / `/ (root)` → Save.
5. Tu app queda en `https://TU_USUARIO.github.io/nba-jam/`.

## Usuarios y nube (Firebase, ~10 min)

Varias personas pueden entrar con su cuenta de Google. **Solo entran los correos que el administrador aprueba**, y **cada usuario solo ve sus propios datos** (líneas, movimiento de línea, picks, cruces manuales). Las estadísticas (partidos, jugadores, ranking) son iguales para todos.

1. <https://console.firebase.google.com> → **Agregar proyecto** (p. ej. `nba-jam`; Google Analytics no hace falta).
2. **Compilación → Authentication → Comenzar → Google → Habilitar** → elige tu correo de soporte → Guardar.
3. **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TU_USUARIO.github.io`.
4. **Compilación → Firestore Database → Crear base de datos** → ubicación cercana (p. ej. `us-west2`) → *modo de producción*.
5. Abre `firestore.rules` de este repo, ya trae el correo de admin (`jon.mgonza@gmail.com`); pega todo en la pestaña **Reglas** de Firestore → **Publicar**.
6. **⚙ Configuración del proyecto → Tus apps → icono Web `</>`** → registra la app (sin Hosting) → copia el objeto `firebaseConfig`.
7. En `firebase-config.js`: pega ese objeto en `window.FIREBASE_CONFIG = { … }` y pon tu mismo correo en `window.APP_ADMINS`. Súbelo al repo.

**Cómo se usa**
- Cualquiera abre la app y toca **Entrar con Google**. Si no está aprobado ve "⏳ acceso pendiente" y su solicitud te llega.
- Tú (admin) ves el botón **Usuarios** con el número de solicitudes: **Aprobar / Rechazar**, agregar un correo directamente o **Quitar** a alguien.
- Al **Salir** se borra la copia local de ese navegador, para que el siguiente usuario no vea nada del anterior. Al volver a entrar, todo regresa desde la nube.
- Mientras alguien no está aprobado (o sin entrar), la app funciona igual pero lo que capture se queda solo en ese navegador.

Notas: el `apiKey` de Firebase no es secreto; la seguridad está en las reglas (paso 5), que valida el servidor: nadie puede leer datos de otro usuario, ni el admin. El plan gratuito (Spark) alcanza de sobra para un grupo.

## Cargar temporadas anteriores (recomendado)

Sirve para probar la app desde ya y para el **historial directo** entre equipos y el historial de jugadores contra un rival.
**Actions → Actualizar datos NBA → Run workflow**, una corrida por temporada (tipos: `2`):

| Temporada | desde | hasta |
|---|---|---|
| 2025-26 | `2025-10-21` | `2026-04-12` |
| 2024-25 | `2024-10-22` | `2025-04-13` |
| 2023-24 | `2023-10-24` | `2024-04-14` |

Cada una tarda ~10–15 min (≈1,230 partidos, con box score de jugadores). Córrelas una por una: espera a que termine (palomita verde) antes de lanzar la siguiente; si lanzas varias a la vez, GitHub cancela las que quedan en espera.
En la app, el selector *Temporada* cambia entre temporadas; el historial directo y "Contra" en jugadores usan todas.

La temporada regular 2026-27 arranca el **20 de octubre de 2026**; a partir de ahí el workflow agrega los juegos solo.

## Pestañas

| Pestaña | Equivale a | Qué hace |
|---|---|---|
| Partidos | hoja **JAM** | Juegos del día (o cualquier fecha). Proyección = promedio de (a favor + en contra) de cada equipo = tu ATGA. Escribes la línea → OVER/UNDER, diferencia, % de juegos de cada equipo que pasaron esa línea y probabilidad aproximada. Botones para registrar tu pick. Para fechas pasadas, la proyección usa solo los juegos previos a esa fecha. |
| Equipos | hojas **OFF / DEF** | A favor, en contra, total, desviación, total en casa / de visita, TO y A/TO. Ordenable por columna. |
| (en la misma tarjeta) | — | **Momio**: dos casillas (OVER / UNDER) junto a la línea; acepta americano (-115, +105) o decimal (1.91). Con el momio la app calcula la probabilidad que necesitas para empatar, la compara con la del modelo y marca **VALOR OVER/UNDER** con el valor esperado (EV) por unidad, más la comisión de la casa. El pick guarda su momio y en *Mis picks* se calcula la ganancia en **unidades** y el **ROI**. |
| (en la misma tarjeta) | — | **Línea en vivo**: cada vez que cambias la línea se guarda en un historial con el momento del juego (Pre, 4:30 - 1Q…), lo que iba acumulado y la proyección en ese instante. Durante el partido la sugerencia usa la **proyección en vivo** = acumulado + lo esperado en los minutos restantes; el ritmo esperado mezcla el promedio de los equipos (pesa como 24 min) con el ritmo real del partido, así que conforme avanza el juego manda más lo que está pasando. Gráfica de línea vs. proyección y picks en vivo (guardan cuánto iba al momento del pick). |
| (en la misma tarjeta) | — | **Proyección ajustada por bajas** (control *Ajuste por bajas*): a la proyección base le resta lo que aportan los jugadores que no juegan (Out en el reporte de lesiones; ya iniciado, los DNP; en partidos terminados, los de la rotación que no jugaron). Aporte = lo que produjo en los juegos de la ventana del equipo ÷ juegos de la ventana, así que si ya llevaba tiempo fuera no se resta doble. Se descuenta solo la parte que el resto no recupera (25 / 50 / 75 %). La sugerencia y la proyección en vivo usan la ajustada; la base se muestra abajo. Para 1er cuarto / 1a mitad se usa la proporción de puntos del equipo en ese tramo. |
| (en la misma tarjeta) | — | **Tiempo y marcador por cuarto** (en vivo y final): cuarto, reloj, minutos jugados con barra de avance. **Racha y jugadas**: racha actual (p. ej. MIL 9-0 en 2:31), parcial de los últimos 5 minutos, mayor racha del partido, gráfica de la ventaja y últimas 8 jugadas; se refresca cada minuto mientras esté abierta. |
| (en la misma tarjeta) | — | **Plantilla nueva** (dentro del control *Ajuste plantilla y bajas*): con los rosters actuales, resta lo que aportaban los jugadores que ya no están y suma lo de los que llegaron (con sus números del equipo anterior, ponderado por cuánto jugaron), aplicando el mismo % de recuperación. Útil al inicio de temporada mientras se usan datos de la anterior. |
| (en la misma tarjeta) | — | **Historial directo**: todos los enfrentamientos entre esos dos equipos en la base (todas las temporadas), con marcador, total del parámetro y si pasó la línea actual. |
| (en la misma tarjeta) | — | **Alineaciones**: rotación de cada equipo con promedios (MIN, PTS, REB, AST, 3PM, últimos 5) y lesionados del día (Out / Day-To-Day). Antes del juego, titulares probables = los del último partido sin los "Out"; ya iniciado, la alineación real y lo que lleva cada jugador. Suma de promedios del parámetro de los disponibles vs. promedio del equipo (para ver el impacto de las bajas). |
| (en la misma tarjeta) | — | **Descanso** (control *Descanso*): etiqueta **B2B** / **1 día** junto al equipo y ajuste medido en la liga: cuánto cambia lo que produce y lo que permite un equipo según sus días de descanso, comparado con su propio promedio (todas las temporadas cargadas, solo juegos anteriores a la fecha). |
| (en la misma tarjeta) | — | **Modelo ritmo × eficiencia** (control *Modelo*): posesiones = FGA − OREB + TO + 0.44·FTA. Ritmo esperado = ritmo local × ritmo visita ÷ ritmo de la liga; cada equipo = ritmo esperado × (su eficiencia ofensiva × eficiencia defensiva del rival ÷ la de la liga). *Promedios* sigue siendo tu hoja JAM. |
| (en la misma tarjeta) | — | **Modelo Jugadores (alineación)** y **Mixto**: parte de la proyección del equipo (a favor y en contra del rival) y la mueve según la alineación. Cada jugador tiene un índice = lo que produce por minuto ÷ lo que produce su equipo por minuto en esos mismos juegos; con los minutos estimados de hoy (titulares y los 3 siguientes conservan los suyos, el resto se reparte hasta 240) sale el **índice de alineación** (1.00 = la de siempre). La proyección se mueve 30 % de esa diferencia frente a las alineaciones que el equipo usó en su ventana (tope +6 % / −8 %). *Mixto* = mitad promedios, mitad jugadores. En *Alineaciones* se ve MIN est. y la parte de cada jugador. |
| (en la misma tarjeta) | — | **Mercado** (parámetro Puntos): total y spread de DraftKings que publica ESPN, diferencia contra tu proyección y contra la línea de Playdoit que capturaste. |
| Jugadores | — | Promedios de todos los jugadores (respeta la ventana), ordenables. Al tocar uno: registro juego por juego, línea de prop (PTS, REB, AST, 3PM, P+R+A…) con % over en temporada y últimos 10, y filtro "Contra" un equipo con todas las temporadas cargadas. |
| Ranking | — | Top 10/15/25 por posición (bases y escoltas · aleros y alas-pívot · centros) según el puntaje elegido: **EFF** (fórmula oficial NBA: PTS+REB+AST+STL+BLK − tiros fallados − pérdidas), **Fantasy DFS** (PTS + 1.2·REB + 1.5·AST + 3·STL + 3·BLK − TO) o una estadística sola. Filtros de juegos y minutos mínimos; flecha ▲▼ si viene mejor o peor en sus últimos 5. Toca un jugador para abrir su registro. |
| Registro por juego | **Sheet4** | Cada equipo con G1…Gn, AVG, MEDIA, G/O, G/U, % over contra una línea. Celdas en verde/rojo. |
| Mis picks | columna **Pick** | Se califican solos (ganado/perdido/push) y comparan tu récord vs. lo que sugería el modelo. **Monto por pick** ($) → ganancia en pesos, ROI, apostado y en juego. ✏️ edita lado, línea, momio y monto (recalcula el valor esperado). Exporta CSV o respaldo JSON. |
| Competencia | — | Tabla entre los usuarios aprobados: picks calificados, récord, **% de acierto** (orden principal), unidades, monto apostado y ganancia en pesos; mínimo de picks para entrar al ranking; filtro por periodo y parámetro. Los picks de cada quien se revelan al empezar su partido y desde ahí ya no se pueden editar ni borrar en la competencia (lo hacen cumplir las reglas de Firestore). Si alguien publica un pick después de que terminó el partido, sale marcado **⚠ tarde** y no cuenta. |
| Enfrentamientos | — | Temporada elegida, por enfrentamiento o por equipo: juegos, línea promedio (tu última línea antes del partido o la de DraftKings), resultado promedio, real − línea (tendencia OVER/UNDER), conteo Over/Under, proyección y error promedio, y % de acierto del modelo elegido (Ritmo, Promedios, Mixto o Jugadores). Toca un renglón para ver sus partidos. |
| Seguimiento → *Cada modelo con tus líneas y momios* | — | Califica la recomendación de cada modelo (Promedios, Ritmo, Jugadores, Mixto) en **cada partido terminado, aunque no hayas hecho pick**: línea = la que capturaste o, en Puntos, la de DraftKings; momio = el capturado, el de DraftKings o −110. Proyección = foto al capturar tu línea, o **foto automática** que la app guarda antes de cada partido cuando la abres ese día, o recalculada con datos previos. Récord, % de acierto, unidades, ROI; filtros por momento, fuente de la línea, solo con valor / con margen y por modelo (detalle partido por partido). |
| Seguimiento | — | Con tu configuración actual, cada partido terminado contra la proyección que había antes de jugarse: error medio, % dentro de ±5 %, acierto del lado (con tu línea capturada o la del mercado), sesgo y gráfica de error por semana. Tabla de **qué equipos se apegan más a la proyección** (error y sesgo del equipo y del total, % arriba de la proyección) y lista partido por partido. Filtro por periodo y por equipo. |
| Prueba del modelo | — | Recorre la temporada elegida partido por partido usando solo juegos previos y compara con el real: error medio, sesgo, % dentro de ±5 %, cobertura del rango 80 % y, en puntos, acierto contra la línea del mercado. Compara 16 configuraciones (modelo × ventana × descanso) y deja aplicar la mejor con un botón. |
| Datos / Excel | — | Descarga CSV y código de Power Query para jalar la base a Excel con *Actualizar todo*. |

**Inicio de temporada:** mientras un equipo (o jugador) lleve menos de 20 juegos en la temporada elegida, la app completa con sus últimos juegos de la temporada anterior (en la tarjeta se ve, p. ej., GP 3+17).

**Ajuste de inicio de temporada:** mientras la proyección use juegos de la temporada anterior, se le suma lo que el primer mes de esa temporada se produjo por encima de su promedio (en 2025-26, +1.4 puntos por equipo), en proporción a cuántos de esos juegos usa; llega a 0 cuando los equipos tienen 20 juegos.

**Comparación en cada tarjeta:** Ritmo y Promedios lado a lado (Ritmo × eficiencia es el modelo por defecto), con la diferencia y si quedan del mismo lado de la línea con margen (✓ los dos / parejo / ⚠ no coinciden). En *Seguimiento*, la tabla *Ritmo vs. Promedios* dice cuál va atinando más y cómo les va cuando coinciden.

Controles globales: parámetro, temporada, ventana (toda / últimos 20 / 10 / 5), split local-visita, modelo (Mixto por defecto; con Mixto o Jugadores las bajas y los cambios de plantilla ya van incluidos), descanso, promedio o mediana.

## Archivos de datos

- `data/games.json`: un registro por partido `{id, date, season, type, h:{t, pts, q:[Q1..], ast, to, reb, oreb, dreb, stl, blk, pf, fgm, fga, tpm, tpa, ftm, fta, fbp, pip}, a:{…}}`
- `data/games.csv`: 2 filas por partido (una por equipo) con sufijos `_f` (a favor), `_c` (en contra), `_tot` (total del partido).
- `data/slate.json`: calendario de hoy y mañana con lesionados (respaldo si ESPN no responde en el navegador).
- `data/players/<temporada>.json`: una fila por jugador por partido `[game_id, athlete_id, equipo, titular, MIN, PTS, REB, AST, STL, BLK, TO, 3PM, 3PA, FGM, FGA, FTM, FTA, OREB, DREB, PF, +/-]` (~2 MB por temporada).
- `data/athletes.json`: catálogo `id → [nombre, nombre corto, posición, número]`.

## Correr local

```bash
node scripts/update.mjs                        # incremental
node scripts/update.mjs 2026-10-20 2026-11-05  # rango
SEASON_TYPES=2,5,3 node scripts/update.mjs ... # incluir play-in y playoffs
npx serve .                                    # abrir la app en http://localhost:3000
```

## Notas

- Fuente: API pública no oficial de ESPN (`site.api.espn.com`). No requiere llave, pero ESPN podría cambiarla sin aviso; si algo deja de llegar, revisa el log del workflow en *Actions*.
- Los picks, líneas e historial de líneas se guardan en el navegador y, con Firebase, en la cuenta de cada usuario (sincronizados entre sus dispositivos). *Exportar respaldo* sigue disponible.
- Asistencias, puntos, rebotes, triples, 1er cuarto y 1a mitad tienen proyección en vivo; pérdidas, robos, bloqueos y tiros libres no vienen en el marcador en vivo de ESPN, así que ahí se usa la proyección previa.
- ESPN no publica la alineación titular antes del partido; los "titulares probables" son una estimación.
