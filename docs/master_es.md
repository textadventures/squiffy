---
layout: index_es
title: Secciones y pasajes maestros
---

Un nombre vac&iacute;o para una secci&oacute;n o pasaje crea un "maestro", est&eacute; ser&aacute; activado para cada pasaje o secci&oacute;n en el juego. (Un pasaje maestro definido dentro de una secci&oacute;n s&oacute;lo sera activado para cada pasaje que pertenezca a dicha secci&oacute;n)

p. e. para limpiar la pantalla antes de cada secci&oacute;n, y para incrementar un contador global:

```
[[]]:
@clear
@inc turnos
    if (squiffy.get("turnos") > 5) ...
```
