---
layout: index_es
title: Controlando qu&eacute; secciones y pasajes han sido visualizados
---

Puedes saber si el jugador ha visitado un pasaje o secci&oacute;n usando JavaScript:

```
    if (squiffy.story.seen("pasaje3")) alert ("Has visitado el pasaje3!");
```

Tambi&eacute;n puedes condicionalmente mostrar texto en funci&oacute;n de si un pasaje o secci&oacute;n ha sido visitado, o no:

{% include sample_es.html file="seen_es" %}