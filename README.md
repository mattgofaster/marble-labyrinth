# Marble Labyrinth

Tilt-maze game for the phone. Roll the steel marble into the gold cup without dropping into the pits. 6 boards, best times saved on the device.

## Play

- **Desktop:** double-click `play.bat`. Tilt with the arrow keys / WASD, or drag on the board. `Esc` pauses, `R` restarts.
- **iPhone (tilt controls):** double-click `play-phone.bat` with the phone on the same Wi-Fi. Open the `Network: https://…` address in Safari, accept the certificate warning (Show Details → visit this website), tap Play, and allow Motion & Orientation access.
  - iOS only gives tilt data to `https://` pages, which is why the phone launcher uses a self-signed certificate.
- **Hosted:** `netlify.toml` is set up like the other games (`npm run build` → `dist`), which gives a real HTTPS link with no certificate warning.

## Files

- `src/levels.js`: board layouts as text grids (`#` wall, `O` pit, `S` start, `G` cup, `C` checkpoint flag). Every board is 11 × 17.
- `src/main.js`: physics, input (tilt, keys, drag), rendering, menus.
- `src/audio.js`: synthesized sounds (rolling, wall knocks, drop, win).

## Tuning

Constants at the top of `src/main.js`: `GRAVITY` (how fast tilt accelerates the marble), `DAMPING` (rolling resistance), `MAX_TILT_DEG` (tilt angle that counts as full tilt), `BOUNCE`, `HOLE_R`.
