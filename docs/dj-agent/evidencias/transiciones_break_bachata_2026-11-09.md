# Break de la saliente: «La Bachata Loca → Alentando ilusiones»

Ensayo local con el motor real e Icecast. La biblioteca tiene solo esas dos pistas, así que el motor las alterna. Se graba el stream como oyente y se mide con `scripts/medir_transiciones.py`. Fundido de 8 s, igual que en producción.

## Antes (motor de main, c54f4f1)

| # | De → A | Cambio audible | Bajón | BPM saliente → entrante | Veredicto |
|---|---|---|---|---|---|
| 1 | Danna Ruiz - Alentando ilusiones → Ronald Nunez - La Bachata Loca | 8.5 s | 2.4 dB | 99.0 → 96.1 (2.9 %) | mezcla suave |
| 2 | Ronald Nunez - La Bachata Loca → Danna Ruiz - Alentando ilusiones | 13.0 s | 6.6 dB | 145.5 → 99.3 (31.8 %) | bajón de volumen |


```
[auditsound] automix: pista en deck 0 (dur=202.1 first=0.15 last=200.92 fuerte_desde=0.00 fuerte_hasta=201.00 bpm=99.0)
[auditsound] automix: pista en deck 1 (dur=260.2 first=0.00 last=260.14 fuerte_desde=0.00 fuerte_hasta=259.00 bpm=146.0)
[auditsound] automix: transición deck 0 -> 1 (fadeBegin=192.92 fadeEnd=200.92 entra_en=0.00)
[auditsound] automix: pista en deck 0 (dur=202.1 first=0.15 last=200.92 fuerte_desde=0.00 fuerte_hasta=201.00 bpm=99.0)
[auditsound] automix: fin transición; ahora suena deck 1
[auditsound] automix: transición deck 1 -> 0 (fadeBegin=252.00 fadeEnd=260.00 entra_en=0.15)
[auditsound] automix: pista en deck 1 (dur=260.2 first=0.00 last=260.14 fuerte_desde=0.00 fuerte_hasta=259.00 bpm=146.0)
[auditsound] automix: fin transición; ahora suena deck 0
```

## Después (con `mixpoints::breakFadeEnd`)

| # | De → A | Cambio audible | Bajón | BPM saliente → entrante | Veredicto |
|---|---|---|---|---|---|
| 1 | Danna Ruiz - Alentando ilusiones → Ronald Nunez - La Bachata Loca | 9.0 s | 2.9 dB | 99.0 → 96.1 (2.9 %) | mezcla suave |
| 2 | Ronald Nunez - La Bachata Loca → Danna Ruiz - Alentando ilusiones | 13.0 s | 2.5 dB | 144.0 → 99.2 (31.1 %) | mezcla suave |


```
[auditsound] automix: pista en deck 0 (dur=202.1 first=0.15 last=200.92 fuerte_desde=0.00 fuerte_hasta=201.00 bpm=99.0)
[auditsound] automix: pista en deck 1 (dur=260.2 first=0.00 last=260.14 fuerte_desde=0.00 fuerte_hasta=259.00 bpm=146.0)
[auditsound] automix: transición deck 0 -> 1 (fadeBegin=192.92 fadeEnd=200.92 entra_en=0.00)
[auditsound] automix: pista en deck 0 (dur=202.1 first=0.15 last=200.92 fuerte_desde=0.00 fuerte_hasta=201.00 bpm=99.0)
[auditsound] automix: break de la saliente en 254.00 s: el fundido termina ahí (antes 260.00)
[auditsound] automix: fin transición; ahora suena deck 1
[auditsound] automix: transición deck 1 -> 0 (fadeBegin=246.00 fadeEnd=254.00 entra_en=0.15)
[auditsound] automix: pista en deck 1 (dur=260.2 first=0.00 last=260.14 fuerte_desde=0.00 fuerte_hasta=259.00 bpm=146.0)
[auditsound] automix: fin transición; ahora suena deck 0
```
